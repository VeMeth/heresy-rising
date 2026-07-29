---
title: Lynch & Torture
description: How the Conclave's day-vote resolves — execution, torture, and the marks that follow.
---

# Lynch & Torture

> *The Conclave does not debate. It sentences.*

The day-vote is the Inquisition's weapon. Each day, the Conclave names someone. The vote's weight decides whether that person **dies** or is **brought in for torture**. This page is the full mechanic — what each outcome does, what marks it leaves, and how the table can fight back.

## 📜 The four outcomes

Every day with a live vote (Day 2 onwards) resolves into one of four outcomes. The vote leader's *share* of living votes — not absolute count — picks the path.

| Vote share on leader | Outcome | Border | What it means |
|---|---|---|---|
| **≥ 60%** of living | **Lynch** | 🔴 Red | Target dies. No role reveal. No faction reveal. |
| **< 60%** but leader | **Torture** | 🟠 Orange | Target survives. Skips next night. Carries the *tortured mark*. |
| **> 50% Stand down** | **Disperse** | — | No event fires. The Conclave stands down. |
| **All-skip** or tied drift | **Skip** | — | No event fires. Day ends. |

> **60% of living, not max players.** Day 2 with 8 alive needs 5 votes to lynch. Day 5 with 4 alive needs 3.

---

## 🩸 Lynch (≥ 60%, red border)

The Conclave has assembled near-consensus. The target dies — that's it. No role, no faction, no story. The system moves on.

| Effect | Triggered? |
|---|---|
| Target dies | ✅ Always |
| Alignment revealed | ❌ Never |
| Role revealed | ❌ Never |
| Cripple tier | Forced to MAX (3) |
| Witness drift (`+1` to every living player) | ✅ Always |
| Wrong-lynch drift (`+2` to each voter, **only if target was Loyalist**) | ✅ If the dead player was a Loyalist |

> **Wrong-lynch is the single biggest drift event in the game.** Every voter pays `+2`, every witness pays `+1`. Lynch a Heretic and the Conclave gets a clean kill; lynch a Loyalist and the Conclave takes `+2` each on the way out. The Conclave must vote *sure*, not *fast*.

---

## 🟠 Torture (< 60%, orange border)

The Conclave has *suspected* but not *agreed*. The leader survives but pays in two ways: **tonight**, and **the mark**.

| Effect | Triggered? |
|---|---|
| Target survives | ✅ Always |
| Alignment revealed | ❌ Never |
| Role revealed | ❌ Never |
| **Skip next night action** | ✅ Always |
| **Tortured mark** is set | ✅ Always |
| Drift (witness) | ❌ Never — torture alone costs no drift |

> **The tortured mark is the weapon.** A player who was tortured once and becomes the lynch leader again — *on any later day, with any vote count* — is **executed**. Below 60%, above 60%, doesn't matter. **Two tortures = death.** No cabal defense. No spacing escape. The mark persists across skip days, across different targets being tortured in between, across anything short of dying.

### What the mark does to the marked player

- **Next night: skip** — `skip_next_night = 1`. The marked player cannot take any night action that round. *The next round* — they recover.
- **The mark** — `tortured_before = 1`. Lives on the player's record forever. Cleared only by:
  - **Death** (any cause)
  - **Interrogator T1 scan reading Green** — public, the Interrogator telegraphs their suspicion

### What "skip next night" actually means

Every action the role could have taken — investigate, sermon, drift-hint, bodyguard, kill — is rejected at the server with `"Torture damage blocks this action"` (line 619 of `heresyGameManager.js`). The player is *alive but silent*. They can still chat, still vote the next day.

---

## 💀 The two-torture rule (the kill path two)

This is the engine of the day-game. **Same suspect tortured twice = execution.**

| Trigger | Resolution |
|---|---|
| A suspect carries `tortured_before = 1` and becomes the vote leader | **Auto-lynch**, regardless of vote share |
| Vote share on the marked leader | **Doesn't matter** — 1 vote is enough |

So:

| Day | Target | Outcome | Mark after |
|---|---|---|---|
| 2 | Alice | Torture (4/8 votes) | `tortured_before = 1` |
| 3 | Bob | Torture (3/8 votes) | `tortured_before = 1` on Bob |
| 4 | Alice (any vote count) | **Lynch** (mark escalation) | Alice dead |
| 5 | Alice's faction-mate | Day continues | — |

**The Conclave doesn't have to reach 60% the second time.** They can vote Alice off with one vote if they want — the moment she's the leader, the mark converts the probe into an execution.

### Why this exists

The 6p+ cabal has too much tempo without it. Without the mark, the day-vote either kills (Conclave needs 60% consensus, which the cabal can block) or does nothing (cabal wins by outnumbering). The mark gives the Conclave a *second-strike* path: **probe at 30% once, lock at 30% again**. The cabal's defense — pivot to a different target — doesn't clear the mark.

### Cabal defenses

