# Node.js / Express Backend Rules

Drop-in: copy into a project root as `AGENTS.md`.

## Workflow

- On starting a new thread in an existing project, restore context first: read `docs\PROJECT_STATE.md`, `docs\task.md`, and `TODO.md`, then query the mempalace (`mempalace_diary_read` for recent continuity; `mempalace_search` / `mempalace_kg_query` for prior decisions) before answering.
- After substantive progress (or when ending a session), update those docs and persist a checkpoint (`mempalace_checkpoint` or `mempalace_diary_write`) so the next thread can continue.
- Never guess from model memory when the palace might know: search first, quote stored content verbatim.
- On new projects, create `docs\PROJECT_STATE.md`, `docs\SPECS.md`, `docs\task.md`, `TODO.md`, `AGENTS.md`, `README.md` (README ends with the AI Assistance Disclosure).

## Defaults (new projects)

- Node 20+ LTS; ESM; TypeScript with `strict: true` for anything non-trivial.
- pnpm over npm/yarn; zod for runtime validation at every boundary.
- Express, Fastify, or Hono for HTTP; Prisma/Drizzle/Knex for persistence.
- vitest for tests; biome or eslint+prettier for lint/format.

## Verification

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm build           # when a build step exists
```

## Conventions

- No handler directly talks to the DB — split into route → service → repo layers.
- Async errors handled: Express 5 forwards rejects, but do not leave dangling promises.
- GC-friendly: no unbounded in-memory caches; use proper stores if you cache.
- Log-structured: use pino/bunyan, never console.log soup; pass a request id.

## Pitfalls

- The event loop is one thread — never `while (true)` busy-wait, big sync loops, or CPU-heavy work inline.
- Beware `process.exit` swallowing flush of pending writes; use graceful shutdown.
- Watch out for prototype pollution and ReDoS in user input; validate not just types.
- Version the lockfile manager — never mix package-lock/pnpm-lock/yarn.lock.

## Project-specific notes

- This project currently uses **npm** + CommonJS JavaScript (not pnpm/ESM/TypeScript). Do not migrate package manager or module system without an explicit request; match the existing style. The defaults above apply to new work only.
- Runtime: Node >= 18 (Ultra.cc seedbox). Uses `MediaInfo` CLI and MusicBrainz HTTP API.
- Auth: cookie-based sessions, see `README.md` Security section. Credentials in `.auth`/`.secret` (gitignored).