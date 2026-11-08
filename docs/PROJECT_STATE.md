# Project State — Beats Rename

## Status
Working. WebUI music file renamer with MediaInfo tags, MusicBrainz enrichment, non-music rename, and password auth.

## What works
- Drag & drop local files (upload -> analyze -> rename -> download ZIP)
- Seedbox mode: browse home folder, select audio + non-music files
- MediaInfo tag extraction (title, artist/performer, album, track position, year, genre, disc)
- MusicBrainz enrichment (best-match recording, studio-album preference, confidence-gated)
- Rename templates with tokens and zero-padding
- Non-music files renamed to parent folder name (+ conflict numbering)
- Path-traversal-safe browsing restricted to ROOT_DIR
- Cookie-based login/password auth with rate limiting

## What doesn't / known limitations
- AcoustID fingerprinting not included (requires fpcalc/chromaprint)
- MusicBrainz search uses metadata/filename; may mis-match obscure tracks
- No test suite (manual smoke tests only)
- No HTTPS termination in-app (rely on reverse proxy; set FORCE_SECURE=1)
- Multer 2.x; no file size dedup

## Next steps
- Add basic tests (vitest) for renderTemplate and safeResolve
- Consider migrating to ESM/TS + pnpm per AGENTS.md defaults (only if requested)
- Add graceful shutdown handler

## Recent decisions
- CommonJS + npm kept to match existing seedbox environment
- Auth credentials persisted to .auth/.secret (gitignored) when env vars absent
- Non-music detection by extension set AUDIO_EXTS