'use strict';

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = process.env.ROOT_DIR || process.env.HOME || process.env.USERPROFILE || process.cwd();
const UPLOAD_DIR = path.join(os.tmpdir(), 'beats-rename-uploads');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '200', 10);
const AUDIO_EXTS = new Set(['mp3','flac','m4a','m4b','m4p','aac','ogg','oga','opus','wav','wma','ape','aiff','aif','alac','dsf','dff','mp2','mpa','webm']);

// ---------- auth setup ----------
const crypto = require('crypto');
const AUTH_FILE = path.join(__dirname, '.auth');
const SECRET_FILE = path.join(__dirname, '.secret');

function loadOrCreate(file, generator) {
  try {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v;
    }
  } catch (_) {}
  const v = generator();
  try { fs.writeFileSync(file, v, { mode: 0o600 }); } catch (_) { try { fs.writeFileSync(file, v); } catch (__) {} }
  return v;
}

const AUTH_USER = process.env.AUTH_USER || 'admin';
let AUTH_PASS = process.env.AUTH_PASS;
if (!AUTH_PASS) {
  AUTH_PASS = loadOrCreate(AUTH_FILE, () => crypto.randomBytes(12).toString('base64url'));
}
const AUTH_SECRET = process.env.AUTH_SECRET || loadOrCreate(SECRET_FILE, () => crypto.randomBytes(32).toString('base64url'));

function hashPw(pw) { return crypto.createHash('sha256').update(String(pw)).digest(); }
const PASS_HASH = hashPw(AUTH_PASS);

// rate limit (in-memory)
const loginAttempts = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count <= 8;
}

function makeToken(user) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  const payload = Buffer.from(JSON.stringify({ u: user, e: exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function verifyToken(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const parts = tok.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_) { return null; }
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
  catch (_) { return null; }
  if (!data || !data.u || !data.e) return null;
  if (Date.now() > data.e) return null;
  if (data.u !== AUTH_USER) return null;
  return data.u;
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    const v = decodeURIComponent(p.slice(i + 1).trim());
    out[k] = v;
  });
  return out;
}
function isSecure(req) {
  if (process.env.FORCE_SECURE === '1') return true;
  const proto = req.headers['x-forwarded-proto'];
  if (proto && String(proto).includes('https')) return true;
  return req.secure === true;
}
function requireAuth(req, res, next) {
  // allow login/logout/health
  if (req.path === '/login' || req.path === '/logout' || req.path === '/health') return next();
  const cookies = parseCookies(req);
  const user = verifyToken(cookies.br_session);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', requireAuth);

// ---------- helpers ----------

function safeResolve(rel) {
  // Resolve a relative path against ROOT_DIR, prevent traversal outside ROOT_DIR
  const root = path.resolve(ROOT_DIR);
  const target = path.resolve(root, rel || '');
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path outside allowed root');
  }
  return target;
}

function runMediaInfo(filePath) {
  return new Promise((resolve, reject) => {
    execFile('MediaInfo', ['--Output=JSON', filePath], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // fallback to lowercase mediainfo
        execFile('mediainfo', ['--Output=JSON', filePath], { maxBuffer: 10 * 1024 * 1024 }, (err2, stdout2) => {
          if (err2) return reject(new Error(stderr || err2.message));
          resolve(parseMediaInfo(stdout2, filePath));
        });
        return;
      }
      resolve(parseMediaInfo(stdout, filePath));
    });
  });
}