| Strategy | Effect |
|---|---|
| **Pivot to clean target** | Doesn't clear the marked player's `tortured_before`. The next probe on them still escalates. |
| **Skip the day** | Mark persists through skip days. |
| **Lynch the marked player themselves** | Works — the marked player dies, the mark goes to the grave with them. But this is a 60% lynch, costing the Conclave the usual drift. And the cabal just spent a day *not* killing a Loyalist. |
| **Lynch a different marked player** | Wastes the Conclave's day on a Conclave member. Net positive for the cabal. |

The mark is a **non-pivotable commitment**. Once a player has been tortured once, every subsequent day-vote on them is the cabal's *last day* with that player alive.

---

## 🛡️ The Interrogator can clear a mark

The **Interrogator** (L2) can spend their **T1 scan** on a marked player to clear the mark. But the scan has to come back **clean** — and the read is the Interrogator's true zone, not the noisy display.

| Interrogator's true read on marked player | Result |
|---|---|
| 🟢 **Green (0–4)** | Mark **cleared**. Player is fully absolved. The Interrogator's read is treated as definitive. |
| 🟡 Yellow (5–9) | Mark **stands**. Read is too noisy to override the Conclave's call. |
| 🟠 Orange (10–14) | Mark **stands**. |
| 🔴 Red (15–19) | Mark is **reinforced** — set to 1 if it was 0, kept at 1 if it was already set. **One Red read is enough to weaponize a player for execution on their very next day-vote torture.** |
| ⬛ Black (20) | Moot. The player is already lost. |

> **The clearing is public.** The cabal sees the Interrogator reach for that player and knows the Interrogator thinks they're clean. That's the cost — the Interrogator telegraphs their suspicion. The mark-clear is a *defensive* play, not a stealth play.

**What this means for the Interrogator's job:** the right time to scan is *before* the first torture vote, not after. Once the mark lands, the Interrogator has spent their T1 scan and the cabal has read their hand.

---

## 🩹 Cripple tiers — what torture damage looks like

The tortured player's `cripple_tier` rises. The tier is the visible "how broken are you" measure.

| Tier | Effect on the player |
|---|---|
| **0 — Clean** | No damage. Full night action, full day-vote, no justification required. |
| **1 — Wounded** | Skip next night action. Recovers automatically at the start of the next day (provided no re-torture). |
| **2 — Crippled** | Permanent until the mark clears. **Justify every vote in writing** (no empty accusations). Cannot act at night. |
| **3 — Shattered** | Max tier. Cannot respond to torture normally — must be **directly asked** to confess (an Interrogator action). |

**Day-vote torture alone only escalates to Tier 2** (the second torture on the same suspect kills them outright, so the tier never gets a chance to climb past 2 from torture). Tier 3 is reached via the **refuse-break** response (see below) or via night-side damage paths.

### Recovery

- **Tier 1**: clears at the start of the next day (server-side check in `setPhase`, line 412)
- **Tier 2 and up**: **does not recover naturally.** Cleared only by:
  - The mark itself being cleared (Interrogator T1 Green read on a falsely-marked player)
  - The player's death
  - *Pending*: a Chirurgeon role mechanic (not yet locked)

---

## 🩸 Responding to torture — the response phase

After the torture fires (Tier 1), the tortured player is given a **response window** — a brief in-fiction moment to choose how they take it. The response is *before* Night. Three options, each with a cost.

| Response | Drift cost | Other effect |
|---|---|---|
| **Confess** | — | Role publicly revealed. Confession token issued (blocks same-day re-torture, expires at Night, skips next night action). |
| **Resist** | `+1` self-drift | No reveal. Take it on the chin. |
| **Refuse-break** | `+2` self-drift | Cripple tier forced to **Tier 2 floor** (even if they were at Tier 1). Take the damage rather than the admission. |

> **Confessing is a one-way door.** Once you confess, the table knows your role. The confession token protects you from re-torture that day, but it does not hide you — it *marks* you. Loyalists who confess publicly become immediate targets for the cabal's Night-kill. Heretics who confess publicly are immediately executed by the Conclave.

### When no response is required

If the torture escalates straight to execution (Tier 2 from the two-torture rule), the response phase **does not fire** — the body is already broken. The system logs `"INTERROGATION DEATH"` and moves on.

---

## 📊 Threshold math

The 60% threshold is computed as `Math.ceil(alive * 0.6)`. The numbers, by living count:

| Living | Kill threshold (ceil) | Votes needed | % of living |
|---|---|---|---|
| 4 | 3 | 3/4 | 75% |
| 5 | 3 | 3/5 | 60% |
| 6 | 4 | 4/6 | 67% |
| 7 | 5 | 5/7 | 71% |
| 8 | 5 | 5/8 | 63% |
| 9 | 6 | 6/9 | 67% |
| 10 | 6 | 6/10 | 60% |
| 11 | 7 | 7/11 | 64% |
| 12 | 8 | 8/12 | 67% |

**Key edge cases:**
- **5p** lands exactly on the line — 3/5 is a clean 60% kill.
- **4p** jumps to 75% — near-impossible without unanimity.
- **10p** lands exactly on 60% — same as 5p.
- The Conclave's best anti-probe is keeping the leader **just below 60%** — torture them, bleed their night action, but don't kill them yet. The cabal's best anti-kill is the same thing in reverse: keep the leader **just above 60%** to force a lynch only when they're sure.

