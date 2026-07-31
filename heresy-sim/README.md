# Heresy Rising Simulator (`heresy-sim/`)

Batch-simulate thousands of Heresy Rising games at CPU speed using the real
game engine and heuristic AI agents. Used for balance analysis, composition
testing, and mechanic validation.

**The simulator is a consumer of the engine, not part of it.** It imports
`HeresyGameManager` from `../heresy-server/src/heresyGameManager.js` and runs
against ephemeral temp SQLite databases — zero modifications to the engine.

## Quickstart

```bash
cd heresy-sim
npm install

# One game with full trace
node src/index.js single --players 8 --seed 42 --verbose

# Batch: 1000 games, write results JSON
node src/index.js run --games 1000 --players 8 --seed 42 --parallel 4
```

> **Node ≥ 20 required.** The package depends on `better-sqlite3` (native addon)
> and `commander`. It is ESM (`"type": "module"`).

## Commands

### `single` — run one game, print outcome

```
node src/index.js single [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --players <n>` | `8` | Player count (5–12) |
| `--seed <n>` | `Date.now()` | Deterministic PRNG seed. Same seed = same game. |
| `-v, --verbose` | off | Print every night action, vote, and phase transition. |
| `--max-rounds <n>` | `50` | Abort after this many rounds, count as a draw. |
| `--strategy <s>` | `heuristic` | Agent type: `heuristic` (role-aware rules) or `random` (uniform-legal). |
| `--parallel <n>` | CPU count | Number of worker threads. `1` = sequential, omit for auto. |

Output to stdout: winner, round count, elapsed ms, and (with `--verbose`) a
full per-turn trace and final player state table.

### `run` — batch simulate N games

```
node src/index.js run [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-g, --games <n>` | `100` | Number of games to simulate. |
| `-p, --players <n>` | `8` | Player count per game. |
| `--seed <n>` | `Date.now()` | Base seed. Game *i* gets `base_seed + i`. |
| `--output <dir>` | `./sim-results/` | Directory for results JSON. Created if missing. |
| `--max-rounds <n>` | `50` | Per-game round abort limit. |
| `--parallel <n>` | CPU count | Worker threads. `1` = sequential, omit for auto. |
| `--strategy <s>` | `heuristic` | Agent type: `heuristic` or `random`. |

Prints a text summary table to stdout. Writes `results.json` to the output
directory.

### HTTP API (container / direct access)

`heresy-sim` also runs as a long-lived HTTP service
(`heresy-sim/src/server.js`, `npm run serve`) — this is what the Docker image
actually runs (`heresy-sim/Dockerfile`'s `CMD`). It's a *second* entrypoint
into the same `runner.js` / `agent.js` / `report.js` code the CLI uses above,
not a replacement for it.

heresy-server proxies two callers to this service in the normal deployed
stack — a game host previewing their own lobby's roster (`game:simulate`
socket event) and a site admin running larger batches
(`POST /api/admin/simulate`) — see `.env.example`'s "Heresy Sim" section.
Both hops are capped and cooldown-limited on heresy-server's side and present
the shared `SIM_BYPASS_TOKEN` to this service.

### Direct HTTP access

The container also publishes its own port directly
(`docker-compose*.yml`, `SIM_HOST_BIND` / `SIM_PORT` — defaults to
`127.0.0.1:7879`, loopback-only), so a trusted local caller can skip
heresy-server's host/admin caps and per-lobby cooldown entirely and hit
`POST /simulate` straight on. This is the intended path for local tooling —
scripts, bots, CI — that needs to run batches without those caps.
**heresy-sim itself applies no per-caller rate limiting beyond
`SIM_HARD_MAX_GAMES`** — only `SIM_BYPASS_TOKEN` auth and the hard game cap
gate this endpoint, by design, for exactly this use case.

Because there's no rate limiting on this path, **never widen `SIM_HOST_BIND`
past loopback (`127.0.0.1`) on a host that has any port forwarded to the
internet.** If your caller runs on the same machine as the Docker host, the
default already works with zero config changes — loopback is still reachable
from that machine's own shell/scripts, just not from other hosts on the LAN
or the internet. Only widen it (e.g. to a specific LAN IP) if the caller runs
elsewhere on your network.

#### `GET /health`

No auth required. Returns `{ "ok": true }`.

#### `POST /simulate`

