# TODO — Beats Rename

- Add automated tests (renderTemplate, safeResolve, auth middleware)
- Graceful shutdown (SIGTERM/SIGINT) to flush logs
- Consider AcoustID/fpcalc integration for fingerprint-based MB lookup
- Optional: migrate to ESM + TypeScript + pnpm (per AGENTS.md defaults) — only if requested
- Add Dockerfile for containerized deploy
- Add CSRF token for login form (currently SameSite=Strict mitigates)