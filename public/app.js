'use strict';

const $ = (id) => document.getElementById(id);
const log = (msg) => { const el = $('log'); if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; } };

// ---------- auth ----------
const _origFetch = window.fetch;
window.fetch = async (...args) => {
  const r = await _origFetch(...args);
  if (r.status === 401) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
    if (url && url.startsWith('/api') && !url.includes('/api/login')) {
      $('loginOverlay').classList.remove('hidden');
    }
  }
  return r;
};
async function checkAuth() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) { $('loginOverlay').classList.add('hidden'); return true; }
  } catch (_) {}
  $('loginOverlay').classList.remove('hidden');
  return false;
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('loginUser').value, password: $('loginPass').value }),
    });
    if (!r.ok) { const d = await r.json().catch(()=>({})); $('loginErr').textContent = d.error || 'Login failed'; return; }
    $('loginOverlay').classList.add('hidden');
    $('loginPass').value = '';
    init();
  } catch (err) { $('loginErr').textContent = err.message; }
});

const state = {
  mode: 'local', // 'local' | 'seed'
  sessionId: null,
  files: [], // list of relative paths in upload mode
  seedSelected: new Set(),
  seedPath: '',
  analyzed: {}, // file -> info
  lastRename: null,
};


// Mode switching
$('modeLocal').addEventListener('click', () => setMode('local'));
$('modeSeed').addEventListener('click', () => setMode('seed'));
function setMode(m) {
  state.mode = m;
  $('modeLocal').classList.toggle('active', m === 'local');
  $('modeSeed').classList.toggle('active', m === 'seed');
  $('localPanel').classList.toggle('hidden', m !== 'local');
  $('seedPanel').classList.toggle('hidden', m !== 'seed');
}

// Dropzone
const dz = $('dropzone');
const fi = $('fileInput');
dz.addEventListener('click', () => fi.click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles(e.dataTransfer.files); });
fi.addEventListener('change', e => handleFiles(e.target.files));

async function handleFiles(fileList) {
  const fd = new FormData();
  const arr = Array.from(fileList);
  arr.forEach(f => fd.append('files', f));
  $('uploadStatus').textContent = `Uploading ${arr.length} files...`;
  try {
    const url = '/api/upload' + (state.sessionId ? '?sessionId=' + encodeURIComponent(state.sessionId) : '');
    const r = await fetch(url, { method: 'POST', body: fd });
    const data = await r.json();
    state.sessionId = data.sessionId;
    state.files = data.files.map(f => f.path);
    $('uploadStatus').textContent = `Uploaded ${data.files.length} files.`;
    log(`Uploaded ${data.files.length} files (session ${state.sessionId})`);
    renderTable();
  } catch (e) {
    $('uploadStatus').textContent = 'Upload failed: ' + e.message;
  }
}

// Seedbox browser
async function loadDir(p) {
  const r = await fetch('/api/list?path=' + encodeURIComponent(p || ''));
  const data = await r.json();
  if (data.error) { log('List error: ' + data.error); return; }
  state.seedPath = data.path;
  $('curPath').textContent = data.path;
  const ul = $('fileList');
  ul.innerHTML = '';
  data.entries.forEach(e => {
    const li = document.createElement('li');
    li.className = e.isDir ? 'dir' : 'file';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.path = e.path;
    cb.dataset.isdir = e.isDir ? '1' : '0';
    if (e.isDir) {
      // folder: checked if all its files are selected (approx: any selected)
      cb.checked = false;
    } else {
      cb.checked = state.seedSelected.has(e.path);
    }
    cb.addEventListener('change', async () => {
      if (e.isDir) {
        // expand folder recursively
        try {
          const r = await fetch('/api/list-recursive?path=' + encodeURIComponent(e.path));
          const data = await r.json();
          const files = data.files || [];
          if (cb.checked) {
            files.forEach(f => state.seedSelected.add(f));
          } else {
            files.forEach(f => state.seedSelected.delete(f));
          }
          updateSelCount();
          renderTable();
        } catch (err) { log('Folder expand error: ' + err.message); cb.checked = !cb.checked; }
      } else {
        if (cb.checked) state.seedSelected.add(e.path); else state.seedSelected.delete(e.path);
        updateSelCount();
        renderTable();
      }
    });
    const span = document.createElement('span');
    span.textContent = e.name + (e.isDir ? '/' : '');
    span.addEventListener('click', () => { if (e.isDir) loadDir(e.path); });
    li.appendChild(cb);
    li.appendChild(span);
    ul.appendChild(li);
  });
  updateSelCount();
}
$('goUp').addEventListener('click', () => {
  const parts = state.seedPath.split('/').filter(Boolean);
  parts.pop();
  loadDir(parts.join('/'));
});
$('selectAll').addEventListener('click', () => {
  document.querySelectorAll('#fileList input[type=checkbox]:not(:disabled)').forEach(cb => { cb.checked = true; state.seedSelected.add(cb.dataset.path); });
  updateSelCount();
});
$('clearSel').addEventListener('click', () => {
  state.seedSelected.clear();
  document.querySelectorAll('#fileList input[type=checkbox]').forEach(cb => cb.checked = false);
  updateSelCount();
});
function updateSelCount() { $('selCount').textContent = state.seedSelected.size + ' selected'; }