function parseMediaInfo(stdout, filePath) {
  let data;
  try { data = JSON.parse(stdout); }
  catch (e) { throw new Error('Invalid MediaInfo output'); }
  const media = data.media || {};
  const tracks = media.track || [];
  const general = tracks.find(t => t['@type'] === 'General') || {};
  const audio = tracks.find(t => t['@type'] === 'Audio') || {};
  const tags = {};
  // MediaInfo puts tags in General track with various casings
  const tagKeys = ['Title','Artist','Album','Album_Artist','AlbumArtist','Track','Track/Position','TrackNumber',
    'Track_Position','Track_Position_Total','Part_Position','Part_Position_Total',
    'Date','Year','Recorded_Date','Genre','Composer','Performer','DiscNumber','Disc','Comment','EncodedBy','Copyright',
    'Title/Sort','Artist/Sort'];
  for (const k of tagKeys) {
    if (general[k] !== undefined) tags[k] = general[k];
  }
  // Also capture any extra keys that look like metadata
  for (const [k, v] of Object.entries(general)) {
    if (typeof v === 'string' && !tags[k] && !k.startsWith('@') && !k.startsWith('File') && !k.startsWith('Duration') &&
        !k.startsWith('Format') && !k.startsWith('FileSize') && !k.startsWith('Overall') && !k.startsWith('Stream') &&
        !k.startsWith('Audio') && !k.startsWith('Encoded')) {
      tags[k] = v;
    }
  }
  return {
    path: filePath,
    filename: path.basename(filePath),
    ext: path.extname(filePath).replace(/^\./, ''),
    general,
    audio,
    tags,
    duration: general.Duration || audio.Duration,
    format: general.Format || audio.Format,
    bitrate: general.OverallBitRate || audio.BitRate,
    sampleRate: audio.SamplingRate,
    channels: audio.Channels,
    bitDepth: audio.BitDepth,
  };
}

function musicBrainzSearch(artist, title, album, freeText) {
  const params = new URLSearchParams();
  let q = '';
  if (freeText) q = freeText;
  else {
    if (title) q += `recording:"${title}"`;
    if (artist) q += (q ? ' AND ' : '') + `artist:"${artist}"`;
    if (album) q += (q ? ' AND ' : '') + `release:"${album}"`;
  }
  params.set('query', q || title || artist || freeText || '');
  params.set('fmt', 'json');
  params.set('limit', '8');
  const url = `https://musicbrainz.org/ws/2/recording?${params.toString()}`;
  return fetch(url, {
    headers: { 'User-Agent': 'beats-rename/1.0 ( https://github.com )', 'Accept': 'application/json' }
  }).then(r => r.json());
}

