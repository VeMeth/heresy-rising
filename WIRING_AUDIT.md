# Wiring audit — dead and unwired code

> **STATUS: RESOLVED.** Every finding below has been actioned — see
> "Resolution" at the end for what changed and three findings this audit
> got wrong (caught during implementation).

Full cross-process audit of `heresy-server`, `heresy-client`, `bot-manager`, `heresy-sim`, and `game_data/`.
Six parallel analysis passes, every finding below independently re-verified before inclusion.
**No source files were modified.**

Classification:
- **UNWIRED** — implemented, but the other half of the contract is missing. These are latent bugs.
- **DEAD** — nothing references it. Safe to delete.
- **INTENTIONAL** — reachable via indirection/config/templates. Documented so a future audit does not re-flag it.

---

## A. UNWIRED — features that silently do nothing

### A1. Bots cannot use Animus (H6) puppet control — *gameplay bug*
| | |
|---|---|
| Server | `vote:submit-as` (`index.js:297` → `voteAs` `heresyGameManager.js:611`), `chat:send-as` (`index.js:294` → `sendMessageAs` `:673`) |
| Human client | wired — `App.vue:156,160-161` |
| Bot-manager | **no dispatch path** |

`vote()` (`heresyGameManager.js:591`) bars the possessed seat outright: `if(v.possessed_by) throw 'You are possessed and cannot vote today'`. So a possessed seat's vote can **only** be cast by the possessor via `voteAs`.

Verified: bot-manager's entire emit surface is 4 events — `game:state` (`engineSocket.js:26`), `chat:send` (`session.js:419`), `vote:submit` (`:440`), `action:submit` (`:449`). `grep -rn "submit-as\|send-as\|retract-as\|submit-faction" bot-manager/src` → **zero matches**.

**Effect: when a bot Animus possesses a target, that seat's vote is never cast again for the rest of the game.**

### A2. Bots cannot use Blood Ritual — *gameplay bug*
Server handler `index.js:301` → `submitFactionAction` (`heresyGameManager.js:652`). A faction-wide Heretic night attack, spec'd in `docs/specs/mechanics/heretic-kit.md`.

Bot side has no path at any layer: no verb in `actionDispatch.js verbToIntent()`, no entry in `llm/parseAction.js ACTION_SCHEMA`, no grant in `validator.js ROLES_VERBS` for any Heretic role. `buildEnginePayload()` only ever produces `{type:'chat'|'vote'|'action'}`.

**Effect: a fully built faction mechanic is permanently dormant in every bot-populated cabal.**

### A3. `crippleProfile` role data is read by nobody — *balance bug*
All 13 roles in `game_data/roles-40k.json` carry a `crippleProfile` block with per-role `blocks` / `onCripple` (`disable-one` vs `disable-all`). It is spread into live role objects by `gameConfig.js:18`, so it exists at runtime.

Verified: `grep -rn "crippleProfile\|onCripple\|disable-one\|disable-all"` across all four `src/` trees → **exit 1, zero matches**.

The engine instead applies one blanket rule in `submitAction` (`heresyGameManager.js:626`). Worse — **`vote()` never checks `effectiveCrippleTier` at all**, so a crippled `imperial-citizen`, whose profile explicitly lists `"vote"` in `blocks`, can still vote.

This turns the known "Cripple gap" from a documentation nit into a real data/code split.

### A4. `voteJustification` has no UI input
`GameView.vue:233` declares the ref; `:302` reads it into **both** vote emits; `App.vue:158,160` forwards it; the server writes a `Vote justification: …` chat message when truthy (`heresyGameManager.js:604,615`); `style.css:101` styles those messages.

Verified: nothing in any template writes to the ref — no `v-model`, no binding. It stays `''` forever.

**Effect: every vote submits an empty justification; a complete, styled, server-supported feature never fires.**

### A5. `lastProtectTarget` is misread by bots and ignored by the client
Server sends it **top-level** in `state()` (`heresyGameManager.js:706`), as a sibling of `me`.

