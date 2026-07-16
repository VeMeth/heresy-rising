# Heresy Rising — Agent Handoff (root)

> For OpenCode / coding agents working in this repo. For the game's design
> brief, v1 scope, and locked Q&A decisions, read `docs/AGENTS.md` first
> (it is the design handoff; this file is the developer-workflow handoff).

## Project shape

Two service packages + a shared data dir + Playwright e2e:

| Path | Purpose | Entrypoint |
|---|---|---|
| `heresy-server/` | Express + Socket.IO API, SQLite, game rules | `src/index.js` (also `createHeresyServer()` for tests) |
| `heresy-client/` | Vue 3 + Vite SPA | `src/main.js` → `App.vue` |
| `data/` | Engine-readable game config (JSON), and the live SQLite DB on the host | `roles-40k.json`, `composition.json`, `drift.json`, `scenarios/` |
| `tests/e2e/` | Playwright suite (auto-starts the server) | `playwright.config.js` |
| `site/` | VitePress player manual, served by the client container at `/docs/` | n/a (built into client image) |

Engine reads **only** from `data/*.json`. The spec markdown under
`docs/specs/mechanics/` is **mirror** files of a sister project repo —
they have a warning banner at the top and a sync rule. If you change
game numbers, edit the JSON, not the markdown, and flag mirror drift to
the owner.

## First-time setup

```bash
npm install                       # root devDeps (concurrently, vitepress, playwright)
npm --prefix heresy-server install
npm --prefix heresy-client install
cp .env.example .env              # then edit ADMIN_PASSWORD before any public exposure
```

`npm run dev` starts both services concurrently (server on `:4100`,
client on `:5174` per `heresy-client/vite.config.js`, with a Vite proxy
to `:4100`). No build step needed for development. (The README says
`:5173`; the config wins.)

## Tests

No lint, no format, no typecheck. JS only.

- **Server unit tests** (fast, no network): `npm test` from the repo
  root, or `npm --prefix heresy-server test`. Uses `node --test` and
  creates a fresh temp SQLite DB per test. `heresy-server/test/` is the
  suite; tests reach into the game manager via `createHeresyServer()`.
- **E2E** (`tests/e2e/`): `npm run test:e2e` from root. The Playwright
  config auto-starts the server on `127.0.0.1:4100` and uses
  `data/heresy-rising-e2e.db`. `reuseExistingServer: !process.env.CI`
  means **if port 4100 is already taken, the suite will talk to
  whatever is there** — stop the dev server or Docker stack first.
  Playwright workers are pinned to 1.
- There is no client test suite.

## The live-DB footgun

The docker-compose mount `./data:/usr/src/app/data` is the **live
deployment's database**. If you run the server locally **on the host**
(not in Docker) without overriding `GAME_DB_PATH`, it writes to
`./data/heresy-rising.db` — the same file the live container is using.
Either override `GAME_DB_PATH` to a temp file, or run the server in the
container. E2E tests do this correctly with `GAME_DB_PATH=./data/heresy-rising-e2e.db`.

## Configuration / env

`.env` is gitignored; `.env.example` is the safe-to-commit template.
Meaningful knobs (defaults in compose):

- `ADMIN_PASSWORD` — required in production. If unset or equal to the
  shipped default, the server logs `[SECURITY] Refusing admin access…`
  and every `/api/admin/*` endpoint returns 503 (fail-closed). The
  `/api/admin/login` route additionally has a strict per-IP limit
  (10 attempts / 15 min) on top of the global limiter.
- `TRUST_PROXY` — must be `true` in this stack. The server is always
  behind the nginx client container, and rate limiting / per-client
  IP accounting depend on trusting `X-Forwarded-*`. With it off, every
  request appears to come from the nginx IP and all clients share one
  rate-limit bucket.
- `ALLOWED_ORIGINS` — comma-separated, no wildcards in prod. The server
  also has a same-origin fallback (`origin.host === req.headers.host`),
  so for a single-origin / Cloudflare-tunnel deployment this list is
  decorative; it matters only if you need to allow **additional**
  cross-origin callers (e.g. a separate dev frontend).
- `GAME_DB_PATH` — DB file inside the container. Mounted to the host's
  `./data/` via the compose volume; do not commit `data/*.db*`.
- `RATE_LIMIT_MAX` — global limit per IP per minute. E2E sets `1000`
  to avoid noise; the per-IP admin-login limit is independent.

## Docker deploy

Three compose files, all at the repo root and all using
`version: '3.8'` (so the legacy `docker-compose` v1 CLI works as well
as the v2 plugin):

- `docker-compose.yml` — `docker compose up --build` (builds and
  pushes to the `ghcr.io/vemeth/*` tags).
- `docker-compose.auto.yml` — pulls prebuilt images from GHCR.
- `docker-compose.manual.yml` — builds local `:local` tags. **Use this
  for local iteration** — no registry push, no external pull.

After any change to `heresy-server/src/`, `heresy-client/src/`, the
nginx config, or the data JSON, the containers need `--build`:

```bash
docker compose -f docker-compose.manual.yml up -d --build --force-recreate
```

## Commit style

Conventional Commits with a scope when the change is local:

- `fix(data): …` — gameplay numbers in `data/*.json`
- `fix(server): …` / `fix(client): …` / `fix(compose): …` / `fix(docs): …`
- `chore(security): …` — hardening (CSP, rate limits, fail-closed)
- `feat: …` / `docs: …` for cross-cutting or non-code

Do not commit secrets. `data/`, `data/logs/`, `*.db*`, `node_modules/`,
`site/_site/`, `playwright-report/`, `test-results/`, and `.opencode/`
are all gitignored.

## Things that are easy to get wrong

- **Don't edit `docs/specs/mechanics/*.md` to change game numbers.**
  Those are mirrors of a sister repo's source of truth. Edit the JSON
  in `data/`.
- **Don't run the server on the host without `GAME_DB_PATH`** — see
  the live-DB footgun above.
- **Don't open port 4100 publicly.** It is bound to `127.0.0.1` in
  compose; nginx (port 80 inside the client container, mapped to
  `CLIENT_PORT` on the host) is the only public surface.
- **Player codes are bearer credentials.** They are stored in
  `localStorage` by the client and passed as `playerCode` on every
  socket call. Treat them like passwords: never log them, never commit
  them, never put them in error messages sent to other players.
- **The `components/game/` directory is dead code** from a prior
  card-game project. It is not imported by `App.vue` and is
  tree-shaken out of the prod bundle, so it is not a runtime
  concern — but don't waste time trying to wire it in.
- **`docs/AGENTS.md` is the design handoff** and contains the v1
  locked decisions (Q&A numbers, locked Qs, open Qs, "do not build
  this" list). Read it before designing new mechanics.