---

## ⚔️ Interaction with other mechanics

### Stand-down majority

If **more than 50% of living players** vote Stand down, the day disperses without judgement. No torture, no mark, no drift. Same as an all-skip.

### Tied votes

Drift is the tiebreaker. **Higher drift wins** the lynch leader (even below 60%, so still a torture). If drift also ties, the day is skipped entirely.

### Day 1 — no vote

Day 1 is chat-only. No votes. No outcomes. The first votable day is Day 2. This is encoded by `day.FIRST_VOTING_ROUND = 2`.

### Animus (H6)

A possessed player **cannot vote** (`vote()` rejects them with `"You are possessed and cannot vote today"`). Their controller votes for them via the Animus's own action. The two-torture rule still applies to the possessed player — the mark doesn't care who clicked.

### Confession token

A confessing player gets a one-day token that **blocks re-torture** for the rest of Day phase. It expires at Day→Night transition. It does not stack. It also skips the player's next night action — the *confession itself* is the cost.

---

## 🧪 Edge cases the table will hit

| Case | What happens |
|---|---|
| Lynch leader dies during the day (e.g. animus detonation) | Day skips with reason `invalid-target`. The conclave disperses without judgement. |
| Torture target dies between vote tally and resolution (extremely rare) | Same — day skips, no outcome. |
| Player at Tier 3 is tortured again | The torture *still fires* — they just lose another night action. Tier is saturated at MAX. |
| Skip day after a torture | Mark persists through skip days. The marked player is still at risk. |
| Two players tied, drift tied | Day skipped with reason `tied-drift`. No torture fires. |
| All-Skip vote | Day skipped with reason `skip-majority` (if > 50%) or `no-votes` (if 100%). No outcome. |
| Marked player becomes leader with only 1 vote (their own) | **Lynch.** The mark converts any leadership into execution. |

---

## 🗂️ Coder reference (engine summary)

For readers who want to see the logic in code:

| Concept | File / line | Behavior |
|---|---|---|
| Day 1 = no vote | `heresyGameManager.js:412`, `:500` | `votingEnabled = round >= FIRST_VOTING_ROUND` (2). Day 1 returns `outcome: 'skip'`. |
| Stand-down majority | `heresyGameManager.js:519` | `skipCount > totalAlive * STAND_DOWN_MAJORITY` (0.5) → `skipDay('skip-majority')`. |
| Vote tally + threshold | `heresyGameManager.js:517–540` | `threshold = Math.ceil(totalAlive * 0.6)`; `markedForEscalation = target.tortured_before`. Outcome is lynch if either fires. |
| Tier escalation on re-torture | `heresyGameManager.js:570` | `previous = previousDayResolution(...)`; base tier from prior torture if same target yesterday. Otherwise base = live. `tier = base + 1`, capped at `MAX_TIER` (3). |
| Tier 2 = death | `heresyGameManager.js:572–584` | Second torture on same suspect sets `cripple_tier=2`, `alive=0`, reveals role + faction, fires witness drift. |
| Tier 1 = mark + skip-next-night | `heresyGameManager.js:586` | Sets `cripple_tier=1`, `tier1_until_round=g.round`, `skip_next_night=1`, `tortured_before=1`. |
| Tier 1 recovery | `heresyGameManager.js:412` | On day entry: clears `cripple_tier` and `tier1_until_round` if `tier=1 AND tier1_until_round < round`. |
| Lynch | `heresyGameManager.js:587` | Sets `cripple_tier=3, alive=0`. No reveal. Witness drift. **Wrong-lynch** drift `+2` to each voter if target was Loyalist. |
| Response phase | `heresyGameManager.js:588` | Only valid during `phase='day', day_stage='response', last_tortured_target=p`. Options: confess, resist (`+1` drift), refuse-break (tier to 2, `+2` drift). |
| Tier 3 forced confession | `heresyGameManager.js:591` | Only valid at Tier 3. Requires `last_tortured_target`. Marks `confessed=1`, announces role. |
| Interrogator mark-clear | `heresyGameManager.js:497–498` | T1 scan: Green + tortured_before → clear mark. Red → set/reinforce mark. Public via `markNote` in private system message. |
| Stand-down handling | `heresyGameManager.js:546` | `skipDay` writes a `day-resolution` event with `outcome: 'skip'`, no witness drift, no tier. |

---

## 📚 Related pages

- **[Drift — the Warp's corruption](/drift)** — the wrong-lynch drift and witness-drift costs in full
- **[Interrogator](/roles/interrogator)** — the role that can clear a mark or execute-on-sight
- **[Chirurgeon](/roles/chirurgeon)** — *pending* — the proposed role that would clear Tier 2 cripple
- **[How to Play](/how-to-play)** — the five-minute primer

---

*Two strikes. Brutal, fast, and the table has to live with the consequences. — Heretic, court recorder*