- `bot-manager/src/session.js:226` captures `this._latestMe = s.me` — the player sub-object, which has no such key. `:500` then reads `me.lastProtectTarget` → **always `undefined`**.
- `validator.js` never checks it either, even if populated.
- `grep -rn "lastProtectTarget" heresy-client/src` → nothing.

**Effect: the "no same target on consecutive nights" protect rule has zero client-side pre-check anywhere. Every violation round-trips to a server rejection — a wasted LLM call for bots, a toast error instead of a disabled button for humans.**

### A6. GameView chat pagination is dead
`hasMore` and `history` appear **only** in the `defineProps`/`defineEmits` line (`GameView.vue:232`). No `emit('history', …)` exists in the file. "Load earlier messages" only toggles `showEarlierDays` over already-loaded messages.

`LobbyView.vue:14` has the correct implementation. `App.vue` wires `:has-more`/`@history` to GameView identically — plumbing live, trigger missing.

**Effect: mid-game you cannot fetch messages older than what loaded at join/reconnect.**

### A7. Two announcement types fall through to a generic badge
Server emits 9 announcement types. `AnnouncementOverlay.vue:33-42`'s `badgeLabels` has 8 keys — missing `blood-ritual-cripple` (`heresyGameManager.js:467`) and `torture-death` (`:580`), which render as bland `ANNOUNCEMENT`. It also carries a `protection` entry that is **never emitted** (Chirurgeon protection is silent by design) plus ~4 lines of dead `.type-protection` CSS.

### A8. `bodyguardRedirect` flavor text is orphaned
`deathFlavor.json` defines 4 pools; `this.flavor()` is called with only 3 (`slain`, `bloodRitualCripple`, `tortureChamber`). The bodyguard-redirect branch (`heresyGameManager.js:438`) falls through to the generic `slain` pool, so the two-name redirect narrative written for it never appears.

### A9. `GameView` ignores its `busy` prop
Declared at `:232`, never read. LobbyView uses the same prop to disable Transmit (`:35`), Ready (`:56`), Start (`:266`). No in-flight state on votes, actions, or sends — double-submit risk.

### A10. `confessed` / `pendingTorture` — half-built
`confessed`: DB column, payload field on every player, admin toggle — but the **only** write path is the admin override endpoint. No game mechanic sets it; no client displays it.
`pendingTorture`: hardcoded `null` at both `:706` and `:707`; `heresy-sim/src/agent.js:152` reads it and always sees `null`.

### A11. `DELETE /api/admin/bots/by-conclave/:conclaveCode` has no caller
`index.js:188`. Proxy target and auth verified correct. Repo-wide grep finds only the 3 route definitions. The real cascade-delete is a separate hand-inlined `fetch()` at `index.js:154`.

---

## B. DEAD — safe to delete

### Config keys that do nothing
| Key | File | Note |
|---|---|---|
| `LOSING_SIDE`, `LOSING_SIDE_HALTS_AFTER_DAY` | `drift.json:12-13` | **A spec'd mechanic with no implementing code.** Only `WRONG_LYNCH` is ever charged. |
| `BASE_DRIFT`, `DRIFT_FLOOR` | `drift.json:3,5` | Hardcoded instead — SQL `DEFAULT 0` (`:123`) and literal `Math.max(0,…)` (`:663`). Match by coincidence. |
| `proximitySiphon.adjacency/.sleepStacks/.cap/.visibility` | `rules.json:24-28` | `applyProximitySiphon` reads only `scope`, `role`, `floor`, `rate`. |
| `perCountSummary` | `composition.json:41-50` | Zero references anywhere, including docs. |

Verified: `grep -rni "LOSING_SIDE\|BASE_DRIFT\|DRIFT_FLOOR"` across all four `src/` trees → **exit 1**.
**Editing any of these has zero effect on real games.**

