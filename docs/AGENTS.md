# Heresy Rising — Agent Handoff

> **Status:** Ready to build — Phase 1
> **For:** Claude Code / Codex / Cursor / any coding agent
> **Read first:** `CONCEPT.md`, then this file.
> **Rule:** Do not invent. If something is not in these docs, stop and ask.

---

## What we are building

**Heresy Rising** is a persistent, chat-based social deduction game (Werewolf/Mafia style) for 5–12 players, set in the Warhammer 40,000 universe. Played in Telegram/Discord. Server-authoritative. SQLite persistence.

**v1 scope only.** One loop: lobby → night → day → repeat → faction win. No subfactions, no twists, no alternative win conditions.

---

## Tech stack

| Layer | Technology |
|---|---|
| Client | Vue 3 + Vite in `heresy-client/` |
| Server | Node.js + Express + Socket.IO in `heresy-server/` |
| Persistence | SQLite (`heresy-server/data/`) |
| Tests | Playwright in `tests/e2e/` |
| Data | Role configs in `data/roles-40k.json` (engine reads JSON, not hardcoded objects) |
| Dev | `npm run dev` (both services), `npm run test:e2e` |

---

## Architecture (already scaffolded)

```
heresy-rising-site/
├── heresy-client/      # Vue 3 SPA
├── heresy-server/       # Express + Socket.IO API
│   └── data/            # SQLite DB (not committed)
│   └── src/             # Server source
├── data/                # Role & game config JSON files
│   └── roles-40k.json  # ← PRIMARY: all role definitions here
├── tests/e2e/           # Playwright tests
└── docs/
    ├── CONCEPT.md       # Design brief — read this first
    ├── GAME_PLAN.md     # Roadmap
    ├── ROSTER.md        # Role list (drafted)
    ├── AGENTS.md        # ← YOU ARE HERE
    ├── mechanics/
    │   ├── drift.md     # Drift numbers & Priest tiers
    │   ├── interrogation.md  # Day-phase mechanic
    │   ├── loyalist-kit.md   # 5 Loyalist role specs
    │   └── heretic-kit.md    # 5 Heretic role specs
    └── architecture.md  # Existing protocol docs (still valid)
```

---

## Core loop (already wired — verify, don't re-implement)

```
lobby → (host starts) → role reveal → night → day → repeat → faction win
```

Socket events, lobby state machine, and phase transitions **already exist** in the scaffold. Check `architecture.md` before building new phase logic. The job is to wire the game rules into the existing skeleton.

---

## Design decisions locked for v1

These are **constraints**. Do not revisit them.

### Factions & win condition
- Two factions only: `loyalist` and `heretic`. No subfaction field in v1.
- Heretic win: living Heretic count ≥ living Loyalist count (parity).
- Loyalist win: all Heretics eliminated.
- Engine uses `isHostileTo(a, b)` predicate — never compare alignment strings directly.

### Phase loop
- **Night**: eligible roles submit private actions (kill / investigate / protect / catalyze).
- **Day**: table debates, then votes. Vote has two modes:

| Mode | Effect |
|---|---|
| **Interrogate** | Target takes tiered stat damage (crippled, survives). Alignment hidden. |
| **Lynch** | Target crippled to max, then killed. Alignment revealed publicly. |

Mode is chosen by the table (vote on mode → vote on target, OR combined — see open questions).

### Drift (the corruption system)