Auth: `Authorization: Bearer <SIM_BYPASS_TOKEN>` — the same secret configured
in `.env` for the heresy-server → heresy-sim hop. Missing/wrong token → 401.
Token unset on the container → 503 (fails closed; never silently accepts
unauthenticated requests).

Request body:
```json
{
  "composition": { "source": "preset", "presetId": "8p" },
  "games": 500,
  "seed": 42
}
```
or a custom roster:
```json
{
  "composition": { "source": "custom", "roster": ["murderer", "priest", "interrogator", "chirurgeon", "imperial-citizen"] },
  "games": 200
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `composition.source` | yes | `"preset"` (player count derived from the numeric prefix of `presetId`, e.g. `"8p"` → 8) or `"custom"` (player count derived from `roster.length`). |
| `games` | yes | Positive integer. Silently clamped server-side to `SIM_HARD_MAX_GAMES` (default 1000) regardless of what's requested — never rejected, just capped. |
| `seed` | no | Finite number. Omit for a random seed; the same seed always reproduces the same batch (see "Determinism" below). |

Responses:
- `200` — same shape as `results.json` below (see "Output"), plus a
  `perComposition` breakdown.
- `400` — invalid composition, with `validateComposition`'s structured
  `details` array (same validator heresy-server and heresy-client use).
- `401` / `503` — auth failure (see above).
- `500` — every game in the batch failed. Never a fake `200 OK, 0 games`
  success (`runner.js`'s zero-games guard turns a fully-failed batch into a
  thrown error before this handler ever sees a result).

```bash
curl -sX POST http://localhost:7879/simulate \
  -H "Authorization: Bearer $SIM_BYPASS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"composition":{"source":"preset","presetId":"8p"},"games":200,"seed":42}'
