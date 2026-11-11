# Project State — Beats Rename

## Status
Working. WebUI music file renamer with MediaInfo tags, MusicBrainz enrichment, translation, non-music rename, presets, bulk folders, and password auth. 0 npm vulnerabilities.

## What works
- Drag & drop local files (upload -> analyze -> rename -> download ZIP)
- Seedbox mode: browse home folder, select audio + non-music + bulk folders
- MediaInfo tag extraction (title, artist/performer, album, track position, year, genre, disc)
- MusicBrainz enrichment (best-match recording, studio-album preference, confidence-gated)
- Rename templates with tokens and zero-padding
- Persistent preset templates (save/load/delete, stored in ~/.beats-rename)
- Track title translation to 12 languages (Google + MyMemory + custom TRANSLATE_URL)
- Non-music files renamed to parent folder name (+ conflict numbering)
- Path-traversal-safe browsing restricted to ROOT_DIR
- Cookie-based login/password auth with rate limiting
- Favicon + social preview card

## What doesn't / known limitations
- AcoustID fingerprinting not included (requires fpcalc/chromaprint)
- Translation may be blocked on some seedboxes (use TRANSLATE_URL)
- No automated test suite (manual smoke tests only)
- No HTTPS termination in-app (rely on reverse proxy; set FORCE_SECURE=1)

## Next steps
- Add vitest tests for renderTemplate and safeResolve
- Graceful shutdown handler
- Consider LibreTranslate self-hosted for seedbox translation

## Recent decisions
- CommonJS + npm kept to match existing seedbox environment
- Auth credentials persisted to .auth/.secret (gitignored) when env vars absent
- Non-music detection by extension set AUDIO_EXTS
- Presets stored in user home (~/.beats-rename) to survive upgrades
- adm-zip used instead of archiver (0 vulns)