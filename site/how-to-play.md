---
title: How to Play
description: A five-minute primer for Heresy Rising. What you are, what you do, and how to read a round.
---

# How to Play

> *The Throne is patient. The conclave is not.*

This page is the five-minute rulebook. If you finish reading it, you can sit down and play. The rest of the manual — the [role roster](/roles/), drift zones, and tribunal math — lives deeper in the docs.

## What kind of game is this?

Heresy Rising is a social deduction game for **5–12 players**, played online in a chat-based *conclave*. One player is briefed in secret; most are loyal to the Imperium; the rest carry Warp-corruption into the conclave, hidden.

It is structurally a cousin of Werewolf / Mafia, but the flavour is *Inquisitorial*: the day-game is an Interrogation vote, the night-game is a roster of secret powers, and every action risks drawing your own soul closer to the Warp.

You win by **misdirection, voting, and information control**. You lose by drift, by being turned, or by being outnumbered.

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

The day is a vote. You pick someone to accuse. The first consecutive day on a target is an **interrogate** (cripple one tier; no death). The second consecutive day on the same target is a **lynch** (kill, alignment revealed).

> You can also vote **"Stand down"** to skip the day. Useful when no good target is named.

## Drift — what the Warp leaves on a soul

*Drift* is the measure of how much Warp-corruption has settled into an operative's soul. The Warp is the source — the chaos dimension pressing against reality, whispering and pulling. **Drift is what the Warp leaves behind.**

When you commit violence, when you witness it, when you exercise forbidden gifts, when you consort with the wrong — the Warp's weight on you *climbs*. Drift never resets. Every action is a trade-off between what you need *now* and what you'll have to carry *next round*.

Drift is a value from `0` (clean) to `20` (lost). Players don't see their own number, but they receive soft *hints* from the system as they climb. Drift is hidden from the table — you feel it on yourself, the rest of the conclave only sees the consequences.

| Zone | Range | You feel… | Tactical cost |
|---|---|---|---|
| 🟢 Green | 0–4 | Clean | None |
| 🟡 Yellow | 5–9 | An uneasiness | Interrogator reads foggy |
| 🟠 Orange | 10–14 | A chill, a doubt | Interrogator reads at 40% noise; **T2+ Interrogate = auto-kill** |
| 🔴 Red | 15–19 | A whisper, a hunger | T2 Interrogate = auto-kill |
| ⬛ Black | 20 | The Warp takes you | A catalyst role may *convert* you into a Heretic |

The Interrogator's scans are gated by your drift zone — a clean target's drift is easy to read; an Orange+ target is *itching* with corruption and a deliberate scan exposes them.

## Interrogation

Interrogation is what you do *instead* of killing. It cripples a target one tier at a time:

| Tier | What it does to the target |
|---|---|
| Tier 1 | Mild. Their night action costs double next round; auto-recovers by next day. |
| Tier 2 | Severe. They permanently lose a night-action slot. |
| Tier 3 | Critically crippled. They must publicly confess their role on a direct ask. |

A target *accused* of wrongdoing for two consecutive days is **lynched** (Tier 3 + killed + alignment revealed). Interrogation is the Loyalist's primary weapon — death is rare.

## The Roles

There are **11 roles** in v1: six Loyalist, five Heretic, plus *Imperial Citizen* (a fill role that exists to balance parity).

Browse the **[full role roster](/roles/)** for blurb and quick-reference on each. The list below is for orientation:

### Loyalists
- **[Imperial Citizen](/roles/imperial-citizen)** — no power, just votes.
- **[Interrogator](/roles/interrogator)** — interrogate at T1/T2/T3; T2+ on Orange+ target = execute on sight.
- **[Chirurgeon](/roles/chirurgeon)** — protect one player per night from night strikes.
- **[Arbitrator](/roles/arbitrator)** — bodyguard; dies in the target's place on a strike they guarded.
- **[Novice-Psychic](/roles/novice-psychic)** — receives one drift hint per night about a target.
- **[Priest](/roles/priest)** — sermons that drain or seal drift; limited uses per game.

### Heretics
- **[Murderer](/roles/murderer)** — kills a player each night.
- **[Saboteur](/roles/saboteur)** — sets a trap; the next action targeting that player fizzles and burns the actor's drift.
- **[Heretic Priest](/roles/heretic-priest)** — counterfeits sermons; buff their target or herd the faithful.
- **[Recruiter](/roles/recruiter)** — performs the *catalyst*: converts a max-drift player into a Heretic.
- **[Conspirator](/roles/conspirator)** — forges messages attributed to other players.

## Winning

| Faction | Win condition |
|---|---|
| **Loyalists** | All Heretics executed. (Usually means Tier 3 interrogation + lynch.) |
| **Heretics** | Living Heretics ≥ living Loyalists at any moment of evaluation. |

The game ends immediately when either condition is met.

## A note on tone

Read this for the rules. Read the [role roster](/roles/) for what each operative can actually do at night. The deeper mechanic write-ups live in the designer-side spec and are not yet mirrored into this Manual.

The Manual is not the setting. The setting lives in the voice between the lines — what the conclave says to each other, what the Heretics feel when they climb past 14, what a Priest murmurs to a frightened Loyalist before they confess. Play for that.

*— Heretic, court recorder*
