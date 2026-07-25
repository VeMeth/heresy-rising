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

### Output (`results.json`)

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
│       └── heretic.js        # H1-H5 heuristics (Murderer → Recruiter)
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
  respondInterrogation(state: AgentState): 'confess' | 'resist' | 'refuse-break';
};
```

`AgentState` is built by `buildAgentState(manager, code, playerCode)` and
contains exactly the information that player would see in the real game:
their own role/faction/drift, living player counts, vote tally, pending
interrogation status, and (for faction-mates) faction identity of allies.
No hidden state is leaked.

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
| Interrogator | `interrogator` | Scans the player who got most votes last round. T2 default, T3 if target Orange+. |
| Chirurgeon | `chirurgeon` | Protects the player who spoke most or the Interrogator. Rotates targets. |
| Novice-Psychic | `novice-psychic` | Scans the most recently interrogated player. Votes against Yellow+ drift. |
| Arbitrator | `arbitrator` | Proxies the Interrogator or Priest. |
| Priest | `priest` | Whisper on highest-drift Loyalist. Hymn on Orange. Litany saves Red. |
| Sanctioned Psyker | `sanctioned-psyker` | Holds kill until a near-certain Heretic target exists. Sleeps otherwise. |

### Heretic (H1–H5)

Heretics share a `factionState` Map for coordination (approximates faction chat).

| Role | ID | Key behavior |
|------|-----|-------------|
| Murderer | `murderer` | Kills Loyalists avoiding recent repeats. Buses Heretics in votes. |
| Heretic Priest | `heretic-priest` | Targets lowest-drift Loyalist. Escalates sermon tier with target zone. |
| Conspirator | `conspirator` | Forges messages from Loyalists once/day. Frames Interrogator if known. |
| Saboteur | `saboteur` | Traps the player most likely scanned by Interrogator. |
| Recruiter | `recruiter` | Catalyzes Black-zone targets. Sleeps if no target at drift 20. |

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
# No test suite yet — use the single command to smoke-check:
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
       respondInterrogation(state) { return 'resist'; },
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
