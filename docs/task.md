# Task Checklist — Beats Rename

- [x] Create Express server with routes
- [x] MediaInfo JSON parsing (audio + non-audio detection)
- [x] MusicBrainz lookup + enrichment with confidence gating
- [x] Rename template engine with zero-padding
- [x] Non-music rename to folder name (+ conflict numbering)
- [x] Path-traversal-safe directory listing
- [x] Drag & drop upload + ZIP download
- [x] WebUI (mode switch, table, log, preview, presets, translate)
- [x] Cookie-based auth with rate limiting
- [x] Persistent preset templates (save/load/delete)
- [x] Track title translation (Google + MyMemory + custom endpoint)
- [x] Bulk folder selection (recursive expand)
- [x] Favicon + social preview card
- [x] README with env vars + AI Assistance Disclosure + screenshots
- [x] AGENTS.md + docs (PROJECT_STATE, SPECS, task, TODO)
- [x] 0 npm vulnerabilities (adm-zip, removed musicbrainz-api)
- [ ] Add vitest tests for renderTemplate / safeResolve
- [ ] Graceful shutdown handler