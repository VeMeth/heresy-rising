<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/OPEN_QUESTIONS.md`
**Locked version:** v1.0.0
**Status:** 🟡 Partial
**Last updated:** 2026-07-13

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [OPEN_QUESTIONS.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Open Questions Tracker — Heresy Rising v1

> **🚧 CODER NOTICE:** Items in this tracker marked 🟡 Default (not 🔒 Locked) are **NOT safe to implement** without explicit "lock it" instruction from Nicolas. Defaults are working assumptions — design may change before canonical lock. If a feature references an item here, verify its status before writing code.

**Version:** 1.0.0
**Status:** 🟡 Partial — defaults locked; canonical-lock pending on individual items
**Last updated:** 2026-07-13 — Q7 day-mode vote fully locked (target-first, single vote, majority threshold, explicit Skip); remaining items as marked
**Source:** Heretic + Nicolas, ongoing across 2026-07-05 / 2026-07-06 / 2026-07-13 sessions
**Companion files:** `mechanics/*.md`, `pitch.md`

---

## Changelog

### 1.0.0 (2026-07-13)
- Q7 day-mode vote fully canonical (target-first, single vote, majority threshold, explicit Skip) — see `mechanics/day-phase.md`
- New drift sub-rules: wrong interrogation +1, right interrogation −1 to all living
- Previous default (mode-first) superseded

### 0.9.0 (2026-07-06)
- Defaults locked for items 9–16 (interrogation tier escalation, confession trigger, witness drift scope)
- Canonical-lock still pending on items 9–16

---

> **Audience:** coding bot (build agent), Nicolas (designer), Heretic (design partner).
> **Purpose:** single source of truth for what's defaulted vs locked. Update this file whenever any item is locked or revised.

This file mirrors `HANDOFF.md` §13 and adds canonical question text, default rationale, and a "what to do when locking" section for each item.

---

## Phase 0 sub-questions (originally 7, now mostly locked)

| # | Question | Default | Status | Source |
|---|---|---|---|---|
| 1 | Interrogation vote threshold (majority / plurality / supermajority) | Plurality + re-vote on tie | 🟡 Open | Phase 0 |
| 2 | Drift MAX value | **20** | ✅ **LOCKED 2026-07-06** | drift.json |
| 3 | Drift trigger magnitudes (per-tier costs) | **T0=−1, T1=+1, T2=+2, T3=+3** | ✅ **LOCKED 2026-07-06** | drift.json |
| 4 | High-power action tiering | T1/T2/T3 per loyalist-kit + heretic-kit | ✅ **LOCKED 2026-07-06** | kit specs |
| 5 | Role roster | **11 roles** (6 Loyalist + 5 Heretic) | 🟡 Drafted 2026-07-06, composition in `data/composition.json` | ROSTER.md |
| 6 | Faction hostility predicate | `isHostileTo(a,b) = a.faction !== b.faction` | 🟡 Default | ROSTER.md §3 |
| 7 | Day-mode vote (mode vs target first) | **Target-first, single vote, majority threshold, explicit Skip. Wrong interrogation +1, right interrogation −1 to all living** | ✅ **LOCKED 2026-07-13** | `mechanics/day-phase.md` §Core mechanic |

---

## Phase 1 build defaults (added 2026-07-06 evening)

> **Every default below is implemented with `// TODO(heresy-spec):` flags.** When Nicolas locks any item, update this file + `HANDOFF.md` §13 + `MEMORY.md` and remove the `// TODO` flag from the relevant callsites.

### Q7 — Day-mode vote (mode vs target first) ✅ LOCKED 2026-07-13

**Question:** Is the day vote mode-first (interrogate/lynch switch, then target) or target-first (target only, mode implied by pattern)?

**Locked answer:** **Target-first.** Single vote per day on a target (or Skip). Mode is implicit in voting pattern:
- Same target for two consecutive days → **lynch** (cripple to MAX + kill + alignment reveal)
- Different target or Skip on consecutive day → **interrogate** (cripple 1 tier, no death, no reveal)
- Vote threshold: **majority of living players (>50%)**
- Explicit **Skip / Stand down** vote option

**Drift rules (locked with the vote mechanic):**
- Wrong interrogation (target = Loyalist): **+1 drift** to voters on losing side (floor of 70% × wrong-lynch penalty)
- Right interrogation (target = Heretic): **−1 drift** to all living players (cleansing — "the Heretic's confession purges the cell")
- Wrong lynch (target = Loyalist): **+2 drift** to voters (locked Q8)
- Right lynch (target = Heretic): **+1 drift** witnessed violence (locked Q8)
- Skip vote: no drift change, escalation streak resets

**Rationale:** Faster chat-game pacing (single vote vs two). Avoids "accidental lynch" by making escalation require intent. Drift asymmetry between wrong-interrogate (+1) and wrong-lynch (+2) preserves "interrogate is gentler" intuition while keeping interrogation as a viable daily tool. Right-interrogate cleansing gives the table a reason to interrogate even when suspicion is low.

**Lock action:** Remove `// TODO(heresy-spec): day-mode-vote` from day-phase engine logic. Update `HANDOFF.md` §13 to reference `mechanics/day-phase.md` §Core mechanic. Coder implements per `mechanics/day-phase.md` §Coder implementation notes (vote widget, vote tally, threshold indicator, escalation history, result announcement, cripple tier display, drift hint system).

**See:** `mechanics/day-phase.md` for full spec (drift table, edge cases, wire payload suggestions, state machine).

### Q8 — Interrogation tier progression

**Question:** How does tier progression work? Auto-escalate same-target repeat? Different-target reset?

**Default:** Same-target repeat auto-escalates 1 → 2 → 3. Different target resets to 1. T1 recovers after 1 round of no re-interrogation. T2/T3 permanent.

**Rationale:** Matches "cumulative damage" framing in original `interrogation.md` proposal. Lower-bound recovery so T1 doesn't become useless.

**Lock action:** Remove `// TODO(heresy-spec): tier-progression` from interrogation logic. Update `interrogation.md` § Defaults Locked. Mark Q8 ✅ in HANDOFF.md §13.

---

### Q9 — Confession mechanic (Tier 3 trigger)

**Question:** Is confession automatic at T3, or forced only on direct ask?

**Default:** T3 confession forced **on direct ask only** (not automatic broadcast).

**Rationale:** Original `interrogation.md` §3 used the literal phrase "if asked directly." Preserved as written.

**Lock action:** Remove `// TODO(heresy-spec): t3-confession` from win-condition check. Update `interrogation.md`. Mark Q9 ✅ in HANDOFF.md §13.

---

### Q10 — Confession protection token

**Question:** What does the token protect against, and for how long?

**Default:** Blocks re-interrogation for the rest of THIS Day phase only. Does NOT block night actions. Refreshes on new confession. No stacking. Faction-blind.

**Rationale:** Otherwise the table just re-interrogates every Confessor; tokens must decay or the mechanic is gamed.

**Lock action:** Remove `// TODO(heresy-spec): protection-token`. Update `interrogation.md` § Defaults. Mark Q10 ✅.

---

### Q11 — T1 witness drift scope

**Question:** Does "witnesses" mean every living player except the target?

**Default:** **Yes.** Every living player except the target pays +1 on T1 interrogation.

**Rationale:** Matches CONCEPT.md §3c "witnessed violence = all living players." T2/T3 add no witness drift — crippling effect is the cost.

**Lock action:** Remove `// TODO(heresy-spec): witness-scope`. Update `interrogation.md`. Mark Q11 ✅.

---

### Q12 — Priest Hymn frequency

**Question:** 2 or 3 uses per game?

**Default:** **2× per game.** Hard cap.

**Rationale:** Lower bound of original "2–3" range. Single value for engine. Hymn at "2–3" with no hard cap was exploitable across long games.

**Lock action:** Remove `// TODO(heresy-spec): hymn-freq` from Priest sermon cap. Update `drift.json` and `drift.md` § Priests. Mark Q12 ✅.

---

### Q13 — Heretic Priest False Comfort self-cost

**Question:** 0 or 1 self-cost?

**Default:** **1.** Self-cost matches Loyalist Whisper.

**Rationale:** At self-cost 0, False Comfort would *beat* Loyalist Whisper on cost-effectiveness while doing inverted damage. Implausible.

**Lock action:** Remove `// TODO(heresy-spec): false-comfort-cost` from Heretic Priest action. Update `drift.json` and `drift.md`. Mark Q13 ✅.

---

### Q14 — Role composition per player count

**Question:** What composition for each player count 5–12? Are non-Citizen roles unique?

**Default:** See `data/composition.json`. Non-Citizen roles unique; Citizens repeat.

**Rationale:** Parity-rule-friendly (Heretics ≤ Loyalists at start). Hard rules: `priest` ≥5p, `heretic-priest` ≥6p, `recruiter` ≥8p, `conspirator` ≥11p.

**Lock action:** After first v1 playtest, revise `data/composition.json` based on real data. Update ROSTER.md §2f with revised table. Mark Q14 ✅.

---

## Acceptance checklist for Phase 1 build

When shipping v1, every callsite that uses a defaulted mechanic must have:

```ts
// TODO(heresy-spec): Q[N] default — [short description]
// Replace with canonical value when Nicolas locks.
```

And `docs/OPEN_QUESTIONS.md` (this file) must be checked against the codebase: every open Q has at least one `// TODO(heresy-spec):` callsite. When Nicolas locks a Q, the corresponding `// TODO` lines are removed.

---

## How to add a new open question

When the bot (or you) finds a new spec gap:

1. Add a section to this file with the same shape: question, default, rationale, lock-action.
2. Update `HANDOFF.md` §13 to add the row.
3. Flag every callsite with `// TODO(heresy-spec): Q[N]`.
4. Mention the new Q in MEMORY.md under "Active Threads" so it doesn't get lost.

---

---

## Q15 — Role distribution method (resolved 2026-07-06)

| Field | Value |
|-------|-------|
| Question | How are roles assigned at game start? |
| Default | *(none — was implicit Fisher-Yates shuffle, never specified)* |
| Status | ✅ **LOCKED 2026-07-06** — pure random shuffle (Fisher-Yates). |
| Canonical spec | `projects/heresy-rising/mechanics/setup.md` § Role assignment |
| Code callsite | `heresyGameManager.js` `start()` — no change needed; spec now backs the implementation |

**Lock rationale:**
- Standard Werewolf mechanic; universally understood.
- Anti-detection (drift zones, intel noise, interrogation feedback) does the work — distribution need not be clever.
- Recruitment-via-catalyst mechanic only matters if Loyalists were *randomly* assigned as Loyalist.

**Companion fix shipped same day:**
- Lobby **no longer leaks role names**. Server `state()` projection drops `composition`, exposes only `compositionLabel: "<n>-operative doctrine"`. Client `<LobbyView.vue>` updated to consume the label.
- See `mechanics/setup.md` § Composition privacy.

---

*Last updated: 2026-07-06 23:42 GMT+2 — Q15 locked.*