async function loadPresets() {
  try {
    const r = await fetch('/api/presets');
    const data = await r.json();
    const sel = $('presetSelect');
    sel.innerHTML = '';
    (data.presets || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name + (p.builtin ? ' (built-in)' : '');
      opt.dataset.template = p.template;
      opt.dataset.builtin = p.builtin ? '1' : '0';
      sel.appendChild(opt);
    });
  } catch (e) { log('Preset load error: ' + e.message); }
}
function init() {
  loadDir('');
  loadPresets();
}
// boot
checkAuth().then(ok => { if (ok) init(); });

// Analyze
$('analyzeBtn').addEventListener('click', async () => {
  const files = currentFiles();
  if (!files.length) { log('No files selected'); return; }
  log('Analyzing ' + files.length + ' files...');
  try {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: state.mode === 'seed' ? 'seedbox' : 'upload', files, translateTo: $('translateTo').value }),
    });
    const data = await r.json();
    (data.results || []).forEach(res => {
      if (res.ok) state.analyzed[res.file] = res.info;
      else log('Analyze failed ' + res.file + ': ' + res.error);
    });
    log('Analyzed ' + (data.results || []).filter(r => r.ok).length + ' files');
    renderTable();
  } catch (e) { log('Analyze error: ' + e.message); }
});

function currentFiles() {
  if (state.mode === 'seed') return Array.from(state.seedSelected);
  return state.files;
}

