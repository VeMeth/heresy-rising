# Heresy Rising — Game Plan

> Companion to `CONCEPT.md`. Phased roadmap for the **40k-first** path.
> **Last updated:** 2026-07-05 (post design-lock)

---

## Guiding principle

> **Lock the design, then build.** Path is **B (40k-first)**: do not start coding until the design doc is locked end-to-end. The first playable ships the real 40k loop, not placeholders.

---

## Phase 0 — Design lock (CURRENT)

The design is mostly locked. Remaining sub-questions:

| # | Open sub-question | Status |
|---|---|---|
| 1 | Interrogation vote threshold (majority / plurality / supermajority) | 🔶 Open |
| 2 | Drift MAX value | ✅ **LOCKED 2026-07-06:** 20 |
| 3 | Drift trigger magnitudes (per-tier costs) | ✅ **LOCKED 2026-07-06:** T0=−1, T1=+1, T2=+2, T3=+3 |
| 4 | High-power action tiering (which actions cost +1, +2, +3 drift) | ✅ **LOCKED 2026-07-06** per loyalist-kit.md / heretic-kit.md |
| 5 | Role roster (which roles ship in v1) | 🟡 **Open — drafted 2026-07-06:** 11 roles (6 Loyalist + 5 Heretic). Composition table in `data/composition.json` |
| 6 | Faction hostility predicate semantics | 🟡 Default: `isHostileTo(a,b) = a.faction !== b.faction` (trivial) |
| 7 | Day-mode vote (do players vote on the *mode* or on the *target*?) | ✅ **LOCKED 2026-07-13:** target-first, single vote, explicit Skip; see `docs/specs/mechanics/day-phase.md` |

**Additional sub-questions added 2026-07-06 evening session** (defaults locked in HANDOFF.md §13, items 9–16):

| # | Sub-question | Default |
|---|---|---|
| 9 | Priest Hymn frequency | 2×/game |
| 10 | Heretic Priest False Comfort self-cost | 1 |
| 11 | Interrogation tier progression | Auto-escalate 1→2→3 same target |
| 12 | T1 recovery | 1 round no re-interrogation |
| 13 | T3 confession trigger | Forced on direct ask |
| 14 | Confession protection token scope | Block re-interrogation this Day phase |
| 15 | T1 witness drift scope | Every living player except target |
| 16 | Role composition per player count | See `data/composition.json` |

Full tracker: `<repo-root>/projects/heresy-rising/OPEN_QUESTIONS.md`.

**Acceptance for Phase 0:** every sub-question above resolved or explicitly deferred to Phase 2 with a stated default. *Items 9–16 are defaulted but NOT canonical until Nicolas locks them.*

---

## Phase 1 — Build v1

**Trigger to start:** Phase 0 acceptance green.

### 1.1 Scope

| Feature | In v1? | Notes |
|---|---|---|
| Lobby (create / join / ready / host start) | ✅ | Already wired in scaffold |
| Role reveal (private to each player) | ✅ | Already wired |
| Night phase with per-role actions | ✅ | Already wired (placeholder actions) |
| Day phase with target-first vote + Skip | ✅ NEW | Mode is inferred from consecutive-day target history per `docs/specs/mechanics/day-phase.md` |
| Interrogation tiers (1/2/3) with role-tied crippling | ✅ NEW | Per `interrogation.md` |
| Lynch = cripple-to-max + kill + alignment reveal | ✅ NEW | |
| Drift meter with canonical triggers | ✅ NEW | sleep, action tier costs, day-phase outcomes, witnessed violence, Priest sermon deltas |
| Drift visibility = faint hints | ✅ NEW | System cue messages on threshold crossings |
| Heretical catalyst action (converts max-drift player) | ✅ NEW | Role ability; gated by max drift |
| Two factions (Loyalist, Heretic) | ✅ | Subfactions deferred. **11 roles total** (6 Loyalist + 5 Heretic). |
| Public day chat, Heretic faction chat, `#graveyard` | ✅ | Verify wiring |
| Win condition: Heretic parity | ✅ | |
| Admin backup / restore / leaderboard | ✅ | Already exists |
| Replaceable role data files (`data/roles-40k.json`) | ✅ NEW | Engine reads role data from JSON, not hardcoded. **Plus `data/composition.json` for per-player-count role tables.** |