### Code
| Item | Location |
|---|---|
| `action:state` listener | `App.vue:254` and `:255` — server never emits it via any static or dynamic path |
| `shortId` | `bot-manager/src/engineClient.js:58` (check `crypto` import after removal) |
| `USER_MESSAGE_TARGET_TOKENS` | `bot-manager/src/prompts/budget.js:19` |
| `formatDuration` | `heresy-sim/src/util.js:41` |
| unused `now` local | `heresyGameManager.js:804` — ESLint error; copy-paste residue from `adminMergePlayer` |
| `initial()` | `GameView.vue:304` and `LobbyView.vue:647` — superseded by `sealText()`/`sealAttrs()` |
| `channel` prop + `channel-change` emit | `LobbyView.vue:289,292` — lobby is single-channel |
| `phases` import | `AdminView.vue:712` |
| `isYou`/`youId` fallback | `App.vue:83` — server sets neither field |

### Payload weight (sent, read by nobody)
`status`, top-level `isHost` (client uses per-player `isHost`), `compositionLabel` — all in `heresyGameManager.js:706`.

### Unused REST wrappers
`GET /api/game/:code` and `GET /api/game/:code/chat` (`index.js:217-218`). Zero callers; the `game:state`/`chat:history` socket acks carry all real traffic. The underlying manager methods are alive.

---

## C. Documentation gap

11 env vars are read by code but absent from `.env.example`: `GAME_CONFIG_DIR`, `GAME_DB_PATH`, `HERESY_BOT_PORT`, `HERESY_GAME_HOST`, `BOT_MANAGER_URL`, `SERVER_URL`, `PORT`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `TOP_P`, `MAX_RETRIES`. All have safe defaults, but the rate-limit and LLM knobs have documented siblings.

---

## D. Verified clean

- All 24 `ackWrap` socket handlers have a real caller; every server emit has a real listener.
- All ~90 `heresyGameManager` methods trace to a production caller — no dead methods.
- Bot-manager pipeline complete end to end: `night_action_prompt` → session → queue → assemble → LLM → parseAction → memory → validator → actionDispatch → textDedup → emit → persistence. Every stage has a consumer.
- No response-shape mismatches across 13 admin REST endpoints; no auth middleware gaps.
- Chat channels: 4 server-side, client tabs match the read-gates exactly.
- `state()` vs `spectate()`: field-by-field diff shows only intended differences.
- All 13 roles and every action `kind` consistent between `roles-40k.json` and the engine.

## E. Checker false positives — do not re-flag

My initial export scan excluded same-file usage, so "no external importer" ≠ dead. These are **live**:

`ROLE_BLOCKS` → `roleBlock()` → `assemble.js:47` (bots **do** get role instructions) · `HERETIC_ROLE_MAP` / `createH5Recruiter` / `createH6Animus` → `getHereticHeuristic()` → `agent.js:59` (**no** silent fallback; the real gap is only missing unit tests) · `buildSystemPrompt` · `DEFAULT_ADMIN_PASSWORD` · `isHostileTo` · `resolveSimComposition` · `fetchWithTimeout` · `getZoneUpgrade` · `CHARS_PER_TOKEN` · `buildAgentState` · `BOT_NAMES` (module alive via `pickBotName()`)

Other intentional: `game:advance-phase` is e2e-only (production advances via the deadline timer at `index.js:346`) · `GET /api/game/presets` is e2e-only · `MockChatLLM` is test-only · `drift.json sermons.*.self` is a documented fallback · `SIM_HARD_MAX_GAMES`/`SIM_MAX_WORKERS` are read via a `readEnvInt()` wrapper.

---

## Suggested order of work

1. **A1–A3** — real gameplay bugs. A1 and A2 make bot games play differently from human games; A3 makes a documented mechanic inert.
2. **A4–A6** — complete features with a missing client trigger. Small fixes, visible payoff.
3. **B config keys** — either implement `LOSING_SIDE` or delete it; a balance knob that silently does nothing is a trap for whoever tunes next.
4. **B code + A7–A11** — cleanup and polish.

