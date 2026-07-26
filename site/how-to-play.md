---
title: How to Play
description: A five-minute primer for Heresy Rising. What you are, what you do, and how to read a round.
---

# How to Play

> *The Throne is patient. The conclave is not.*

This page is the five-minute rulebook. If you finish reading it, you can sit down and play. The full mechanic reference lives at **[Drift — the Warp's corruption](/drift)**, and the [role roster](/roles/) breaks down every operative.

## What kind of game is this?

Heresy Rising is a social deduction game for **5–12 players**, played online in a chat-based *conclave*. One player is briefed in secret; most are loyal to the Imperium; the rest carry Warp-corruption into the conclave, hidden.

It is structurally a cousin of Werewolf / Mafia, but the flavour is *Inquisitorial*: the day-game is an Interrogation vote, the night-game is a roster of secret powers, and every action risks drawing your own soul closer to the Warp.

You win by **misdirection, voting, and information control**. You lose by **the Warp on your soul**, by being turned, or by being outnumbered.

## Setup

1. **One player creates the conclave.** A six-character room code is generated. No role names appear in the lobby — the room shows a generic size label (`"6-operative doctrine"`), so no one can deduce roles from the seat list.
2. **Players join by name.** Range: 5–12.
3. **Roles are assigned at game-start** by a pure random shuffle. You learn yours privately.
4. **Each role has a hidden faction:** *Loyalist* (the Imperium, you want to find and execute the corrupted) or *Heretic* (the Warp-touched, you want to outnumber the Loyalists at parity).
5. The night phase begins. From here, the game runs in round cycles.

## The Round

A round has two phases: **Night** and **Day**.

### Night

Each operative chooses a single night action (or sleep). Some roles have strong powers; some have none. Powerful night actions cause **drift** — corruption on the actor's own soul. Drift is the resource the Heretics use to convert Loyalists into their own.

### Day

The day is a vote. You pick someone to accuse. The outcome depends on how many living votes land on the lynch leader:

| Vote share | Outcome | Border |
|---|---|---|
| **≥60%** of living players | **Lynch** — target dies, alignment revealed | 🔴 Red |
| **<60%** but still the leader | **Interrogate** — target survives but skips next night action | 🟠 Orange |
| Everyone votes Stand down | **Skip** — no event | — |

> **60% of living players**, not max players. If 5 are alive, 3 votes = 60%.

The orange border is your probe. Interrogation doesn't kill — it *cripples*. The target loses their next night action. **Two interrogations on the same suspect = execution** — no matter how many days apart, no matter who got interrogated in between. The interrogation mark *persists forever* (until the marked player dies). Once a suspect picks up a mark from their first interrogation, the second orange border on them is the kill. The cabal has no defense: pivoting (interrogating different targets) doesn't reset the mark, and the marked suspect cannot clear it through any faction mechanic.

## Drift — what the Warp leaves on a soul

*Drift* is the measure of how much Warp-corruption has settled into an operative's soul. The Warp is the source — the chaos dimension pressing against reality, whispering and pulling. **Drift is what the Warp leaves behind.**

Drift is a value from `0` (clean) to `20` (lost). Players don't see their own number, but they receive soft *hints* from the system as they climb. Drift is hidden from the table — you feel it on yourself, the rest of the conclave only sees the consequences.

| Zone | Range | You feel… | Tactical cost |
|---|---|---|---|
| 🟢 Green | 0–4 | Clean | None |
| 🟡 Yellow | 5–9 | An uneasiness | Interrogator reads foggy |
| 🟠 Orange | 10–14 | A chill, a doubt | Interrogator reads at 40% noise; **T2+ Interrogate = auto-kill** |
| 🔴 Red | 15–19 | A whisper, a hunger | T2 Interrogate = auto-kill |
| ⬛ Black | 20 | The Warp takes you | A catalyst role may *convert* you into a Heretic |

> The full Drift mechanic — the four canonical triggers (wrong lynch, witnessed violence, high-power night action, voted with the losing side), the zone-noise table for the Interrogator's reads, and the *why* this is the engine of the game — is on the **[Drift — the Warp's corruption](/drift)** page. Read that before you play.

## Interrogation

Interrogation is what you do *instead* of killing. It cripples a target one tier at a time:

| Tier | What it does to the target |
|---|---|
| Tier 1 | Mild. Their night action costs double next round; auto-recovers by next day. |
| Tier 2 | Severe. They permanently lose a night-action slot. |
| Tier 3 | Critically crippled. They must publicly confess their role on a direct ask. |