// ---------- routes ----------

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Login
app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (!rateLimitOk(ip)) return res.status(429).json({ error: 'Too many attempts' });
  const { username, password } = req.body || {};
  const uOk = username === AUTH_USER;
  let pOk = false;
  try { pOk = crypto.timingSafeEqual(hashPw(password || ''), PASS_HASH); }
  catch (_) { pOk = false; }
  if (!uOk || !pOk) return res.status(401).json({ error: 'Invalid credentials' });
  const token = makeToken(AUTH_USER);
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `br_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
  res.json({ ok: true, user: AUTH_USER });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'br_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const cookies = parseCookies(req);
  const user = verifyToken(cookies.br_session);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user });
});

// Recursive file listing (for bulk folder selection)
app.get('/api/list-recursive', (req, res) => {
  try {
    const dir = safeResolve(req.query.path || '');
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
    const out = [];
    function walk(d) {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); }
      catch (_) { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else out.push(path.relative(ROOT_DIR, full).replace(/\\/g, '/'));
      }
    }
    walk(dir);
    res.json({ files: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List directory (seedbox mode)
app.get('/api/list', (req, res) => {
  try {
    const dir = safeResolve(req.query.path || '');
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.relative(ROOT_DIR, path.join(dir, e.name)).replace(/\\/g, '/'),
    })).sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    res.json({ root: ROOT_DIR, path: path.relative(ROOT_DIR, dir).replace(/\\/g, '/') || '.', entries });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Upload files (local drag-drop)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sid = (req.query && req.query.sessionId) || req.body?.sessionId || uuidv4();
    req.sessionId = sid;
    const dir = path.join(UPLOAD_DIR, sid);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

app.post('/api/upload', upload.array('files', 200), (req, res) => {
  const sid = req.sessionId || (req.query && req.query.sessionId) || req.body?.sessionId || uuidv4();
  const files = (req.files || []).map(f => ({
    name: f.originalname,
    path: path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/'),
    size: f.size,
  }));
  res.json({ sessionId: sid, files });
});

// Analyze files
app.post('/api/analyze', async (req, res) => {
  const { files } = req.body || {}; // array of relative paths (upload mode) OR absolute-ish seedbox paths
  const mode = req.body.mode || 'upload'; // 'upload' | 'seedbox'
  if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'No files' });
  const results = [];
  for (const f of files) {
    try {
      let full;
      if (mode === 'seedbox') full = safeResolve(f);
      else full = path.join(UPLOAD_DIR, f);
      const ext = path.extname(full).replace(/^\./, '').toLowerCase();
      const isAudio = AUDIO_EXTS.has(ext);
      let info;
      if (isAudio) {
        info = await runMediaInfo(full);
      } else {
        info = { path: full, filename: path.basename(full), ext, isAudio: false, folderName: path.basename(path.dirname(full)), tags: {} };
      }
      info.isAudio = isAudio;
      info.folderName = info.folderName || path.basename(path.dirname(full));
      results.push({ ok: true, file: f, info });
    } catch (e) {
      results.push({ ok: false, file: f, error: e.message });
    }
  }
  res.json({ results });
});

// MusicBrainz lookup
app.post('/api/lookup', async (req, res) => {
  const { artist, title, album } = req.body || {};
  try {
    const data = await musicBrainzSearch(artist, title, album);
    const recs = (data.recordings || []).map(r => ({
      id: r.id,
      title: r.title,
      artist: (r['artist-credit'] || []).map(a => a.name || a.artist?.name).join(', '),
      album: (r.releases || []).map(rel => rel.title).slice(0, 3),
      length: r.length,
      score: r.score,
    }));
    res.json({ results: recs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rename
app.post('/api/rename', async (req, res) => {
  const { mode, sessionId, files, template, mbEnrich, renameNonMusic, translateTo } = req.body || {};
  if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'No files' });
  if (!template) return res.status(400).json({ error: 'No template' });

  const ops = [];
  for (const f of files) {
    try {
      let full;
      if (mode === 'seedbox') full = safeResolve(f);
      else full = path.join(UPLOAD_DIR, f);
      let info;
      const ext = path.extname(full).replace(/^\./, '').toLowerCase();
      const isAudio = AUDIO_EXTS.has(ext);
      if (isAudio) {
        info = await runMediaInfo(full);
      } else {
        info = { path: full, filename: path.basename(full), ext, isAudio: false, folderName: path.basename(path.dirname(full)), tags: {} };
      }
      info.isAudio = isAudio;
      info.folderName = info.folderName || path.basename(path.dirname(full));

      // Optional MB enrichment: take best match (audio only)
      if (mbEnrich && isAudio) {
        try {
          let a = info.tags.Artist || info.tags.artist;
          let t = info.tags.Title || info.tags.title;
          const al = info.tags.Album || info.tags.album;
          let freeText = null;
          if (!a && !t) {
            const base = path.basename(full, path.extname(full));
            // try to parse "NN - Artist - Title" / "Artist - Title" / "NN Title"
            const parts = base.split(/\s*[-_]\s*/).map(s => s.trim()).filter(Boolean);
            if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
              a = parts[1];
              t = parts.slice(2).join(' ');
            } else if (parts.length === 2) {
              a = parts[0];
              t = parts[1];
            } else {
              freeText = base.replace(/[_\-\.]+/g, ' ').replace(/\s+/g, ' ').trim();
            }
          }
          const data = await musicBrainzSearch(a, t, al, freeText);
          // pick best recording: prefer one with a studio album release
          const recs = data.recordings || [];
          let best = recs[0];
          if (recs.length > 1) {
            for (const r of recs) {
              if ((r.score || 0) < 95) continue;
              try {
                const full = await fetch(`https://musicbrainz.org/ws/2/recording/${r.id}?inc=releases+media&fmt=json`, {
                  headers: { 'User-Agent': 'beats-rename/1.0 ( https://github.com )', 'Accept': 'application/json' }
                }).then(x => x.json());
                const hasStudio = (full.releases || []).some(rel => rel.title && !/live/i.test(rel.title) && !/^\d{4}/.test(rel.title));
                if (hasStudio) { Object.assign(r, full); r.score = r.score || 100; best = r; break; }
              } catch (_) {}
            }
          }
          if (best && !best.releases) {
            try {
              const full = await fetch(`https://musicbrainz.org/ws/2/recording/${best.id}?inc=releases+media&fmt=json`, {
                headers: { 'User-Agent': 'beats-rename/1.0 ( https://github.com )', 'Accept': 'application/json' }
              }).then(x => x.json());
              if (full && full.id) Object.assign(best, full);
            } catch (_) {}
          }
          if (best && (best.score || 0) >= 95) {
            // confidence check: at least one meaningful word from search term must appear in result
            const term = (t || freeText || '').toLowerCase();
            const words = term.split(/\s+/).filter(w => w.length >= 4);
            const hay = ((best.title || '') + ' ' + (best['artist-credit'] || []).map(a=>a.name||a.artist?.name).join(' ')).toLowerCase();
            const confident = words.length === 0 || words.some(w => hay.includes(w));
            if (confident) {
              info = applyMB(info, best);
            }
          }
        } catch (_) {}
      }

      // Translation of track title
      if (isAudio && translateTo && translateTo !== 'none') {
        const orig = info.tags.Title || info.tags.title;
        if (orig) {
          const tr = await translateText(orig, translateTo);
          info.tags.TitleOriginal = orig;
          info.tags.Title = tr;
        }
      }

      let newName;
      if (!isAudio && renameNonMusic) {
        newName = info.folderName;
      } else if (!isAudio) {
        // non-audio without flag: skip
        ops.push({ file: f, ok: true, skipped: true, reason: 'Non-music skipped', newName: path.basename(full) });
        continue;
      } else {
        newName = renderTemplate(template, info);
      }
      if (!newName || !/[a-zA-Z0-9]/.test(newName)) {
        ops.push({ file: f, ok: true, skipped: true, reason: 'No usable metadata', newName: path.basename(full) });
        continue;
      }
      const dir = path.dirname(full);
      const finalExt = (info.ext || ext || path.extname(full).replace(/^\./, '')).toLowerCase();
      let finalName = newName.endsWith('.' + finalExt) ? newName : `${newName}.${finalExt}`;
      let newPath = path.join(dir, finalName);
      if (newPath === full) {
        ops.push({ file: f, ok: true, skipped: true, newName: finalName });
        continue;
      }
      // resolve conflicts by appending (n)
      if (fs.existsSync(newPath)) {
        const baseNoExt = finalName.replace(/\.[^.]+$/, '');
        const extDot = finalName.includes('.') ? '.' + finalName.split('.').pop() : '';
        let n = 1;
        while (fs.existsSync(path.join(dir, `${baseNoExt} (${n})${extDot}`))) n++;
        finalName = `${baseNoExt} (${n})${extDot}`;
        newPath = path.join(dir, finalName);
      }
      fs.renameSync(full, newPath);
      ops.push({ file: f, ok: true, oldName: path.basename(full), newName: finalName });
    } catch (e) {
      ops.push({ file: f, ok: false, error: e.message });
    }
  }
  res.json({ ops });
});