Two notes on risk: `heresy-client` has **no test suite at all**, so client changes carry no regression net; and `bot-manager` + `heresy-sim` are both deployed (all three compose files, ports 7878/7879), so their findings are live-production, not scratch code.


---

# Resolution

## Corrections to this report (found while implementing)

Three findings above were **wrong**. Recording them so they are not re-actioned later:

1. **`status` is NOT dead payload weight.** `index.js:254` reads `state.status==='ended'` to fire the
   `game:ended` event, and `heresy-sim/runner.js:168` gates its main loop on `game.status==='active'`.
   Deleting it would have broken game-over entirely. **Kept.**
2. **`compositionLabel` is NOT dead.** Two privacy-regression tests
   (`composition.test.js:423-438`, `game.test.js:14`) assert it exists during lobby and disappears after
   `start()`. It exists so the lobby can show a composition summary *without* leaking the actual roster.
   **Kept.**
3. **`bodyguardRedirect` flavor should NOT be wired.** Every string in the pool names the protected
   `{target}`, which would publicly reveal both that a redirect happened and who was guarded — contradicting
   the explicit design comment at `heresyGameManager.js:439`. **Pool deleted instead**, with a comment at the
   branch so it is not reintroduced.

Separately, `crippleProfile`'s `"vote"` entry on `imperial-citizen` was traced to a **generation artifact**:
every other role's `blocks` list is that role's *night* ability, and the Citizen is the only role without one,
so the generator fell through to its *day* action. Cripple was never intended to gate voting. The entry is now
`[]` and `crippleProfile` is documented as descriptive metadata the engine does not read.

## What changed

**Bot capability gaps (A1, A2) — closed.** Bot-manager now emits 7 engine events (was 4). Added a
`blood_ritual` verb (schema enum, `ROLES_VERBS` for all 6 Heretic roles, validation, `faction-action`
dispatch → `action:submit-faction`) and an `asPuppet` flag routing chat/vote to `chat:send-as` /
`vote:submit-as`. Role prompts updated — the Animus block previously read *"this build does not yet support
that for bots"*, which described exactly this gap. Prompt additions were compressed to stay inside the
existing per-block (≤320 tok) and `STATIC_RULES` (≤600 tok) budgets that the test suite enforces.

**Note on Blood Ritual scope:** the spec contradicts itself — `blood-ritual.md:24` and `heretic-kit.md:29,144`
say Murderer is *not* part of it, but `blood-ritual.md:50`'s Valid-attackers table lists Murderer explicitly.
The engine accepts any Heretic, so the verb was granted to all six roles to match runtime behaviour.
**Worth a design decision.**

**Also fixed:** `voteJustification` wired as an optional field (clears after each vote); `lastProtectTarget`
read from the correct level in bot-manager plus rotation pre-checks in `validator.js` and GameView;
GameView chat pagination; `busy` prop; both missing announcement badges (emitted types and labels now match
1:1); the confession feature removed entirely (mechanic no longer exists — DB columns, payload fields, admin
toggle, sim reads); 11 env vars documented; and the dead-code list actioned.

## Verification

- ESLint: **clean** (was 3 errors, including 2 pre-existing test-file ones).
- bot-manager **145/145 pass** · heresy-sim **58/58 pass** · client **builds clean**.
- heresy-server: 4 failures — **identical set on unmodified `master`**, confirmed by stashing and re-running.
  Pre-existing, unrelated to this work: 3 Tiered-Lynch tests and 1 execute-on-sight test.
- New dispatch paths exercised directly: `blood_ritual` → `faction-action`, missing target → `null`,
  `asPuppet` → `chat-as`/`vote-as`, normal paths unchanged. Validator confirms Heretic-only, no self-target,
  and the protect-rotation rejection.

## Not done

The 4 pre-existing `heresy-server` test failures were left alone — out of scope for a wiring audit, but they
mean `master` is currently red. Worth a look: three concern Tiered Lynch escalation/saturation and one
concerns interrogator execute-on-sight intel.