```

## Output (`results.json`)

```json
{
  "meta": {
    "simVersion": "1.0.0",
    "timestamp": "2026-07-25T00:00:00.000Z",
    "seed": 42,
    "playerCount": 8,
    "gameCount": 100,
    "strategyMix": { "heuristic": 100 },
    "elapsed": 3400
  },
  "summary": {
    "loyalistWins": 47, "hereticWins": 48, "draws": 5,
    "loyalistWinRate": 0.47, "hereticWinRate": 0.48, "drawRate": 0.05,
    "avgRounds": 6.2, "medianRounds": 5, "totalGames": 100
  },
  "perRole": {
    "murderer": {
      "games": 100, "survivedToEnd": 55,
      "avgDriftAtEnd": 11.2, "lynchedRate": 0.12
    }
  },
  "games": [
    {
      "seed": 42, "winner": "loyalist", "rounds": 7,
      "composition": ["murderer","heretic-priest","priest","interrogator",...],
      "players": [
        { "role": "murderer", "faction": "heretic", "alive": false, "drift": 14, "lynched": false }
      ]
    }
  ]
}
```

## Architecture

```
heresy-sim/
├── src/
│   ├── index.js              # CLI entrypoint (commander)
│   ├── runner.js             # runSingleGame() + runBatch() + runBatchParallel()
│   ├── worker.js             # Worker thread entrypoint (loaded by runner)
│   ├── agent.js              # buildAgentState(), createHeuristicAgent(),
│   │                           collectNightActions(), collectDayVotes()
│   ├── report.js             # aggregateResults(), buildResultsJSON(),
│   │                           formatTextSummary()
│   ├── util.js               # seedableRNG(), pickRandom(), shuffle()
│   └── strategies/
│       ├── random.js         # createRandomAgent(id) → uniform-legal picks
│       ├── loyalist.js       # L1-L7 heuristics (Citizen → Sanctioned Psyker)
│       └── heretic.js        # H1-H6 heuristics (Murderer → Animus)
│                               with shared factionState coordination
├── package.json
└── README.md (this file)
```

## Agent model

Every simulated player slot gets an **agent** — a pure object with these methods:

```ts
type Agent = {
  id: string;         // player code
  nightAction(state: AgentState): { targetCode: string, variant?: string } | null;
  dayVote(state: AgentState): string;    // playerCode | 'skip'
};
```

`AgentState` is built by `buildAgentState(manager, code, playerCode)` and
contains exactly the information that player would see in the real game:
their own role/faction/drift, living player counts, vote tally, and (for
faction-mates) faction identity of allies. No hidden state is leaked.

Note: torture (a below-threshold day-vote outcome) resolves automatically —
tier-1 cripple damage applies silently, no player response is involved. There
is no `respondTorture` method on the `Agent` interface.

**Intentional omissions:** Other players' raw `drift` value and drift `zone` are
deliberately excluded from `AgentState.living` and `.dead`. A real player never
sees this either — the engine's `state()` method enforces fog of war and never
returns other players' drift. Heuristics that need a "who's about to explode"
signal must use legitimate public proxies instead: the day-phase vote tally
(also usable at night via `lastDayVoteTally`), `atRiskTargets` (players with
public torture history), and a role's own `privateMessages` (e.g., an Interrogator's
past scan results, which do carry zone hints). This prevents future contributors
from "fixing" the missing drift data by adding an omniscient field.

### Strategy types

| Value | Agent factory | Behavior |
|-------|--------------|----------|
| `heuristic` | `createHeuristicAgent(roleId, id, factionState)` | Role-aware deterministic rules. Auto-maps roleId → correct heuristic. Falls back to random for unrecognized roles. |
| `random` | `createRandomAgent(id)` | Uniform-random legal action from available targets/variants. Baseline for comparison. |

## Heuristics reference

Each strategy is ~20–50 lines of deterministic rules. They are intentionally
**not optimal** — they model plausible table behavior, not perfect play.

### Loyalist (L1–L7)

| Role | ID | Key behavior |
|------|-----|-------------|
| Imperial Citizen | `imperial-citizen` | Sleeps (auto). Votes with crowd or skips (30%). |
| Interrogator | `interrogator` | Scans the player who got most votes last round. Variant choice (T1/T2/T3) based on real scaled drift costs (`state.scaledCosts`) and a drift budget — picks the highest tier affordable without spending >1/3 of `maxDrift` in one action. |
| Chirurgeon | `chirurgeon` | Rotates protection targets: self-protects when own drift ≥ 5 and didn't self-protect last round; otherwise round-robins other living players in fixed order. No targeting signal beyond rotation. |
| Novice-Psychic | `novice-psychic` | Scans the most recently interrogated player. Votes against Yellow+ drift. |
| Arbitrator | `arbitrator` | Proxies the Interrogator or Priest. |
| Priest | `priest` | Whisper on highest-drift Loyalist. Hymn on Orange. Litany saves Red. |
| Sanctioned Psyker | `sanctioned-psyker` | Holds kill until a near-certain Heretic target exists (late game or Heretic parity). Sleeps otherwise. One-shot state only marked used after the engine confirms the night action submitted successfully. |

### Heretic (H1–H6)

Heretics share a `factionState` Map for coordination (approximates faction chat).

| Role | ID | Key behavior |
|------|-----|-------------|
| Murderer | `murderer` | Kills Loyalists avoiding recent repeats (via rotation memory). Sleeps instead of attacking once the drift-gate would block the kill (drift + 15 > maxDrift), to recover via passive sleep drift and stay able to kill again later — unless no other living Heretic has Blood Ritual duty (see below), in which case it uses that instead of sleeping. Uses `onNightActionCommitted()` to track recent targets only after the kill action succeeds. Buses Heretics in votes. |
| Heretic Priest | `heretic-priest` | Takes Blood Ritual duty if no higher-priority Heretic can. Otherwise targets lowest-drift Loyalist with a sermon, escalating tier with target zone. |
| Conspirator | `conspirator` | Takes Blood Ritual duty whenever alive and uncrippled (its own kit, forge(), is day-only and not yet modeled here — see below). Actively publishes its suspected-Interrogator guess (highest-activity voter) as `consensusVoteTarget` in faction state — the coordinated target other Heretic roles read and follow. |
| Saboteur | `saboteur` | Takes Blood Ritual duty if no higher-priority Heretic can. Otherwise traps the player most likely scanned by Interrogator. |
| Recruiter | `recruiter` | Targets non-Heretics, avoiding repeat-targeting across consecutive nights (via rotation memory). Never takes Blood Ritual duty — keeps the conversion win path undiluted. |
| Animus | `animus` | One-shot ability: targets a living non-Heretic using the best available public proxy for high drift (a publicly-tortured target from `atRiskTargets` if one exists, else the most-voted player, else the first legal target). Never confirmed correct or incorrect from the sim's perspective; mirrors the real ability's "wastes silently on a wrong guess" design. Never takes Blood Ritual duty — keeps the possession win path undiluted. |

#### Blood Ritual coordination

Blood Ritual (`blood-ritual.md` v1.0.0) is a faction-wide night action — any
living, uncrippled Heretic can submit it, but only one claim per night wins,
and the engine escalates to a kill by *target*, not by attacker, so a second
Heretic rotating the attack onto the same target the following night
correctly triggers the kill. Priority for who takes the duty each night:
**Conspirator > Heretic Priest > Saboteur > Murderer** (Murderer only as a
last resort, from its own gated branch — see above). Every Heretic computes
this priority independently from a role registry each strategy publishes
into `factionState` at creation time, so there's no explicit hand-off
message and no collision risk. The chosen attacker locks onto the same
target across nights (also via `factionState`) until it dies or becomes
illegal, to drive the engine's escalation.

Conspirator's real kit (`forge()`, day-only message forgery) is not yet
modeled in the sim at all — right now it only ever contributes via Blood
Ritual duty when alive.

## Engine integration

The simulator calls `HeresyGameManager` directly — same API the E2E tests use.
Key difference: it calls `manager.resolve(code, true)` and
`manager.advance(code, hostCode)` to force phase transitions immediately
(instead of waiting for real-time deadlines).

### Temp DB lifecycle

```js
// Pattern used in runner.js — each game is a fresh temp SQLite DB:
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-sim-'));
const dbPath = path.join(dir, 'game.db');
const manager = new HeresyGameManager({
  databasePath: dbPath,
  now: () => fixedClock,  // virtual timestamp
  random: seededRng,      // deterministic
});
// ... run game ...
manager.close();
fs.rmSync(dir, { recursive: true, force: true });
```

### Determinism

The simulator monkey-patches `Math.random` with the seeded PRNG before each
game, then restores the original when done. The engine's `shuffle()` (used for
role assignment) calls `Math.random` — patching it makes that deterministic.

Same seed → same role distribution, same action outcomes → identical results.

## Performance

| Players | Sequential | 4 workers | 8 workers |
|---------|-----------|-----------|-----------|
| 5 | ~60/s | ~180/s | ~300/s |
| 8 | ~30/s | ~90/s | ~150/s |
| 12 | ~20/s | ~55/s | ~90/s |

1000 games at 8 players with 8 workers takes ~7 seconds.

## Testing

```bash
npm test   # node --test — runner.js, server.js, and per-strategy heuristics
```

Covers `resolveGameSetup`/`runBatch`/`runBatchParallel` (including the
zero-games-must-throw guard), the HTTP server's auth/validation/caps
(`test/server.test.js`), and individual heuristic behavior like the
Murderer's drift-gate awareness (`test/heretic-strategy.test.js`).

For ad-hoc exploration beyond the test suite:
```bash
node src/index.js single --players 5 --seed 42 --verbose
node src/index.js single --players 12 --seed 123 --strategy random

