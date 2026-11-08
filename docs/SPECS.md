# Specifications — Beats Rename

## Overview
WebUI Node.js app for renaming music files using MediaInfo tags and MusicBrainz metadata. Supports local drag-and-drop and seedbox home-folder browsing.

## Behavior
- `GET /api/list?path=` — list directory under ROOT_DIR; path traversal blocked.
- `POST /api/upload` — multipart upload to per-session temp dir; returns sessionId + files.
- `POST /api/analyze` — run MediaInfo on files (mode: upload|seedbox); returns tags; non-audio flagged.
- `POST /api/lookup` — MusicBrainz recording search by artist/title/album.
- `POST /api/rename` — rename files per template; MB enrichment optional; non-music renamed to folder name if flag set; conflicts numbered.
- `GET /api/download/:sessionId` — ZIP of session dir.
- `GET /api/config`, `GET /api/health`, `GET /api/me`.
- `POST /api/login`, `POST /api/logout`.

## Rename template tokens
`{track}` (or `{track:N}` zero-pad), `{title}`, `{artist}`, `{album}`, `{albumartist}`, `{year}`, `{genre}`, `{disc}`, `{composer}`, `{filename}`, `{ext}`, `{duration}`, `{folder}`.

## Non-music handling
Files whose extension is not in AUDIO_EXTS are renamed to parent folder basename + original extension when `renameNonMusic` is true.

## Security
- Auth required on all /api/* (cookie session, 7-day, rate-limited).
- Browsing restricted to ROOT_DIR.
- No secrets logged.

## Constraints
- Node >= 18, mediainfo on PATH, network for MusicBrainz (optional).