function applyMB(info, rec) {
  const tags = { ...info.tags };
  if (rec.title) tags.Title = rec.title;
  const artist = (rec['artist-credit'] || []).map(a => a.name || a.artist?.name).join(', ');
  if (artist) tags.Artist = artist;
  // prefer a studio album release (not live / date-prefixed)
  const releases = rec.releases || [];
  // prefer earliest non-live studio album
  const candidates = releases
    .filter(r => r.title && !/live/i.test(r.title))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const pick = candidates[0] || releases[0];
  if (pick && pick.title && !tags.Album) tags.Album = pick.title;
  if (rec.length && !info.duration) info.duration = (rec.length / 1000).toFixed(3);
  // track number / disc from release media
  const rel2 = (rec.releases || []).find(r => r.media && r.media.length) || rec.releases?.[0];
  if (rel2 && rel2.media && rel2.media.length) {
    const m = rel2.media[0];
    if (m.track && m.track.length) {
      const t = m.track.find(x => x.title && rec.title && x.title.toLowerCase() === rec.title.toLowerCase()) || m.track[0];
      if (t && t.number && !tags.Track) tags.Track = t.number;
    }
    if (m.position && !tags.DiscNumber) tags.DiscNumber = m.position;
    if (m['track-offset'] !== undefined && !tags.Track) tags.Track = String(parseInt(m['track-offset'], 10) + 1);
  }
  info.tags = tags;
  return info;
}

