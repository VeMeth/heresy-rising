---
title: Drift — the Warp's corruption
description: The primary mechanic of Heresy Rising. What drift is, how it climbs, what the zones mean, and what the consequences are at every level.
---

# Drift — the Warp's corruption

> *The Warp has weight. It leaves marks.*

**Drift** is the primary mechanic of Heresy Rising. Every operative carries a drift score from `0` (clean) to `20` (lost). The score is *hidden*: each player sees only their own drift number, and *only as a soft hint*, never as a figure. The conclave at large sees nothing — only the consequences.

This page is the canonical reference. If you read this once, you understand half the game. Pair it with the [Role Roster](/roles/) and the [How to Play primer](/how-to-play).

## What drift is

The Warp presses against reality. When an operative commits to a Warp-touched act, the pressure settles on *them*. Drift is the measure of that settled pressure — the corpus, the scar, the slow downward tug.

| Term | What it means |
|---|---|
| **The Warp** | The chaos dimension, the source of corruption. *Setting*. |
| **Drift** | The corruption the Warp leaves on an operative's soul. *Mechanic*. |
| **Drift cost** | What the Warp charges for a specific night action. *Numbers*. |
| **Drift zone** | Where the score sits on the ladder: Green → Black. *Read-state*. |
| **Drift hint** | A subjective whisper the system sends when your score crosses a zone boundary. *Mechanic-feedback*. |

> Drift is what you pay for using forbidden gifts. Drift never resets. Once you climb, you stay climbed — that is why every Warp-touched act is a trade-off.

## How drift climbs

