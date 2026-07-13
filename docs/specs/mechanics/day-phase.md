<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/day-phase.md`
**Locked version:** v1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-13

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [mechanics/day-phase.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Heresy Rising — Day Phase

> *The daily heartbeat of the game. One round = one vote. The mode is implicit in the pattern, not explicit in a separate vote.*

**Version:** 1.0.0
**Status:** 🔒 Locked — day-phase mechanic canonical, 2026-07-13 (resolves Q7 day-mode vote)
**Last updated:** 2026-07-13 — Day-phase mechanic locked by Nicolas after discussion; sub-rules for wrong-interrogation, right-interrogation cleansing, and explicit Skip all filed. Resolves `OPEN_QUESTIONS.md` Q7.
**Source:** Telegram session 2026-07-13 21:28–21:34 GMT+2 (Nicolas + Heretic)
**Companion files:** `setup.md` (Conclave/role-reveal), `heretic-kit.md` (Heretic drift costs), `loyalist-kit.md` (Loyalist drift costs), `interrogation.md` (interrogation tier escalation — referenced for cripple tiers)
**Replaces:** v0 placeholders in `setup.md` "Day phase" section (now superseded)

---

## Changelog

### 1.0.0 (2026-07-13) — Locked

- **Initial lock: day-phase mechanic** (resolves `OPEN_QUESTIONS.md` Q7 day-mode vote)
  - Single vote per day (target + optional Skip)
  - Mode is **implicit** in voting pattern, not a separate mode vote
  - One consecutive day on target = **interrogate** (cripple 1 tier)
  - Two consecutive days on same target = **lynch** (cripple to MAX + kill + alignment reveal)
  - Vote threshold: **majority of living players (>50%)**
  - Explicit **Skip / Stand down** vote option added
- **New drift sub-rule: wrong interrogation**
  - Torturing a Loyalist = +1 drift to voters on the losing side
  - Math: `floor(WRONG_LYNCH_DRIFT × 0.70) = floor(2 × 0.70) = 1`
  - Rationale: 70% of the lynch penalty; "interrogate is gentler than lynch"
- **New drift sub-rule: right interrogation cleanses**
  - Torturing a Heretic = **−1 drift to all living players**
  - Mechanic story: "the Heretic's confession purges the cell"
- **Tie-breaker** locked
  - Top-two tied on votes → higher-drift player wins
  - If still tied → round skipped entirely (no event, no escalation, no reset)
- **Edge case: target dies between rounds**
  - Escalation dies with them. Reset.
- **Edge case: round skipped**
  - Resets escalation. Target becomes "fresh" next day.

---

## 🩸 Core mechanic

The day phase is **one vote per round**, not two. Players do not vote on a *mode* (interrogate vs lynch); they vote on a *target* (or Skip). The mode emerges from the voting pattern:

| Round N | Round N+1 (same target) | Result |
|---|---|---|
| Target = Player X | (different target or Skip) | **Interrogate X** — cripple 1 tier, no death, no reveal |
| Target = Player X | Target = Player X again | **Lynch X** — cripple to MAX + kill + alignment reveal |
| Target = Player X | (X died Night N → N+1) | Reset — X is no longer a valid target |
| Skip | anything | Reset — escalation streak broken |
| Vote threshold not reached | — | Round skipped (no event) |
| Tie on top two targets | — | Higher-drift player wins; if tied on drift, skip |

**Consecutive days = escalation. Different target or Skip = reset.**

---

## 🎯 Vote rules

### Threshold

> **Majority of living players (>50%)** must cast a vote for a non-Skip target.

- Threshold is computed against **living player count** at vote close, not total roster.
- Abstentions count toward the threshold requirement (you must actively vote).
- A "Skip" vote counts as a cast vote but is not a target vote.
- If threshold not met → round is skipped, no escalation, no event.

### Tie-breaker

When the top two targets have equal votes:

1. Higher-drift player wins the tie.
2. If still tied on drift → round skipped entirely.

---

## ⚔️ Interrogation consequences

### Cripple tiers

A player's cripple tier is how badly they've been damaged by past interrogations. Tiers (locked 2026-07-06):

| Tier | Effect | Source |
|---|---|---|
| **T0** | No effect — full power | `loyalist-kit.md` / `heretic-kit.md` per role |
| **T1** | First cripple — minor impairment | Same |
| **T2** | Second cripple — major impairment | Same |
| **T3** | Third cripple — near-useless | Same |

> **Each interrogation on a fresh target = +1 tier.** Lynch = jump straight to T3 + kill + alignment reveal.

### Drift on wrong interrogation

> **+1 drift** to voters who voted for the wrongly-interrogated Loyalist (i.e. voters on the *losing side*).

Math: `floor(WRONG_LYNCH_DRIFT × 0.70) = floor(2 × 0.70) = 1`

Rationale: "Interrogate is gentler than lynch." Mechanically makes players hesitant to interrogate without evidence, but keeps interrogation as a viable daily tool.

### Drift cleansing on right interrogation

> **−1 drift** to **all living players** when the interrogation target was a Heretic.

Mechanic story: *"The Heretic's confession purges the cell."*

This is the **only mechanic that lowers drift** in v1 (besides drift never recovering from wrong-lynch — once you hit max, you flip via heretical catalyst per locked Q2 / Q3).

---

## ⚔️ Lynch consequences

> Triggered when the same target is voted for two consecutive days.

### Effect chain

1. Target is **crippled to T3** (max tier, regardless of current tier).
2. Target is **killed** — removed from living roster, moved to graveyard channel.
3. Target's **alignment is revealed** publicly to all players (Loyalist or Heretic).
4. Drift triggers fire (see below).

### Drift on lynch

| Outcome | Drift | Recipients |
|---|---|---|
| **Right lynch** (target = Heretic) | +1 (witnessed violence) | All living players |
| **Wrong lynch** (target = Loyalist) | +2 (locked Q8) + +1 witnessed | All voters on the losing side (voters for the lynched Loyalist) + all living players (witnessed violence) |

Wait — flagged inconsistency. Re-read locked Q8:

> **Q8 lynch consequence (locked 2026-07-05):** "D + alignment reveal — two-step escalation (cripple first, then death, alignment shown)."

This is target-first mechanic, not the locked Q6 mode-switch. Coder: **apply the new target-first drift numbers in the Drift table below**, which supersede Q8's mode-switch drift for the new mechanic. The Q8 question in OPEN_QUESTIONS.md is now fully resolved.

---

## 📊 Complete drift table (day-phase outcomes)

| Event | Drift | Recipients | Source |
|---|---|---|---|
| Wrong lynch (target = Loyalist) | +2 | Voters for the lynched target | Locked Q8 |
| Wrong lynch (target = Loyalist) — witnessed | +1 | All living players | Locked Q8 |
| Right lynch (target = Heretic) — witnessed | +1 | All living players | Locked Q8 |
| Wrong interrogation (target = Loyalist) | +1 | Voters for the interrogated target | **New — this spec, 1.0.0** |
| Right interrogation (target = Heretic) — cleansing | **−1** | All living players | **New — this spec, 1.0.0** |

---

## 🎲 Edge cases

### Target dies between rounds

If target of yesterday's vote is killed during the night before today's vote (e.g. Murderer strikes them), the escalation **resets**. They're dead; no consecutive target can apply.

### Day skipped via explicit Skip votes

If majority of living vote Skip (or threshold not met on any target), the escalation **resets**. Any previous-day target becomes fresh again.

### Cripple tier ≥ T3 already

A player at T3 cannot be **interrogated further** (they're already at max tier from past rounds). Voting for them **still escalates to lynch** if they receive votes two consecutive days — the lynch path is still open.

### Player confesses before vote resolves

If a player confesses during the day (e.g. via Priest's Hymn or other heretical pressure), the day-phase vote is **not auto-skipped**. Players can still vote, including re-voting the confessor (which would lynch them). Confession is informational; the vote continues.

### Living player count drops below 5 mid-day

Vote continues with whatever threshold computes from the new count. No special reconfiguration needed.

### All players vote Skip

Round is skipped. Escalation resets.

### Empty living roster (catastrophic)

Game ends. Faction win condition triggered by previous state.

---

## 🛠️ Coder implementation notes

> **These are spec-level handoff notes, not code.** Coder implements; designer (Heretic) writes spec.

### Required components

1. **Vote widget**: target selection + Skip button. One per living player per round.
2. **Vote tally**: real-time count of votes per target + Skip.
3. **Threshold indicator**: shows when majority is reached.
4. **Escalation history**: shows yesterday's target(s) so players can see if re-voting will lynch.
5. **Result announcement**: at round close, show what happened (interrogate / lynch / skip).
6. **Cripple tier display**: per-player indicator of T0/T1/T2/T3.
7. **Drift hint system** (per locked Q3 / 2026-07-06 design notes): when a player crosses drift thresholds (0–4, 5–9, 10–14, 15–19, 20), they receive a private system cue. Drift *values* are never displayed.

### Wire payload shape (informational)

The coder should expect a `dayResolution` event at round close with this shape:

```json
{
  "round": 3,
  "outcome": "interrogate" | "lynch" | "skip",
  "target": "playerCode" | null,
  "voterResults": [
    {"voter": "playerCode", "votedFor": "playerCode" | "skip", "driftDelta": 1}
  ],
  "witnessedDrift": -1,
  "alignmentRevealed": "loyalist" | "heretic" | null,
  "crippleTier": 1
}
```

This is a **suggested shape**, not a locked contract. Coder proposes final wire format.

### State machine

```
CONCLAVE → ROLE_REVEAL → NIGHT → DAY_VOTE → DAY_RESOLUTION → NIGHT → ...
                       ↑                                |
                       └──────── (loop) ────────────────┘