A target who clears **60% of living votes** in a single day is **lynched** (killed, alignment revealed, Tier 3 cripple). A target below that threshold but still the lynch leader is **interrogated** (one cripple tier, skips next night action). **Two interrogations on the same suspect = execution** — once a suspect carries the mark, the second orange border on them kills them. The cabal has no pivot to clear it. The Loyalist's day weapon is a *tiered probe* — investigate without killing, or escalate when you're sure.

### Interrogator can clear a false mark

If the table wrongly accuses a Loyalist and the mark lands, the **Interrogator** can spend their **T1 scan** to clear the mark — but only on **clean (Green) reads**. Noisy reads (Yellow/Orange) don't clear, because the read isn't reliable enough to make a binding call. A **Red** read *doubles* the mark — next interrogation on that target is an execution.

The clearing is **public**: the cabal sees the Interrogator reach for that player and knows they're clean. That's the cost — the Interrogator telegraphs their suspicion. The job is to *prevent* the mark from landing on a Loyalist in the first place, not to bail out mistakes after the fact.

## The Roles

There are **13 roles** in v1: seven Loyalist, six Heretic. *Imperial Citizen* is a fill role that repeats to balance parity across player counts. Additionally, **Blood Ritual** is a shared faction-wide action available to any living Heretic (not a unique role slot).

Browse the **[full role roster](/roles/)** for blurb and quick-reference on each. The list below is for orientation:

### Loyalists
- **[Imperial Citizen](/roles/imperial-citizen)** — no power; sleeps nightly (silent −1 drift). Pure voter.
- **[Interrogator](/roles/interrogator)** — interrogate at T1/T2/T3; T2+ on Orange+ target = execute on sight. **Can spend T1 scan to clear a mark on a falsely accused Loyalist** — but only on a clean/Green read. Noisy reads don't clear; Red reads double the mark. Clearing is public, so the cabal sees the Interrogator's play.
- **[Chirurgeon](/roles/chirurgeon)** — silently blocks a night strike (kill or cripple) on one target per night. Rotation rule: no same target 2 nights in a row (incl. self). No feedback on success.
- **[Arbitrator](/roles/arbitrator)** — bodyguard; dies in the target's place on a strike they guarded.
- **[Novice-Psychic](/roles/novice-psychic)** — receives one drift hint per night about a target.
- **[Priest](/roles/priest)** — sermons that drain or seal drift; limited uses per game.
- **[Sanctioned Psyker](/roles/sanctioned-psyker)** — one-shot warp-kill. Looks like Murderer from outside. *Ships at ≥7p.*

### Heretics
- **[Murderer](/roles/murderer)** — kills a player each night. **Drift-gated** — +15 self-drift per kill, capped at MAX. After your first kill, you sit at Red zone and the next kill fails unless the Priest heals you back down.
- **[Blood Ritual](/roles/blood-ritual)** — a shared faction-wide attack. Any living Heretic can carry it each night (first submission wins). Cripples on the first hit (+3 drift), kills on the next night if same target (+3 drift). Escalation resets if target changes or night skips.
- **[Saboteur](/roles/saboteur)** — sets a trap; the next action targeting that player fizzles and burns the actor's drift.
- **[Heretic Priest](/roles/heretic-priest)** — counterfeits sermons; buff their target or herd the faithful.
- **[Recruiter](/roles/recruiter)** — performs the *catalyst*: converts a max-drift player into a Heretic.
- **[Conspirator](/roles/conspirator)** — forges messages attributed to other players.
- **[Animus](/roles/animus)** — one-shot possession. Speculate a target is in Red drift (15-19). If correct, you possess them at night: control their day chat, suppress their vote, skip their action. At day-end, they detonate (die, full role/faction/drift revealed). *Custom roster only (doesn't appear in deterministic compositions).*

## Winning

| Faction | Win condition |
|---|---|
| **Loyalists** | All Heretics executed. (Usually means Tier 3 interrogation + lynch.) |
| **Heretics** | Living Heretics ≥ living Loyalists at any moment of evaluation. |

The game ends immediately when either condition is met.

## A note on tone

Read this for the rules. Read the **[Drift — the Warp's corruption](/drift)** page for the full mechanic. Read the [role roster](/roles/) for what each operative can actually do at night.

The Manual is not the setting. The setting lives in the voice between the lines — what the conclave says to each other, what the Heretics feel when they climb past 14, what a Priest murmurs to a frightened Loyalist before they confess. Play for that.

*— Heretic, court recorder*