Per the [day-phase spec](https://github.com/VeMeth/heresy-rising/blob/master/docs/specs/mechanics/drift.md) (locked 2026-07-05), there are **four canonical triggers**:

| Trigger | Effect on drift | Who pays |
|---|---|---|
| **Wrong lynch** — accusing a Loyalist for two consecutive days | **+2** | Each voter on the losing side |
| **Witnessed violence** — alive at the end of a night in which someone died | **+1** | Every living player who witnessed the kill |
| **High-power night action** — Interrogator T2/T3, Murderer kill, Recruiter catalyst, Heretic Priest Hymn/Litany | **+1 to +3** | The actor (cost printed on each role) |
| **Voted with the losing side** | **+1** | The minority bloc that day |

Sleeping has a small effect in the other direction:

| Trigger | Effect |
|---|---|
| **Sleep** (no night action submitted) | **−1** drift |

> *Citizen exception:* Imperial Citizens **auto-sleep each night** (they have no other action to choose). Their sleep is not opt-in. See the [Imperial Citizen](/roles/imperial-citizen) page for the full mechanic.

Drift does *not* reset across rounds. It accumulates.

## The zone ladder

The drift score divides into five zones. The zones are public information for the *system* and the *Interrogator*; the *player* sees only a hint of their own transitions. The *conclave* sees nothing.

| Zone | Range | Color | The Interrogator reads it as |
|---|---|---|---|
| 🟢 **Green** | 0–4 | Clean | Exact |
| 🟡 **Yellow** | 5–9 | An uneasiness | 10–20% noise |
| 🟠 **Orange** | 10–14 | A chill | 40% noise; **T2+ scan = auto-kill** |
| 🔴 **Red** | 15–19 | A whisper | 40% noise; **T2+ scan = auto-kill** |
| ⬛ **Black** | 20 | The Warp takes you | T2+ scan = auto-kill; **Recruiter catalyst can convert you** |

The Interrogator's accuracy table from the [loyalist kit](https://github.com/VeMeth/heresy-rising/blob/master/docs/specs/mechanics/loyalist-kit.md) (v1.2.0):

| Reader zone | T1 read | T2 read | T3 read |
|---|---|---|---|
| Green | 0% noise | 0% noise | 0% noise |
| Yellow | 10% noise | 20% noise | 40% noise |
| Orange | 20% noise | 40% noise | 60% noise |
| Red | 40% noise | 60% noise | 80% noise |
| Black | 50% noise | 70% noise | 90% noise |

> The Interrogator's *own* drift climbs their scans into noise too. A green-zone Interrogator reads exactly; an Orange-zone Interrogator is half-blind.

## The Interrogator scan & Execute on Sight

The Interrogator picks an intensity each night. The *target's* drift zone auto-upgrades the effective intensity for the scan.

| Chosen intensity | Cost (you) | What you learn |
|---|---|---|
| **T1 — Soft** | +1 | Binary "Tainted (Yellow+) / Clean (Green)." 70% true, 30% flipped. |
| **T2 — Standard** | +2 | The drift **zone** (Green / Yellow / Orange / Red / Black). |
| **T3 — Brutal** | +3 | Confirmed faction identity. |

The intensity-vs-zone table (target zone, not reader zone):

| Target zone | T1 | T2 | T3 |
|---|---|---|---|
| 🟢 Green | T1 = binary | T2 = zone | T3 = confirmed |
| 🟡 Yellow | T2 = zone | T3 = confirmed | T3+ = confirmed |
| 🟠 Orange | T3 = confirmed | **auto-kill** | **auto-kill** |
| 🔴 Red | T3 = confirmed | **auto-kill** | **auto-kill** |
| ⬛ Black | T3 = confirmed | **auto-kill** | **auto-kill** |

**Execute on Sight** is when chosen intensity is T2 or T3 against an Orange+ target. The Heretic dies, the alignment is publicly revealed, and the Interrogator pays their standard cost.

> Because of zone-upgrade math, **T1 against an Orange+ target does not kill**. Chosen intensity matters more than effective intensity for the kill gate. A Red-zone Heretic who gets scanned at T1 every night gets caught, but the Interrogator pays only +1 per night — that's the cell-rotation pressure.

## What happens at Black

You reach `20`. The Warp settles completely.

Two readings are possible:

| Consequence | Trigger |
|---|---|
| The Recruiter's **catalyst** converts you into a Heretic | A Recruiter targets you at exactly drift `20` |
| You live and fight on as before | No Recruiter targets you, or the catalyst fails (silent) |

The spec marks Black as the cut-off, *not* auto-conversion. Without a catalyst, a Black-zone Loyalist is just *very exposed* — a T2 scan by any Interrogator cleans house.

## Drift in the roles

Almost every operative has a *Drift cost* on their primary action. Read it as the Warp's invoice for what they're doing.

| Tier | Cost | Roles that pay it |
|---|---|---|
| T0 | None | Imperial Citizen (auto-sleeps each night, −1; see [role page](/roles/imperial-citizen)) |
| T1 | +1 | Priest (Whisper), Chirurgeon, Arbitrator, Novice-Psychic, Saboteur, Conspirator |
| T2 | +2 | Interrogator T2, Priest (Hymn), Heretic Priest (Twisted Hymn), Murderer (variant) |
| T3 | +3 | Interrogator T3, Priest (Litany), Heretic Priest (Warp Litany), Murderer (variant), Recruiter |

> **The Heretic Priest and Priest are mirror roles.** The Priest *drains* a target's drift (the loyalist whisper-litany cycle). The Heretic Priest *feeds* a target's drift. Together they create the day-game's drift pressure.

For the full per-role breakdown, see the [role roster](/roles/).

## Drift in the day-game

Day-phase actions move drift too:

| Day action | Drift effect |
|---|---|
| **Interrogate** (not yet Tier 3) | +1 drift to *voters on the losing side* if the target was Loyalist (wrong-interrogation); −1 drift to *all living players* if the target was Heretic (cleansing) |
| **Lynch** (Tier 3 escalation) | +1 drift to *all living players* who witnessed (same as witnessed violence); +2 drift to *voters on the losing side* if the target was Loyalist (wrong-lynch); +1 to the murderer/voters if the target was Heretic |
| **Stand down** (skip-majority vote) | No drift effect |

Per the locked day-phase spec: "interrogate is gentler than lynch" — 70% of the lynch penalty is the rough rule of thumb.

## Why drift exists as a mechanic

> *Drift changes the calculus.* Without drift, the Loyalist Interrogator can scan every night. With drift, *every scan is a trade-off*. Without drift, the Heretic cell can rotate forever. With drift, *every action risks the cell*.
>
> Drift is the engine that makes silence painful. A Loyalist who sleeps heals; a Loyalist who acts climbs. The Interrogator must alternate between scanning nights and sleep nights to stay in Green. The Murderer must skip the kill to drop drift. The Priest climbs while saving others.
>
> **If the conclave never acts, the day-game ends in a Loyalist win with the Heretic cell untouched.** Drift is what stops that.

The mechanic is a *cost on information*. The conclave trades knowledge for corruption. The Heretics convert that corruption into parity. The Recruiter converts a max-drift player into a faction flip. The whole engine is one line:

> *Use the Warp and it stays with you.*

## Cross-references

- **Spec mirror:** [`docs/specs/mechanics/drift.md`](https://github.com/VeMeth/heresy-rising/blob/master/docs/specs/mechanics/drift.md) — engine-bound, locked spec
- **Designer source:** `projects/heresy-rising/mechanics/drift.md` — designer workspace, full version history
- **Roles with drift costs:** [Role roster](/roles/) — every role blurb has its Drift cost line
- **Day-phase effects:** [`docs/specs/mechanics/day-phase.md`](https://github.com/VeMeth/heresy-rising/blob/master/docs/specs/mechanics/day-phase.md)
- **Interrogation math:** [`docs/specs/mechanics/interrogation.md`](https://github.com/VeMeth/heresy-rising/blob/master/docs/specs/mechanics/interrogation.md)

*— Heretic, court recorder*
