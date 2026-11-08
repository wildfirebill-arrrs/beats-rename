# Beats Rename

WebUI music file renamer. Uses **MediaInfo** for tags and **MusicBrainz** for canonical metadata. Runs as a Node.js app (works on Ultra.cc seedbox via unofficial installer).

## Features
- Drag & drop local files (upload -> analyze -> rename -> download ZIP)
- Seedbox mode: browse your home folder, select audio files
- MediaInfo tag extraction (title, artist, album, track, year, genre, disc, etc.)
- MusicBrainz enrichment (best-match recording -> canonical tags + track number)
- Flexible rename template with tokens and zero-padding
- Path-traversal safe browsing restricted to ROOT_DIR

## Tokens
`{track}` `{track:2}` (zero-pad) `{title}` `{artist}` `{album}` `{albumartist}` `{year}` `{genre}` `{disc}` `{composer}` `{filename}` `{ext}` `{duration}`

Example template: `{track:2} - {artist} - {title}`

## Requirements
- Node.js >= 18 (Ultra.cc: unofficial Node.js installer)
- `mediainfo` (or `MediaInfo`) on PATH
- Internet access for MusicBrainz (optional)

## Install (local)
```bash
npm install
npm start
# open http://localhost:3000
```

## Install (Ultra.cc seedbox)
1. Install Node.js via the unofficial language installer: https://docs.ultra.cc/unofficial-language-installers/install-nodejs
2. Install mediainfo if not present (check with `mediainfo --version`). On Ultra, mediainfo is usually available; if not, open a ticket or install via the generic software installer.
3. Upload this folder to your slot (e.g. `~/apps/beats-rename`).
4. `cd ~/apps/beats-rename && npm install --production`
5. Run: `PORT=3000 ROOT_DIR=$HOME node server.js`
   - Or use pm2/screen to keep it running.
6. Access via your slot's reverse proxy / port.

### Run as a service (screen)
```bash
screen -S beats -dm bash -c 'cd ~/apps/beats-rename && PORT=3000 ROOT_DIR=$HOME node server.js'
```

### Environment variables
- `PORT` (default 3000)
- `ROOT_DIR` (default $HOME) - root for seedbox browsing
- `MODE` (auto)
- `MAX_UPLOAD_MB` (default 200)
- `AUTH_USER` (default admin)
- `AUTH_PASS` (auto-generated if unset)
- `AUTH_SECRET` (auto-generated if unset)
- `FORCE_SECURE` (set 1 for HTTPS)

## Security / Authentication
- All `/api/*` routes require login. On first run without `AUTH_PASS`, a random password is generated and printed to the console and saved to `.auth` (mode 0600). Username defaults to `admin`.
- Set `AUTH_USER` and `AUTH_PASS` env vars to use your own credentials (recommended for production).
- Optional `AUTH_SECRET` for signing session cookies; auto-generated and persisted to `.secret` if unset.
- Sessions are httpOnly, SameSite=Strict cookies, 7-day expiry. Login is rate-limited (8 attempts/min/IP).
- For HTTPS behind a reverse proxy, set `FORCE_SECURE=1` (or rely on `X-Forwarded-Proto`).
- Never commit `.auth` / `.secret` (gitignored).

## Security
- Browsing restricted to ROOT_DIR (path traversal blocked).
- Uploads stored in OS temp dir per session.
- MusicBrainz requests include a User-Agent per their policy.

## Notes
- AcoustID fingerprinting is not included (requires fpcalc/chromaprint). MusicBrainz lookup uses metadata search.
- Renames are performed in place on the seedbox; consider backing up first.

## AI Assistance Disclosure

This project was developed with assistance from an AI coding agent (Claude). All code was reviewed and tested by the maintainer. AI was used for scaffolding, debugging, and documentation generation.
