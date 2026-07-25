# Heresy Rising — Simulator Plan

> **Status:** Planned — not yet built
> **Owner:** to be dispatched to a coding agent
> **Purpose:** Batch-simulate thousands of Heresy Rising games with heuristic/LLM agents to measure faction balance, composition viability, and mechanic tuning.

---

## 1. What the simulator is

A CLI tool that runs many games of Heresy Rising at CPU speed — no UI, no network, no human players. Each game is driven by **agent strategies** (heuristic functions, not full LLMs in the fast path) that approximate plausible player behavior. The engine under test is the **real `HeresyGameManager`** — same SQLite DB, same drift math, same resolution order. The simulator reports win rates, round counts, drift distributions, role performance, and balance metrics.

### Non-goals (v1)

- Full LLM-driven agents (those live in `heresy-bot/` and are triggered via the bot-manager protocol; the simulator can optionally call them but that's a v2 feature)
- Real-time visualization (output is JSON/CSV + a summary markdown report)
- Network simulation, latency, disconnects (these are infra concerns, not balance concerns)
- Replaying historical games (separate tool)

---

## 2. Architecture

```
heresy-sim/
├── package.json          # ESM, depends on heresy-server code
├── src/
│   ├── index.js          # CLI entrypoint, argument parsing
│   ├── runner.js         # Master loop: spawn N games, collect results
│   ├── agent.js          # Agent strategy registry + dispatcher
│   ├── strategies/
│   │   ├── loyalist.js   # Loyalist heuristics
│   │   └── heretic.js    # Heretic heuristics
│   ├── report.js         # Statistics aggregation, JSON/CSV/markdown output
│   └── util.js           # Helpers (seedable RNG, progress bar)
├── test/
│   └── sim.test.js       # Unit tests for agent strategies
└── README.md
```

Package dependencies:
- `better-sqlite3` (same as server — the engine needs it)
- `commander` or `yargs` for CLI
- No new heavy deps — strategies are pure JS, no ML.

The simulator imports `HeresyGameManager` from `heresy-server/src/heresyGameManager.js` directly. It does NOT start a socket server. It creates ephemeral SQLite databases (in-memory or temp files) and tears them down.

---

## 3. Agent model

Every simulated player slot gets an **agent** — a pure function that receives the game state and returns an action. There are no async waits, no timeouts; the simulator advances instantly.

### 3.1 Agent interface

```ts
type Agent = {
  /** Unique ID for this agent instance */
  id: string;
  /** Human-readable label, e.g. "random-loyalist" */
  label: string;
  /** Which faction this agent is assigned to (if known in advance for fixed-composition runs) */
  faction?: 'loyalist' | 'heretic';
  /** Called each night with the player's view of the game state */
  nightAction(state: AgentState): NightAction | null;
  /** Called each day for vote */
  dayVote(state: AgentState): DayVote;
  /** Called when a forged message appears (Conspirator only) */
  chooseForgery(state: AgentState): ForgeryChoice | null;
  /** Called when interrogated (Tier 2 "must justify votes" / Tier 3 "confess if asked") */
  respondInterrogation(state: AgentState): 'confess' | 'resist' | 'refuse-break';
};

type AgentState = {
  /** Agent's own role ID, faction, drift, cripple tier */
  me: PlayerSummary;
  /** All living players the agent can see (roles hidden except for faction-mates) */
  living: PlayerSummary[];
  /** All dead players */
  dead: PlayerSummary[];
  /** Recent day-resolution events (last N) */
  recentEvents: DayResolutionEvent[];
  /** Public chat messages (last N) */
  publicMessages: ChatMessage[];
  /** Private messages to this player */
  privateMessages: ChatMessage[];
  /** Current round number */
  round: number;
  /** Current phase */
  phase: 'day' | 'night';
  /** Available night targets (subset of living) */
  legalTargets: string[];
  /** For voters: list of legal vote targets + 'skip' */
  voteOptions: string[];
  /** Current vote tally (who voted for whom) */
  voteTally: { voterCode: string; choice: string }[];
};
```

### 3.2 Strategy tiers (v1 ships with heuristic only)

| Tier | Name | Description | When used |
|------|------|-------------|-----------|
| 1 | **Random** | Uniform-random legal actions. Baseline for balance. | Default for all roles if no strategy assigned |
| 2 | **Role-aware heuristic** | Rule-based play per role. See §4. | Standard simulation mode |
| 3 | **LLM (bot-manager proxy)** | Calls the external bot-manager HTTP API per-turn. | v2 — for comparing heuristic vs. LLM win rates |

---

## 4. Heuristic strategies (Tier 2)

Each heuristic is a few-dozen-line pure function. They are intentionally **not** optimal — they model plausible table behavior, not perfect play. The goal is to surface balance issues a real table would encounter, not to find the Nash equilibrium.

### 4.1 Heretic strategies

#### H1 — Murderer
```
Night: Kill a random Loyalist who has NOT been the target in the last 2 nights.
       Prefer players who voted against a Heretic in the previous day.
       If only Heretics remain as legal targets, kill the one with highest drift (frame them).
Day:   Vote to interrogate a Heretic (bus) on alternating rounds;
       otherwise vote for the player with lowest drift (they look clean).
       Justify votes with generic "something feels off" phrasing.
```

#### H2 — Heretic Priest
```
Night: Target the Loyalist with the lowest current drift.
       Rotate: False Comfort (default), Twisted Hymn on anyone in Yellow,
       Warp Litany on anyone in Orange+.
       Skip if all targets are already Black (waste of sermon).
Day:   Vote with the Murderer's choice (coordinate via faction chat simulation).
       Claim Priest actions if accused — describe sermons as "cleansing."
```

#### H3 — Conspirator
```
Night: No action. If alive, track who the Interrogator seems to be targeting.
Day:   Once per day, forge a message from a Loyalist (prefer Interrogator if known)
       saying something suspicious about another Loyalist.
       Vote to interrogate the player being framed.
       If no clear target, forge generic confusion ("I'm not sure about anyone anymore").
```

#### H4 — Saboteur
```
Night: Trap the player most likely to be targeted by the Interrogator tonight.
       If Interrogator identity unknown, trap the player who talked most in day chat.
Day:   Vote conservatively — follow the Heretic bloc. Avoid drawing attention.
```

#### H5 — Recruiter
```
Night: Catalyst on any player at Black (drift 20). If no Black target, sleep (recover drift).
       Prefer targeting a high-value Loyalist role (Interrogator > Priest > Chirurgeon)
       if multiple are at Black.
Day:   Vote to interrogate players in Red zone (push them to Black).
       Suggest lynches only when the target is not a Heretic.
```

### 4.2 Loyalist strategies

#### L1 — Imperial Citizen
```
Night: Sleep (auto, no action to submit).
Day:   Vote for the player who voted to stand down last round (suspicious).
       If no such player, vote for the player with the most votes already (follow the crowd).
       30% chance to vote skip (modeling indecision).
```

#### L2 — Interrogator
```
Night: Target the player who received the most votes last day but wasn't killed.
       Intensity: T2 by default. T3 if target is already at Orange+.
       T1 if Interrogator's own drift is Orange (conserving drift).
Day:   Vote for the player scanned as suspicious last night.
       If scan was "clean," vote for a different high-vote target.
       Share results selectively — only reveal if "something doesn't add up" (T2+).
```

#### L3 — Chirurgeon
```
Night: Protect the Interrogator (if known) or the player who spoke most authoritatively.
       Self-protect if own drift is Yellow+ and no better target.
       Rotate targets (cannot protect same target consecutive nights).
Day:   Vote with the apparent town core. Avoid being the deciding vote.
```

#### L4 — Novice-Psychic
```
Night: Scan the player who was most recently interrogated (track if drift changed).
       If none, scan the player who voted differently from the majority.
Day:   Vote against players who read as Yellow+ (regardless of alignment — drift is the signal).
       "Their warp-shadow is thickening" — push for interrogation of high-drift players.
```

#### L5 — Arbitrator
```
Night: Proxy the Interrogator (if known) or the Priest.
       If neither known, proxy the player with the most votes last round (likely target).
Day:   Vote with the town core. If proxy fired (learned next day), announce it publicly.
```

#### L6 — Priest (Loyalist)
```
Night: Whisper on the player with highest drift among Loyalists.
       Hymn on players who hit Orange. Litany on a player entering Red.
       Save Litany for emergency — only use if someone would otherwise convert.
Day:   Vote against high-drift players. Claim Priest openly if accused.
```

#### L7 — Sanctioned Psyker
```
Night: Hold the kill until there's a near-certain Heretic target (scan-confirmed or obvious bus).
       Fire when: Interrogator confirmed a Heretic, OR a player survived 2+ interrogations,
       OR the game is at risk of Heretic parity and a kill might flip it.
       Otherwise sleep (recover drift — Psyker starts with high driftWeight).
Day:   Vote like a Citizen. Never claim Psyker — claim Citizen if pressed.
```

---

## 5. Simulator runner

### 5.1 Single-game flow

```
1. Create HeresyGameManager with temp SQLite DB
2. Spawn N agents with assigned strategies
3. Create game, join all agents, ready up, start
4. While game.status === 'active':
   a. If phase === 'night':
      - Collect night actions from all living agents
      - Submit each action to the engine
      - Call resolve() → processes night, may end game
   b. If phase === 'day':
      - Day 1: no vote, call advance() immediately
      - Day N≥2:
        - Ask each agent for their vote (with justification text)
        - Submit votes to engine
        - If day_stage === 'response':
          - Interrogated agent responds (confess/resist/refuse-break)
        - Call advance() → resolves day, may end game
5. Extract result: winner, round_count, final state of all players
6. Close and delete temp DB
```

### 5.2 Batch runner

```
CLI: heresy-sim run --games 1000 --players 8 --seed 42

1. Parse args: player count, game count, strategy mix, output format
2. Create seeded RNG
3. For i in 1..N:
   a. Run one game (see §5.1)
   b. Collect result into aggregator
   c. Print progress every 10 games (or use a progress bar)
4. Write results to output/
5. Print summary to stdout
```

### 5.3 Strategy assignment

By default, agents are assigned strategies randomly proportional to the role composition. Strategies are role-aware: an agent that draws `murderer` automatically uses the Murderer heuristic.

Override via `--strategy-mix`:
```
--strategy-mix random:30,heuristic:70   # 30% random, 70% heuristic
```

This lets you measure how much strategy quality affects balance.

---

## 6. CLI interface

```
heresy-sim <command> [options]

Commands:
  run         Run batch simulation
  single      Run one game with verbose logging (debug mode)
  report      Generate report from a previous run's results JSON

Options for `run`:
  --games, -g <n>          Number of games to simulate (default: 1000)
  --players, -p <n>        Player count 5-12 (default: 8)
  --seed <n>               RNG seed for reproducibility (default: timestamp)
  --output <dir>           Output directory (default: ./sim-results/)
  --strategy-mix <s>       Comma-separated strategy:weight pairs (default: heuristic:100)
  --composition <preset>   Force role composition preset (e.g. "8" or "custom:role1,role2,...")
  --max-rounds <n>         Abort game after N rounds, count as draw (default: 30)
  --parallel <n>           Number of parallel workers (default: os.cpus().length)
  --format <fmt>           Output format: json, csv, markdown (default: json)

Options for `single`:
  --players, -p <n>        Player count (default: 8)
  --verbose, -v            Print every action and phase transition
  --seed <n>               RNG seed

Options for `report`:
  --input <file>           Results JSON from a previous run
  --format <fmt>           Output format (default: markdown)
```

---

## 7. Output format

### 7.1 Per-run results JSON (`results.json`)

```json
{
  "meta": {
    "simVersion": "1.0.0",
    "timestamp": "2026-07-20T12:00:00Z",
    "seed": 42,
    "playerCount": 8,
    "gameCount": 1000,
    "strategyMix": { "heuristic": 100 },
    "compositionPreset": "8"
  },
  "summary": {
    "loyalistWins": 523,
    "hereticWins": 451,
    "draws": 26,
    "loyalistWinRate": 0.537,
    "avgRounds": 6.2,
    "medianRounds": 6,
    "avgDriftAtEnd": 8.4,
    "conversionRate": 0.12
  },
  "perRole": {
    "murderer": {
      "games": 1000,
      "survivedToEnd": 312,
      "avgDriftAtEnd": 11.2,
      "avgKills": 2.1,
      "lynchedRate": 0.41
    },
    "interrogator": {
      "games": 1000,
      "survivedToEnd": 478,
      "avgDriftAtEnd": 7.8,
      "correctScans": 1.9,
      "falseScans": 1.2,
      "executeOnSightCount": 0.3
    }
  },
  "games": [
    {
      "seed": 42,
      "winner": "loyalist",
      "rounds": 7,
      "composition": ["murderer","heretic-priest","saboteur","sanctioned-psyker","priest","interrogator","chirurgeon","arbitrator"],
      "players": [
        { "role": "interrogator", "faction": "loyalist", "alive": true, "drift": 12, "kills": 0, "lynched": false }
      ]
    }
  ]
}
```

### 7.2 Markdown report (`report.md`)

A human-readable summary with tables:
- Overall win rates
- Win rate by player count
- Win rate by composition preset
- Per-role statistics table
- Drift distribution histogram (text-based)
- Round-count distribution
- Notable outliers (fastest games, longest games)

### 7.3 CSV exports (`games.csv`, `players.csv`)

Flat tables for analysis in spreadsheet tools.

---

## 8. Implementation plan

### Phase 1 — Core engine (2-3 sessions)

| Step | What | Files |
|------|------|-------|
| 1.1 | Scaffold `heresy-sim/` package with `package.json`, ESM config | `heresy-sim/package.json` |
| 1.2 | Implement `runner.js` — single-game loop using `HeresyGameManager` | `src/runner.js` |
| 1.3 | Implement `agent.js` — agent registry, state builder, action dispatch | `src/agent.js` |
| 1.4 | Implement `index.js` — CLI with `commander` for `single` command | `src/index.js` |
| 1.5 | Smoke test: `heresy-sim single --players 5` runs one game to completion | — |

### Phase 2 — Random strategies + batch (2 sessions)

| Step | What | Files |
|------|------|-------|
| 2.1 | Implement random agent (uniform-random legal actions) | `src/strategies/random.js` |
| 2.2 | Implement `runner.js` batch loop with parallel workers | `src/runner.js` |
| 2.3 | Implement `report.js` — JSON output + summary aggregation | `src/report.js` |
| 2.4 | Add `run` CLI command | `src/index.js` |
| 2.5 | Smoke test: `heresy-sim run --games 100 --players 8` produces valid results | — |

### Phase 3 — Heuristic agents (3-4 sessions)

This is the meat of the work. Each strategy is one file.

| Step | What | Files |
|------|------|-------|
| 3.1 | Implement Loyalist strategies (L1-L7) | `src/strategies/loyalist.js` |
| 3.2 | Implement Heretic strategies (H1-H5) | `src/strategies/heretic.js` |
| 3.3 | Wire strategy selection: auto-detect role → pick heuristic | `src/agent.js` |
| 3.4 | Test each strategy in isolation: `heresy-sim single --verbose` | — |
| 3.5 | Run 1000-game batches at each player count, check balance | — |

### Phase 4 — Polish (1-2 sessions)

| Step | What | Files |
|------|------|-------|
| 4.1 | Markdown report generator | `src/report.js` |
| 4.2 | CSV export | `src/report.js` |
| 4.3 | `--max-rounds` cutoff for infinite-game detection | `src/runner.js` |
| 4.4 | Seeded RNG utility (shareable across workers) | `src/util.js` |
| 4.5 | README with usage examples | `heresy-sim/README.md` |

---

## 9. Key design decisions

### 9.1 Separate package, not inside heresy-server

The simulator is a consumer of the engine, not part of it. It lives in `heresy-sim/` at the repo root (sibling to `heresy-server/`). It imports the engine source directly — no need for a published npm package. This keeps the engine clean and the simulator self-contained.

### 9.2 In-memory SQLite

Each game creates a fresh `:memory:` SQLite database. No filesystem cleanup needed. The `HeresyGameManager` constructor accepts `databasePath`, and `:memory:` is a valid SQLite path. However, the engine currently calls `fs.mkdirSync(path.dirname(databasePath))` — the simulator should patch or bypass that for `:memory:`.

The simplest approach: use a temp directory (like the tests do) and clean up. This avoids modifying the engine. Tests already use this pattern:

```js
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-sim-'));
const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), ... });
// ... run game ...
manager.close();
fs.rmSync(dir, { recursive: true, force: true });
```

### 9.3 Determinism via seeded RNG

The engine accepts a `random` function in its constructor options. The simulator provides a seedable PRNG (e.g., a simple mulberry32 or a package like `seedrandom`). Same seed → same game outcomes. This makes bugs reproducible.

```js
function seedableRNG(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 4294967296);
  };
}
```

### 9.4 Parallelism

Node.js worker threads. The master spawns N workers, each runs `totalGames/N` games with a different seed offset. Workers report results back via `worker_threads` message passing. The master aggregates.

Single-threaded mode (no `--parallel` flag) is the default and is sufficient for < 1000 games.

### 9.5 No chat simulation (v1)

Agents do NOT produce natural-language chat messages in v1. The "justification" field on votes is a short fixed string (e.g., "Suspicious voting pattern"). This avoids the complexity of LLM-generated chat while still testing the mechanical balance. Chat is metadata for human players; the engine doesn't parse it. The simulated agents *do* simulate faction coordination by sharing their night-action targets through a shared state object — this approximates the Heretic faction chat advantage without generating text.

### 9.6 Composition overrides

The `start()` method already accepts a `composition` parameter. The simulator can pass custom rosters:

```
--composition custom:murderer,heretic-priest,priest,interrogator,chirurgeon,novice-psychic,arbitrator,citizen
```

This enables testing hypothetical compositions without editing `composition.json`.

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Engine is slow per-game (SQLite I/O) | Low throughput | Use WAL mode (already default), batch in-memory |
| Heuristics are too stupid → no signal | Sim results don't reflect real play | Compare against random baseline; if win rates don't diverge, heuristics need improvement |
| Heuristics are too smart → balance looks wrong | Over-tuned to simulator | Deliberately add noise (e.g., 20% random action chance) to model human error |
| Deadlocks (infinite games) | Sim hangs | `--max-rounds` cutoff; detect no-progress streaks |
| Engine API changes break simulator | Maintenance burden | Sim imports from source; same CI runs sim after engine changes |
| Random agent is useless for balance | No actionable data | Skip random-only runs; use random as a baseline comparison against heuristic |

---

## 11. Acceptance criteria

- [ ] `heresy-sim single --players 8 --seed 42` runs one game to completion and prints the winner
- [ ] `heresy-sim run --games 100 --players 8` completes in under 30 seconds
- [ ] Results JSON contains per-role stats, win rates, and per-game breakdowns
- [ ] Same seed produces identical results across runs (deterministic)
- [ ] All 12 role strategies are implemented and never crash
- [ ] Balance report for all player counts (5-12) is generated and shows plausible win rates (no faction wins >80% against heuristics of equal quality)
- [ ] `--max-rounds 30` correctly aborts infinite games
- [ ] Tests exist for each heuristic strategy (verifying they return legal actions)

---

## 12. Future extensions (v2+)

- **LLM agent integration**: Call the bot-manager HTTP API per-turn, using the same `AgentState` structure. Compare LLM vs. heuristic win rates.
- **Strategy calibration**: Run a genetic algorithm to tune heuristic parameters for 50/50 balance, then compare against human playtest data.
- **Composition search**: Automatically test all valid role combinations to find balanced rosters.
- **Heatmap visualization**: Generate drift-over-time heatmaps per role.
- **Replay format**: Save full game traces in a format the web client can replay (time-synced event stream).