// Render table
function renderTable() {
  const tbody = document.querySelector('#metaTable tbody');
  tbody.innerHTML = '';
  const files = currentFiles();
  files.forEach(f => {
    const info = state.analyzed[f];
    const tags = info ? info.tags : {};
    const tr = document.createElement('tr');
    const name = info ? info.filename : f.split('/').pop();
    const title = tags.Title || tags.title || '';
    const artist = tags.Artist || tags.artist || tags.Performer || '';
    const album = tags.Album || tags.album || '';
    const track = tags.Track_Position || tags['Track/Position'] || tags.TrackNumber || tags.Track || '';
    const year = tags.Date || tags.Year || tags.year || '';
    const preview = info ? previewName(info) : '';
    tr.innerHTML = `
      <td><input type="checkbox" data-file="${escapeAttr(f)}" checked></td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(artist)}</td>
      <td>${escapeHtml(album)}</td>
      <td>${escapeHtml(track)}</td>
      <td>${escapeHtml(year)}</td>
      <td class="preview">${escapeHtml(preview)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function previewName(info) {
  const tpl = $('template').value;
  // reuse server render? do client-side approx by calling analyze? We'll just show after rename. For preview, call a small render via template tokens locally.
  return renderClient(tpl, info);
}

function renderClient(tpl, info) {
  const tags = info.tags || {};
  const get = (key) => {
    const lower = key.toLowerCase();
    const map = {
      title: tags.Title || tags.title,
      title_orig: tags.TitleOriginal || tags.Title || tags.title,
      artist: tags.Artist || tags.artist || tags.Performer,
      album: tags.Album || tags.album,
      albumartist: tags.Album_Artist || tags.AlbumArtist,
      track: tags.Track_Position || tags['Track/Position'] || tags.TrackNumber || tags.Track,
      tracknumber: tags.Track_Position || tags['Track/Position'] || tags.TrackNumber || tags.Track,
      year: tags.Recorded_Date || tags.Date || tags.Year,
      date: tags.Recorded_Date || tags.Date,
      genre: tags.Genre,
      disc: tags.Part_Position || tags.DiscNumber || tags.Disc,
      composer: tags.Composer,
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
    val = val.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
    return val;
  }).replace(/\s{2,}/g, ' ').trim();
}

$('template').addEventListener('input', renderTable);

// Presets
$('presetLoadBtn').addEventListener('click', () => {
  const sel = $('presetSelect');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.template) {
    $('template').value = opt.dataset.template;
    renderTable();
    log('Loaded preset: ' + opt.value);
  }
});
$('presetSaveBtn').addEventListener('click', async () => {
  const name = prompt('Preset name:');
  if (!name) return;
  try {
    const r = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template: $('template').value }),
    });
    const data = await r.json();
    if (!r.ok) { log('Save failed: ' + (data.error || r.status)); return; }
    await loadPresets();
    // select the new preset
    const sel = $('presetSelect');
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === name) { sel.selectedIndex = i; break; }
    }
    log('Saved preset: ' + name);
  } catch (e) { log('Save error: ' + e.message); }
});
$('presetDeleteBtn').addEventListener('click', async () => {
  const sel = $('presetSelect');
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  if (opt.dataset.builtin === '1') { log('Cannot delete built-in preset'); return; }
  if (!confirm('Delete preset "' + opt.value + '"?')) return;
  try {
    const r = await fetch('/api/presets/' + encodeURIComponent(opt.value), { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok) { log('Delete failed: ' + (data.error || r.status)); return; }
    await loadPresets();
    log('Deleted preset: ' + opt.value);
  } catch (e) { log('Delete error: ' + e.message); }
});
$('translateTo').addEventListener('change', () => {
  const files = currentFiles();
  if (files.length) $('analyzeBtn').click();
});

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(s) { return String(s).replace(/"/g,'&quot;'); }

// Rename
$('renameBtn').addEventListener('click', async () => {
  const files = currentFiles().filter(f => {
    const cb = document.querySelector(`#metaTable input[data-file="${CSS.escape(f)}"]`);
    return !cb || cb.checked;
  });
  if (!files.length) { log('No files selected'); return; }
  const tpl = $('template').value;
  log('Renaming ' + files.length + ' files...');
  try {
    const r = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: state.mode === 'seed' ? 'seedbox' : 'upload',
        sessionId: state.sessionId,
        files,
        template: tpl,
        mbEnrich: $('mbEnrich').checked,
        renameNonMusic: $('renameNonMusic').checked,
        translateTo: $('translateTo').value,
      }),
    });
    const data = await r.json();
    (data.ops || []).forEach(op => {
      if (op.ok) {
        if (op.skipped) log(`skip ${op.newName}`);
        else log(`OK ${op.oldName} -> ${op.newName}${op.translated ? ' (translated via ' + (op.translateProvider||'?') + ')' : (op.translateError ? ' [translate failed: ' + op.translateError + ']' : '')}`);
      } else {
        log(`FAIL ${op.file}: ${op.error}`);
      }
    });
    state.lastRename = data.ops;
    // uncheck all rows and clear selections after rename
    document.querySelectorAll('#metaTable input[type=checkbox]').forEach(cb => cb.checked = false);
    state.seedSelected.clear();
    state.analyzed = {};
    if (state.mode === 'seed') {
      // reload directory to reflect new names
      loadDir(state.seedPath);
      renderTable();
    } else {
      // local: clear uploaded list (files renamed in session dir; download zip)
      state.files = [];
      renderTable();
    }
    updateSelCount();
    if (state.mode === 'local' && state.sessionId) $('downloadBtn').classList.remove('hidden');
  } catch (e) { log('Rename error: ' + e.message); }
});

$('downloadBtn').addEventListener('click', () => {
  if (state.sessionId) window.location.href = '/api/download/' + state.sessionId;
});