async function translateText(text, target) {
  if (!text || !target || target === 'none') return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'beats-rename/1.0' } });
    const data = await r.json();
    // data[0] is array of [translated, original, ...]
    const out = (data[0] || []).map(x => x[0]).join('');
    return out || text;
  } catch (_) {
    return text;
  }
}

function renderTemplate(tpl, info) {
  const tags = info.tags || {};
  const get = (key) => {
    const lower = key.toLowerCase();
    // normalize keys
    const map = {
      title: tags.Title || tags.title,
      title_orig: tags.TitleOriginal || tags.Title || tags.title,
      artist: tags.Artist || tags.artist || tags.Performer,
      album: tags.Album || tags.album,
      albumartist: tags.Album_Artist || tags.AlbumArtist || tags.albumartist,
      track: tags.Track_Position || tags['Track/Position'] || tags.TrackNumber || tags.Track,
      tracknumber: tags.Track_Position || tags['Track/Position'] || tags.TrackNumber || tags.Track,
      year: tags.Recorded_Date || tags.Date || tags.Year || tags.year,
      date: tags.Recorded_Date || tags.Date || tags.date,
      genre: tags.Genre || tags.genre,
      disc: tags.Part_Position || tags.DiscNumber || tags.Disc || tags.disc,
      composer: tags.Composer || tags.composer,
      filename: info.filename,
      ext: info.ext,
      duration: info.duration,
      folder: info.folderName,
    };
    return map[lower];
  };
  return tpl.replace(/\{([^}]+)\}/g, (_, spec) => {
    const parts = spec.split(':');
    const key = parts[0].trim();
    const pad = parts[1] ? parseInt(parts[1], 10) : 0;
    let val = get(key);
    if (val === undefined || val === null) val = '';
    val = String(val).trim();
    if (pad > 0 && /^\d+$/.test(val)) val = val.padStart(pad, '0');
    // sanitize filename chars
    val = val.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
    return val;
  }).replace(/\s{2,}/g, ' ').trim();
}

// Download renamed files as zip (upload mode)
app.get('/api/download/:sessionId', (req, res) => {
  const dir = path.join(UPLOAD_DIR, req.params.sessionId);
  if (!fs.existsSync(dir)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="renamed-${req.params.sessionId}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  archive.directory(dir, false);
  archive.finalize();
});

// Config
app.get('/api/config', (req, res) => {
  res.json({ rootDir: ROOT_DIR, maxUploadMB: MAX_UPLOAD_MB, mode: process.env.MODE || 'auto' });
});

app.listen(PORT, () => {
  console.log(`beats-rename listening on http://0.0.0.0:${PORT}`);
  console.log(`ROOT_DIR=${ROOT_DIR}`);
  console.log(`AUTH_USER=${AUTH_USER}`);
  if (!process.env.AUTH_PASS) {
    console.log(`AUTH_PASS (generated, stored in .auth): ${AUTH_PASS}`);
  }
  console.log('Set AUTH_USER / AUTH_PASS env vars to override.');
});