# Verify determinism:
node src/index.js run --games 3 --players 8 --seed 42 2>&1 | grep Loyalist
node src/index.js run --games 3 --players 8 --seed 42 2>&1 | grep Loyalist
# Same output both times.
```

## Adding a new heuristic

1. Write a factory in `src/strategies/loyalist.js` or `heretic.js`:
   ```js
   export function createMyRole(id) {
     return {
       id,
       nightAction(state) { /* pick target from state.legalTargets */ },
       dayVote(state) { /* return a playerCode from state.voteOptions or 'skip' */ },
     };
   }
   ```
2. Register it in `src/agent.js` in the `LOYALIST_ROLE_MAP` or in `heretic.js`'s
   `HERETIC_HEURISTICS` map.
3. Smoke test: `node src/index.js single --players 8 --verbose`

The agent methods must never throw. `collectNightActions` / `collectDayVotes`
wrap calls in try/catch and silently skip illegal choices, but a crashing agent
still wastes a slot.

## Common issues

| Symptom | Likely cause |
|---------|-------------|
| All games draw at round 50 | Heuristic deadlock. Check maxRounds and agent logic. |
| Role distribution differs from composition.json | Custom composition not passed. The engine uses `presetFor(count)` by default. |
| `TypeError: manager.state is not a function` | Engine import path is wrong. Must be `../../heresy-server/src/heresyGameManager.js`. |
| Non-deterministic despite same seed | Something calls `Date.now()` instead of the injected `now` function. |