| Constant | Value |
|---|---|
| MAX | **20** |
| Starting value | **0** |
| Nightly sleep (skip action) | **−1** |
| Conversion threshold | **20 (MAX)** |
| Drift floor | **0** (sleep can't fully cleanse) |
| Heretic cap | **13** by end of Day 3 — else +3 spike |

**Tier costs (locked):**

| Tier | Cost | Examples |
|---|---|---|
| T0 — sleep | −1 | Skip night action |
| T1 — soft intel | +1 | Light investigation, protect, bodyguard |
| T2 — active intel | +2 | Standard investigation, kill, trap |
| T3 — power play | +3 | Brutal interrogation, heretical catalyst |

**Four canonical drift triggers:**

| Trigger | Cost |
|---|---|
| Wrong lynch (voted to kill an innocent) | +2 |
| Witnessed violence (night kill, public execution) | +1 |
| Used a high-power night action | +1 / +2 / +3 (by tier) |
| Voted with the eventual losing side | +1 (halts after Day 5) |

**Threshold zones (intel noise = zone noise rate on Interrogator/Oracle output):**

| Zone | Drift | Intel noise |
|---|---|---|
| 🟢 Green | 0–4 | 0% |
| 🟡 Yellow | 5–9 | 20% |
| 🟠 Orange | 10–14 | 40% |
| 🔴 Red | 15–19 | 80% |
| ⬛ Black | 20 | 100% — convert-vulnerable |

**Visibility rule:** Drift hints are system cues sent to the player only. The numeric value is never shown publicly. The table sees nothing.

### Interrogation tiers (day damage)

| Tier | Effect | Drift cost |
|---|---|---|
| **1 — Light Scarring** | Lose one night action this round | +1 (witnessed) |
| **2 — Broken** | Lose all night actions; vote weight −1; must justify votes | +2 |
| **3 — Crippled** | No night actions; must confess if directly asked; overflow → conversion | +3 (overflow) |

Lynch = Tier 3 + kill + public alignment reveal.

### Priest (Loyalist — two roles, one claims each)

**Loyalist Priest sermon tiers:**

| Tier | Self-cost | Target effect | Frequency |
|---|---|---|---|
| Whisper | +1 | −2 target drift | Daily |
| Hymn | +3 | −5 target drift | 2–3/game |
| Litany | +6 | −10 target drift | Once/game |

**Heretic Priest (claims Loyalist Priest — same UI, inverted math):**

| Tier | Self-cost | Target effect | Stealth |
|---|---|---|---|
| False Comfort | 0–1 | +3 target drift | Looks like Whisper |
| Twisted Hymn | +2 | +7 target drift | Feels "strengthened" |
| Warp Litany | +4 | +12 target drift | Drives toward Red |

Detection: track drift deltas after Priest interventions. Loyalist whose "intervention" raised target's drift = Heretic Priest signal.

---

## v1 Role roster (DRAFTED — pending explicit lock)

Roles live in `data/roles-40k.json`. Engine reads from this file. Shape:

```ts
type Role = {
  id: string;           // e.g. 'interrogator'
  displayName: string;  // e.g. 'Interrogator'
  faction: 'loyalist' | 'heretic';
  subfaction: null;     // v1: always null
  driftWeight: 0 | 1 | 2 | 3;  // tier cost
  actions: {
    night?: {
      kind: 'kill' | 'investigate' | 'protect' | 'heretical-catalyst' | 'shield' | 'watch' | 'sermon' | 'boobytrap' | 'forgery';
      target: 'self' | 'other' | 'any';
    };
    day?: { kind: 'vote' | 'forgery' };
  };
  crippleProfile: {
    blocks: string[];            // capabilities disabled on cripple
    onCripple: 'disable-one' | 'disable-all';
  };
  ability: string;    // shown only to owner
  objective: string; // win-condition reminder
};
```

**Loyalist (5 roles — DRAFTED):**

| ID | Display | Night action | Day | Tier |
|---|---|---|---|---|
| `citizen` | Imperial Citizen | None (sleep T0 = −1) | Vote | T0 |
| `interrogator` | Interrogator | Investigate (3 modes: story consistency / cross-reference / cumulative) | — | T2 |
| `chirurgeon` | Chirurgeon | Protect one player (Doctor slot) | — | T1 |
| `novice-psychic` | Novice-Psychic | Drift hint on one player (qualitative, zone-bounded) | — | T1 |
| `arbitrator` | Arbitrator | Bodyguard — absorb hit for one player | — | T1 |

**Heretic (5 roles — DRAFTED):**

| ID | Display | Night action | Day | Tier |
|---|---|---|---|---|
| `murderer` | *(claims Citizen)* | Kill one player | — | T2 |
| `heretic-priest` | *(claims Priest)* | Inverted sermon (False Comfort / Twisted Hymn / Warp Litany) | — | +0–4 |
| `conspirator` | *(claims Citizen)* | — | Post message attributed to another player | T1 |
| `saboteur` | *(claims Citizen)* | Booby-trap one player (any action on trapped → fails + actor +5 drift) | — | T2 |
| `recruiter` | *(claims Citizen)* | Heretical catalyst on Black-zone (20) target → flip | — | T3 |

**Design laws (locked, do not violate):**
- Every Heretic has a believable Loyalist-aligned claim.
- Higher driftWeight = stronger night action = faster drift accumulation.
- Interrogator intel degrades by zone noise rate.
- Novice-Psychic reads drift, not alignment. Blind to clean Heretics.
- Chirurgeon (protect) and Arbitrator (bodyguard) are mechanically distinct.

---

## Open questions (decision required before coding these features)

These are **blocked**. Do not implement until the owner resolves them.

| # | Question | Affected code |
|---|---|---|
| **O1** | Day-mode vote: do players vote on *mode* first, then target? Or combined (nominate → mode implied by nomination)? | Day-phase logic |
| **O2** | Interrogation vote threshold: majority / plurality / supermajority? | Vote resolution |
| **O3** | Saboteur trap: one per night, or one per game? | Saboteur role logic |
| **O4** | Recruiter failure: does Recruiter learn "target not at Black"? | Recruiter role logic |
| **O5** | Interrogator cumulative investigation: cap at 2 nights on same target? | Interrogator logic |

**Default recommended answers** (playtest will confirm or change):
- O1: Nomination → combined vote (simpler UI)
- O2: Simple majority of living players
- O3: One per night
- O4: Silent fail (Recruiter doesn't learn)
- O5: Cap at 2 nights

---

## What NOT to build in v1

- Puritan / Radical subfactions (any `subfaction` field must be `null` for v1)
- Any of the 15 twist mechanics from MEMORY.md
- Hidden objectives, alternative win conditions
- Mobile native app
- Persistent account / login system (player codes are bearer credentials)
- Scenario variants (voidship / planet / regiment)
- Anti-Priest (Priest detection goes through drift-delta tracking, not a separate role)

---

## How to verify your work

```bash
npm install
npm --prefix heresy-server install
npm --prefix heresy-client install
npm run dev          # boots both services
npm run test:e2e     # runs Playwright suite
```

**Smoke test:** 5 players join, ready up, host starts. Roles assigned. Night resolves. Day resolves. Repeat to win condition. All sockets, phase transitions, and role data must come from `data/roles-40k.json` — no hardcoded role objects anywhere in the engine.

---

## Where to find things

| Need to know | File |
|---|---|
| Full design brief | `docs/CONCEPT.md` |
| Roadmap & acceptance criteria | `docs/GAME_PLAN.md` |
| Role list | `docs/ROSTER.md` |
| Drift numbers & Priest tiers | `docs/mechanics/drift.md` |
| Interrogation tiers | `docs/mechanics/interrogation.md` |
| Loyalist role specs | `docs/mechanics/loyalist-kit.md` |
| Heretic role specs | `docs/mechanics/heretic-kit.md` |
| Existing server/client scaffold | `architecture.md` |
| This file | `docs/AGENTS.md` |

---

## Who to ask

If anything in these docs is unclear, ambiguous, or seems to contradict another section — **stop and ask**. Do not guess. The design is detailed enough that ambiguity is a signal something needs a decision, not a cue to improvise.
