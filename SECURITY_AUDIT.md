# Security Audit — Heresy Rising

Scope: full repository, all source files across `heresy-server`, `heresy-client`,
`bot-manager`, `heresy-sim`, root-level config/Docker/CI files, static data,
generated assets, and documentation. Audit performed by parallel review of each
subsystem (every listed file read in full), followed by direct verification,
fixes, and test runs against the actual codebase.

No SQL injection, no `eval`/`Function`/`child_process` misuse, no committed
real secrets (verified via `git log --all -- .env`), and no missing
authentication on admin/bot/sim control endpoints were found anywhere in the
repository. All findings below are either fixed in this pass or documented
with a justification for accepting the risk as-is.

Fixes applied were verified against the existing test suites: **193/193**
passing in `heresy-server`, **145/145** passing in `bot-manager`, and a clean
production `vite build` for `heresy-client`.

---

## Summary of fixes applied

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `heresy-server/src/heresyGameManager.js` (`start()`) | `dayMs`/`nightMs`/`maxDrift` had a floor but no ceiling (host could set e.g. `1e15` and soft-lock their own lobby forever) | Added the same `[10s/1s, 24h]` / `[1,100]` upper bounds already used by `configure()` |
| 2 | `heresy-server/src/index.js` (`game:spectate`) | Custom `playerCode` bypassed `normalizePlayerCode`, unlike every other handler | Routed through `normalizePlayerCode` before storing on `socket.data.playerCode` |
| 3 | `heresy-server/Dockerfile` | `npm install --omit=dev` instead of lockfile-exact install | Changed to `npm ci --omit=dev` |
| 4 | `heresy-server/.dockerignore` | Did not exclude `.env`/`test` (latent gap; current `COPY` allow-list doesn't hit this today) | Added `.env`, `.env.*`, `test` |
| 5 | `bot-manager/src/persistence.js` | `data.id`/`playerCode` (engine-supplied, cross-service trust boundary) used unsanitized in `join(this.dir, ...)` — a malicious/misconfigured engine could path-traverse via `..` | Added `safeFileId()`: `basename()` + `[A-Za-z0-9_-]` allowlist, applied in `save()` and `remove()` |
| 6 | `bot-manager/src/actionDispatch.js` | Vote `justification` and forge `body` had no length cap, unlike the chat path's `.slice(0,1000)` | Added the same `.slice(0, 1000)` cap to both |
| 7 | `heresy-client/src/components/GameView.vue` | Chat message bodies rendered via `v-html` (safe today only because of correct escape-then-wrap ordering in `renderMessageBody`/`escapeHtml` — a fragile, structurally-risky pattern for fully player-controlled text) | Replaced with `messageSegments()` + `v-for` over real template elements (mention spans / plain text), relying on Vue's built-in interpolation escaping instead of manual HTML string-splicing. Removes the `v-html` sink entirely. |
| 8 | `heresy-client/src/components/DebugLog.vue`, `PlayerSidebar.vue` | Orphaned, unimported components left over from an unrelated project template (confirmed via repo-wide grep — never referenced) | Deleted (dead code, not part of the shipped bundle, but removed to shrink audit surface / avoid confusion) |

## Accepted risks (no code change — justification below)

| # | File(s) | Issue | Justification |
|---|---|---|---|
| 9 | `heresy-server/src/socketRateLimiter.js` + `index.js` | Per-event rate limits key on `socket.id`; an attacker can reset every bucket by reconnecting on a fresh socket | Same class of risk as any per-connection limiter; mitigating it fully requires per-IP/account limiting or a connection cap, which is a larger architectural change than this pass's scope. `game:create`/`game:kick`/`chat:send` etc. are still bounded per-socket, and `hr_games` rows are bounded by admin cleanup tooling. Flagged for a follow-up (see Recommendations). |
| 10 | `heresy-server/src/index.js` (`trust proxy`) | If `TRUST_PROXY=true` is set behind a reverse proxy that doesn't overwrite `X-Forwarded-For`, a client can spoof it to weaken `adminLoginLimiter` | This is standard Express/express-rate-limit behavior tied to correct reverse-proxy configuration, not a code defect. `TRUST_PROXY` defaults to `false`/off; operators enabling it are expected to run behind a proxy that sanitizes forwarded headers. Documented here for deployment awareness. |
| 11 | `heresy-server/src/adminBackup.js`, `src/leaderboard.js` | Both modules are fully unreferenced dead code (not imported anywhere in `index.js`/`heresyGameManager.js`) | No live attack surface today — not wired to any route. Left in place rather than deleted since they may be intentionally staged for future admin tooling; both already contain proper sanitization (`sanitizeLabel`, `sanitizeUsername`, parameterized SQL) if/when activated. |
| 12 | `bot-manager/src/prompts/assemble.js`, `prompts/gameState.js` | Player-controlled chat text and names are concatenated verbatim into LLM prompts — a malicious player could attempt prompt injection (e.g. fake "SYSTEM" instructions in chat) | Accepted as an inherent property of a social-deduction game where manipulating other players (including bots) via chat is the actual gameplay. Blast radius is small: the only "secret" in-prompt is `botIds` (labelled do-not-reveal), and every LLM action is independently re-validated against real game state by `validator.js` (role/verb/target/tier legality) before dispatch — a successful injection cannot cause code execution, illegal actions, or cross-session effects. |
| 13 | `heresy-client/src/components/AdminView.vue` | Admin password is cached in `sessionStorage` (cleartext) and replayed as a header on every `/api/admin/*` call | Enforcement is correctly server-side (`adminFetch` always sends the real header; the client `authenticated` flag is cosmetic only). Replacing password-replay with a server-issued session token would be a backend auth-model change beyond this pass's scope; no exploitable XSS sink was found in this audit that could currently read `sessionStorage` (see fix #7, which removed the one fragile `v-html` path). Recommended as a future hardening step. |
| 14 | `heresy-client/nginx/default.conf`, `vite.config.js` | CSP includes `unsafe-eval`/`unsafe-inline`, weakening XSS mitigation value | Documented in the config as required for VitePress/Vue inline hydration under `/docs/`. The SPA itself doesn't require it at runtime; scoping the relaxed CSP to only the `/docs/` location block is a reasonable follow-up but is a deploy-config change outside this pass's code-fix scope. |
| 15 | `heresy-server/Dockerfile` | Single-stage build ships the native-module build toolchain (`python3`/`make`/`g++`) in the final production image | Increases post-compromise tooling available but isn't itself an exploitable vulnerability. A multi-stage build is a reasonable follow-up; deferred as a build-pipeline change rather than a security fix. |
| 16 | `heresy-sim/src/runner.js` | Global `Math.random` monkey-patch for deterministic seeding is restored in `finally`, but would corrupt state if `runSingleGame` were ever called concurrently via `Promise.all` instead of separate worker threads | Not currently exploitable — the codebase only parallelizes via `worker_threads`, never concurrent same-thread calls. Flagged as a latent footgun for future maintainers, not a present vulnerability. |
| 17 | `heresy-client/nginx/default.conf` | `X-Forwarded-For`/`CF-Connecting-IP` are trusted from the connecting peer without being reset by nginx itself | Safe under the intended deployment (Cloudflare or equivalent as sole ingress, per project docs); only a gap if the container is ever exposed directly to the internet without a trusted front proxy. |
| 18 | `heresy-client/nginx/entrypoint.sh` | `sed` substitution of `$SERVER_PORT` is unescaped | `SERVER_PORT` is an operator-controlled deployment env var, not attacker-reachable input — a fragility note, not a security hole. |

---

## File-by-file audit log

Legend: ✅ clean (no issues) · 🛠 fixed in this pass (see table above) · ⚠ accepted risk (see table above) · — non-code/data, reviewed for embedded risk only.

### heresy-server

| File | Status |
|---|---|
| `src/index.js` | 🛠 (#2, #10) — otherwise ✅: CORS allowlist, constant-time secret comparisons, body-size limits, host-only action gating all correct |
| `src/adminBackup.js` | ⚠ (#11) — dead code, sanitization already correct if wired up |
| `src/config.js` | ✅ — no hardcoded secrets; placeholder default password/key explicitly gated by `isDefaultAdminPassword`/`isDefaultAdminApiKey`, fails closed in production |
| `src/gameConfig.js` | ✅ — reads only fixed, non-client-controlled paths |
| `src/gameLogs.js` | ✅ — `safeLogId()` strips to `[a-zA-Z0-9_-]`, atomic tmp+rename writes, bounded `limit`/event counts |
| `src/heresyGameManager.js` | 🛠 (#1) — otherwise ✅: parameterized SQL throughout, host/alive/player auth checks on every mutator, `sendMessageAs` correctly derives identity server-side, `adminUpdatePlayer` uses field whitelisting |
| `src/leaderboard.js` | ⚠ (#11) — dead code, sanitization already correct if wired up |
| `src/mechanics/drift.js` | ✅ — pure functions, no external input |
| `src/mechanics/interrogation.js` | ✅ — pure functions, no external input |
| `src/mechanics/protection.js` | ✅ — parameterized SQL, inputs are already-validated server-side context |
| `src/socketRateLimiter.js` | ⚠ (#9) — bucket logic itself correct/bounded; identity unit (`socket.id`) is the weak point |
| `src/utils.js` | ✅ — sanitizers trim/cap before regex (no ReDoS); `Math.random()` use is for gameplay artifacts only, not tokens |
| `src/validators/composition.js` | ✅ — allowlist-based role validation |
| `package.json` | ✅ — `npm audit` clean, deliberate `ws` CVE-mitigation override in place |
| `Dockerfile` | 🛠 (#3) · ⚠ (#15) |
| `.dockerignore` | 🛠 (#4) |
| `test/bots.test.js` | ✅ — test-only, no production code path |
| `test/composition.test.js` | ✅ — test-only |
| `test/game.test.js` | ✅ — test-only |
| `test/insert-message.test.js` | ✅ — test-only |
| `test/kick.test.js` | ✅ — test-only |
| `test/reconnect.test.js` | ✅ — test-only |
| `test/server-security.test.js` | ✅ — confirms (and this audit validated) origin-allowlist, player-code normalization, and preset-metadata non-leakage all behave as intended |
| `test/simulate.test.js` | ✅ — test-only |

### bot-manager

| File | Status |
|---|---|
| `src/actionDispatch.js` | 🛠 (#6) |
| `src/auth.js` | ✅ — `crypto.timingSafeEqual` after length check, empty/missing tokens rejected before compare, fails closed when unset |
| `src/config.js` | ✅ — all secrets env-only, never hardcoded |
| `src/director.js` | ✅ — no untrusted external parsing, `Math.random()` only for non-security pacing/order |
| `src/engineClient.js` | ✅ — base URL is env-only (no SSRF vector); unused `shortId()` helper is dead code, not a risk |
| `src/engineSocket.js` | ✅ — base URL env-only; auth via engine-issued `playerCode` |
| `src/health.js` | ✅ — intentionally unauthenticated, exposes only session count/uptime |
| `src/index.js` | ✅ — body size bounded, LLM client construction fails safe, no secret values logged |
| `src/llm/actionLLM.js` | ✅ — bounded retry/echo, no eval, delegates parsing safely |
| `src/llm/mockChatLLM.js` | ✅ — test double, not reachable in production |
| `src/llm/openaiChat.js` | ✅ — base URL env-only, API key never logged, `AbortController` timeout, bounded retries |
| `src/llm/parseAction.js` | ✅ — no eval; builds a fresh object from hardcoded field names (no spread/merge of parsed input → no prototype pollution); non-backtracking regexes |
| `src/llm/passthroughLLM.js` | ✅ — trivial stub |
| `src/llm/queue.js` | ✅ — depth indirectly bounded by `MAX_BOT_SESSIONS` and per-session serialization |
| `src/memory.js` | ✅ — all structures key/value/line-capped with FIFO eviction |
| `src/persistence.js` | 🛠 (#5) |
| `src/prompts/assemble.js` | ⚠ (#12) |
| `src/prompts/budget.js` | ✅ — pure text trimming, no ReDoS-prone regexes |
| `src/prompts/gameState.js` | ⚠ (#12) |
| `src/prompts/roleBlocks.js` | ✅ — static content only |
| `src/prompts/staticRules.js` | ✅ — static content only |
| `src/rest.js` | ✅ — every route (except `/health`) gated by `requireManagerAuth`; body size bounded; session/game caps enforced with rollback on failure |
| `src/session.js` | ✅ — snapshot restore uses defensive `??`/`Array.isArray` guards, no unsafe deserialization |
| `src/sessionStore.js` | ✅ — in-memory map keyed by engine-issued id, no file/network I/O |
| `src/textDedup.js` | ✅ — linear regex, bounded array sizes |
| `src/validator.js` | ✅ — allowlist-based verb/role/target/tier legality checks before any action reaches the engine |
| `package.json` | ✅ — minimal, unremarkable dependency set |
| `Dockerfile` / `.dockerignore` | ✅ — no `.env` ever copied into the image, dev deps excluded |
| `test/*.test.js` (all 8 files) | ✅ — test-only, no production code path |

### heresy-client

| File | Status |
|---|---|
| `index.html` | ✅ — static markup, no dynamic interpolation |
| `src/App.vue` | ✅ — all output via `{{ }}` interpolation; query-string room code is forwarded to the server (not reflected into DOM), validation is the server's job (already covered above) |
| `src/botNames.js` | ✅ — static list |
| `src/components/AdminView.vue` | ⚠ (#13) — server-side enforcement of all sensitive calls confirmed correct |
| `src/components/AnnouncementOverlay.vue` | ✅ — interpolation only |
| `src/components/DebugLog.vue` | 🛠 (#8) — deleted (orphaned dead code) |
| `src/components/EmberField.vue` | ✅ — canvas animation, no user input |
| `src/components/GameView.vue` | 🛠 (#7) |
| `src/components/JoinView.vue` | ✅ — interpolation only |
| `src/components/LobbyView.vue` | ✅ — chat rendered via plain interpolation, no `v-html` |
| `src/components/PlayerSidebar.vue` | 🛠 (#8) — deleted (orphaned dead code) |
| `src/components/SimResultsPanel.vue` | ✅ — numeric interpolation only |
| `src/compositionData.js` | ✅ — static public data, deliberately excludes secret preset roster |
| `src/fx.css` | ✅ — inline data-URI texture, matches CSP |
| `src/style.css` | ✅ — one external font `@import`, matches CSP |
| `src/main.js` | ✅ — standard Vue bootstrap |
| `src/server-composition-validator.js` | ✅ — pure validation logic |
| `src/socket.js` | ✅ — connection target is same-origin by construction (no URL param injection); `playerCode` generated via `crypto.getRandomValues` |
| `vite.config.js` | ⚠ (#14) — dev-only file |
| `nginx/default.conf` | ⚠ (#14, #17) — otherwise ✅: HSTS/X-Frame-Options/CSP/Referrer-Policy present |
| `nginx/entrypoint.sh` | ⚠ (#18) |
| `package.json` | ✅ — legitimate, minimal dependency set; lockfile confirms npmjs.org registry only |
| `Dockerfile` / `.dockerignore` | ✅ — multi-stage build, no secrets baked in, `.npmrc` excluded |
| `public/site.webmanifest` | ✅ — static manifest |

### heresy-sim

| File | Status |
|---|---|
| `src/agent.js` | ✅ — operates on already-validated engine state |
| `src/index.js` | ✅ — safe `JSON.parse` (try/catch), CLI-local output path (not network-facing) |
| `src/report.js` | ✅ — pure aggregation, no I/O |
| `src/runner.js` | ⚠ (#16) — otherwise ✅: `worker_threads` only, never `child_process`; temp DB dirs are non-attacker-controlled |
| `src/server.js` | ✅ — fail-closed bearer-token auth with constant-time compare, thorough input validation, hard server-side caps on `games`/workers, `x-powered-by` disabled |
| `src/strategies/heretic.js` | ✅ — deterministic, pure functions |
| `src/strategies/loyalist.js` | ✅ — deterministic, pure functions |
| `src/strategies/random.js` | ✅ — `Math.random()` is correct here (simulation RNG, not security-sensitive) |
| `src/util.js` | ✅ — LCG is intentionally non-cryptographic, used only for reproducible sim seeding |
| `src/worker.js` | ✅ — consumes structured-cloned `workerData` only, per-game errors caught and reported without crashing the batch |
| `package.json` | ✅ — pinned, unremarkable dependencies |
| `Dockerfile` | ✅ — non-root user, minimal `COPY` surface, no baked-in secrets |
| `test/*.test.js` (all 3 files) | ✅ — test-only |

### Root-level / cross-cutting

| File | Status |
|---|---|
| `check-search.mjs` | ✅ — local Playwright QA helper, no untrusted input, not deployed |
| `data/composition.json`, `deathFlavor.json`, `drift.json`, `roles-40k.json`, `scenarios/default/hints.json` | ✅ — pure static JSON, no embedded code |
| `docker-compose.yml`, `docker-compose.auto.yml`, `docker-compose.manual.yml` | ✅ — no hardcoded real secrets (placeholder `change-me-*` defaults), no `privileged`/host-network mode, game-facing services bound to loopback by default, only the public client binds all interfaces (expected) |
| `.env.example` | ✅ — placeholders only, documents fail-closed rationale, confirmed real `.env` never committed |
| `package.json` (root) | ✅ — thin `docker compose` script wrappers only |
| `.gitignore` | ✅ — correctly excludes `.env`/`.env.*`/`*.db`/`*.sqlite*`/sim-results while allowlisting the specific tracked data files |
| `.dockerignore` (root) | ✅ — excludes `.git`, `node_modules`, `.npmrc`, DB files |
| `README.md`, `AGENTS.md`, `docs/AGENTS.md`, `docs/*.md` (all 10 files) | — documentation only, no executable content |
| `site/**/*.md`, `site/.vitepress/*` | — static VitePress content/theme config, no dynamic server-side execution; theme JS/CSS reviewed as part of the client's build pipeline (no untrusted input) |
| `generated/*.svg`, `generated/heresy-graphics.css`, `generated/preview.html`, `generated/README.md` | — static generated assets (icon defs/sigils), authored at build time, no dynamic interpolation |
| `.vibe/agents/*.toml`, `.vibe/prompts/*.md` | — internal agent/prompt authoring config, not part of the runtime attack surface |
| `quotes.txt` | — static flavor-text data served as a public asset |
| `sim-results/results.json`, `heresy-sim/sim-results/**` | — generated simulation output data, no executable content |
| `tests/e2e/helpers/socketClient.js`, `playwright.config.js`, `specs/*.spec.js` (3 files) | ✅ — Playwright E2E test code, dev-only, not shipped to production |

---

## Recommendations (not blocking, follow-up items)

1. Add a per-IP or global connection-rate control in front of Socket.IO (item #9) to close the reconnect-bypass gap independent of `socket.id` churn.
2. Consider a server-issued, revocable admin session token in place of raw-password replay from `sessionStorage` (item #13).
3. Scope the relaxed `unsafe-eval`/`unsafe-inline` CSP to the `/docs/` location only, keeping the SPA's own policy strict (item #14).
4. Move `heresy-server`'s Dockerfile to a multi-stage build so the native-module toolchain doesn't ship in the production image (item #15).