```

`DAY_RESOLUTION` produces one of: `interrogate`, `lynch`, or `skip`. Drift mutations apply immediately. Cripple tier mutations apply immediately. If lynch, target is moved to graveyard and alignment is broadcast.

---

## ❓ Open questions (none — fully locked)

Day-phase mechanic is **fully canonical** as of 2026-07-13. Resolves `OPEN_QUESTIONS.md` Q7 (day-mode vote). No remaining sub-questions for v1.

Downstream items that *touch* this spec but aren't blockers:

- Interrogation tier mechanics (escalation within a single interrogation session — locked in `interrogation.md` per locked 2026-07-06 evening defaults)
- Drift hint UX (locked 2026-07-06 per Q3)
- Drift MAX = 20, threshold zones per locked 2026-07-06

---

## 📚 Related decisions

| Locked decision | Reference |
|---|---|
| Two-faction map (v1) | MEMORY.md, locked 2026-07-05 |
| Interrogation replaces lynching as primary action | MEMORY.md, locked 2026-07-05 |
| Cripple-not-kill pillar | MEMORY.md, locked 2026-07-05 |
| Drift MAX = 20, threshold zones | locked 2026-07-06 |
| Drift endgame (accumulation + heretical catalyst) | MEMORY.md, locked 2026-07-05 (Q2) |
| Drift visibility (faint hints only, no numeric display) | MEMORY.md, locked 2026-07-05 (Q3) |
| Drift triggers (classic four) | MEMORY.md, locked 2026-07-05 (Q8) — **now superseded** by this spec for day-phase outcomes |
| Lynch consequence (cripple + death + alignment reveal) | MEMORY.md, locked 2026-07-05 (Q7) — preserved here |

---

*Spec written by Heretic on 2026-07-13. Owned by Nicolas. Implementation belongs to the separate coding agent.*