### 1.2 What is **NOT** in v1

- ❌ Puritan / Radical subfactions in code or role data
- ❌ Hidden objectives, quorum-conversion, alternative wins
- ❌ Any of the 15 twist mechanics from `MEMORY.md`
- ❌ 40k lore art / audio / proprietary text (descriptive only)

### 1.3 Acceptance for v1

- [ ] `npm run dev` boots both services
- [ ] 5–12 players can join, ready up, and host starts the game
- [ ] Roles assigned from `data/roles-40k.json` (no hardcoded `ROLES` object)
- [ ] Night actions resolve correctly, including heretical catalyst
- [ ] Day mode switch (interrogate / lynch) is selectable and enforced
- [ ] Interrogation applies tier-tied crippling; recovery rules enforced
- [ ] Lynch applies cripple-to-max + kill + alignment reveal
- [ ] Drift rises only on the four canonical triggers
- [ ] Drift hints are sent to the drifting player only; numeric value never exposed
- [ ] Drift MAX value is configured (default 20, overridable per game) ✅ LOCKED 2026-07-06
- [ ] Tier costs (T0=-1, T1=+1, T2=+2, T3=+3) are wired into night action resolution ✅ LOCKED 2026-07-06
- [ ] Threshold zones (Green/Yellow/Orange/Red/Black) drive intel noise rates ✅ LOCKED 2026-07-06
- [ ] Nightly sleep = −1 (skips action) is enforced ✅ LOCKED 2026-07-06
- [ ] Heretic drift cap (13 by day 3, else +3) is enforced ✅ LOCKED 2026-07-06
- [ ] Priest (Loyalist + Heretic) sermon tiers are wired into role data ✅ LOCKED 2026-07-06
- [ ] Heretic parity win condition triggers correctly
- [ ] No reference to Puritan, Radical, subfaction, or any twist in code

---

## Phase 2 — Subfaction layer

**Trigger to start:** v1 acceptance green + ≥ 1 playtest of v1 with feedback.

Add Puritan and Radical as Loyalist subfactions. Roles gain a `subfaction` field. Puritan vs Radical fight for control of the Loyalist conclave; Heretics unaffected mechanically but gain knowledge of the split.

**Acceptance:** Puritan and Radical have separate win conditions; roles can declare subfaction loyalty; the subfaction layer is toggleable per game.

---

## Phase 3 — Twist layer

**Trigger to start:** Phase 2 acceptance green.

Layer in the 15 proposed twist mechanics from `MEMORY.md`, **one at a time**, each with its own design + balance pass. Convertible Drift (#9), Rosette (#7), and Daemonhost (#13) are likely the first three.

**Acceptance:** each twist is independently toggleable in game setup.

---

## Risks

| Risk | Mitigation |
|---|---|
| Sub-questions 1–7 don't get locked, agents stall | Defer to defaults; flag as "playtest-required" |
| Drift math doesn't balance | Drift MAX is configurable per game (default 20, locked 2026-07-06). Tier costs locked. Tune in Phase 2. |
| Chat game struggles with the interrogate/lynch switch UI | Mode choice is a single button in the day phase panel |
| Heretical catalyst role design is weak | It's just "target a player with X drift." Generic; can be wired into any Heretic-aligned role |

---

## What you can tell your coding agents

> "We're building Heresy Rising. Read `docs/CONCEPT.md` and `docs/GAME_PLAN.md` first. We are on the **40k-first path** — design is locked, do not invent placeholders. Phase 1 only. Do not introduce Puritan/Radical subfactions, twists, or alternative win conditions. Stop and ask if anything in those two files is unclear."
