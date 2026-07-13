<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/interrogation.md`
**Locked version:** v1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [mechanics/interrogation.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Mechanic: Interrogation (Stat-Damage System)

**Version:** 1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06 evening — tier defaults canonical (T1 recovers after 1 round no re-interrogation; T2/T3 permanent)
**Source:** Heretic + Nicolas, 2026-07-01 design session ("The Interrogation Pivot") + 2026-07-06 evening defaults
**Companion data:** `day-phase.md` (target-first vote mechanics, drift triggers), `loyalist-kit.md` (Interrogator role), `heretic-kit.md` (Heretic counter-strategies)

---

## Changelog

### 1.0.0 (2026-07-06)
- Interrogation replaces lynching as primary faction action (locked 2026-07-01)
- Tier progression: auto-escalate 1→2→3 same target, reset on different target
- T1 recovers after 1 round no re-interrogation; T2/T3 permanent
- T3 confession trigger: forced on direct ask only (not automatic broadcast)

---

> *Stat damage, not death. Cripple-not-kill preserves the player count.*

## 🩸 Why this exists

Werewolf-style social deduction has a death-spiral problem: every kill reduces the *information density* of the table. With a 6-8 player minimum, by turn 3 the loyalist side can't deduce anything because the table has thinned.

**Core insight:** death was doing two jobs — player removal AND providing stakes/momentum. Interrogation-as-stat-damage does both differently:
- **Player count stays stable** ✅ (no resource crisis)
- **Stakes scale by capability loss** ✅ (the most powerful roles have the most to lose)

---

## ⚙️ The mechanic (proposed)

Each night, the Inquisition nominates a target to be **brought in for questioning**. The target survives but takes cumulative stat damage.

### Three-tier damage system

#### 💀 Tier 1 — Light Scarring
- Lose access to **one** night action this round
- Target pays **+1 drift**; every living player except target pays **+1 drift** (witness scope)
- Recoverable in 1 round of no re-interrogation *(default 2026-07-06)*
- **Use case:** A warning. Traitor's cover intact, output drops.

#### 🔥 Tier 2 — Broken
- Lose access to **all** night actions going forward
- Target pays **+2 drift**; no witness drift
- Day-vote weight **reduced by 1**
- Must publicly justify every vote ("why do you support X?")
- **Use case:** Political actor, not power actor. Their *information value* is now higher than their action value.

#### ☠️ Tier 3 — Crippled
- Cannot perform any night actions or investigations
- Target pays **+3 drift**; no witness drift
- **Confess role on direct ask** *(default 2026-07-06 — not automatic broadcast)*
- Drift overflow → **auto-conversion to enemy faction** if drift threshold crossed
- **Use case:** Litmus test. Do the table keep them around, or politically bury them?

### Role-tied severity

| Role | Crippling severity | Why |
|---|---|---|
| Interrogator-Champion | **Catastrophic** | Their job *is* the night investigation — crippling them removes the table's main tool |
| Radical Inquisitor | **Severe** | High night-action power *and* drift-prone (power = risk per core design) |
| Puritan Acolyte | **Moderate** | Strong day-vote presence, modest night role |
| Standard Acolyte | **Light** | Mostly voting and speaking — crippling barely registers |

**The dilemma this creates:**
> Do you interrogate your own suspected traitors, knowing that crippling them also cripples your own faction's muscle? **Yes, you do.** Because that's the entire point. The Inquisition is *always* one bad decision away from destroying itself.

---

## 🎯 Mechanical consequences

### Win conditions, expanded

| Outcome | Trigger |
|---|---|
| **Traitor win** | N traitors survive OR warp-threshold conversions achieved |
| **Loyalist win** | All traitors crippled and interrogated into confession |
| **🔥 Pyrrhic / No clean win** | Table reaches threshold of crippled players (suggested: 4 in an 8-player game) → Inquisition has lost its function. The war ends. Nobody really won. |

### Crippled players as recruitment gambles

Broken/Crippled players can be *recruited* by either side, but it's a gamble:
- A Radical who takes a crippled loyalist as an "asset" is taking on **someone broken** — vector for further corruption, *or* a saboteur
- A loyalist who recruits a crippled traitor is buying a **broken informant** — useful, but at the cost of political cover (the table suspects you of consorting)

Recruiting a crippled player costs drift and political capital. **Crippled players are liabilities disguised as assets.**

### Confession as trade

Target of interrogation gets a choice:
- **Confess** (reveal role) → gain protection token, lose night action
- **Resist** → no info extracted, but Drift +1, witnesses gain suspicion
- **Refuse + Break** (Tier 2 damage taken) → lose all night actions, must publicly justify votes

**Protection token** *(default 2026-07-06)*:
- **Scope:** blocks re-interrogation for the rest of THIS Day phase only.
- **Does NOT block night actions.**
- **Refreshes** on new confession.
- **No stacking** — one token per player.
- **Faction-blind** — same rule for Loyalist and Heretic.

**Forced confession at T3** *(default 2026-07-06)*:
- T3 confession is **forced on direct ask only** (not automatic broadcast).
- The Loyalist win condition ("all Heretics confessed") requires the table to actually ask the T3 player.
- T1/T2 confession follows the choice mechanic above.

A loyalist who confesses is *credible* now (the table knows they're not a traitor) — which paradoxically makes them a juicy next-night interrogation target because their testimony is weaponizable.

A traitor who confesses is a *broken asset* to their faction. They stay alive but can be turned against their former side.

---

## ❓ Open design questions

1. **Initiator:** Who picks the interrogation target each night?
   - Collective vote (all loyalists hash it out)
   - Dedicated Interrogator-Champion role (single specialized player)
   - Random draw from accusation pool (table-as-jury)
   
2. **Willing interrogation:** If a player volunteers to be interrogated (to clear their name), does it cost less, more, or differently? Traitors could exploit this as a *false-clearing play*.

3. **Restoration:** Can Tier 1 damage be cured? (Lean YES, by tribunal verdict. Lean NO for Tier 2+.)

4. **Stacking rules:** What happens if the same player is interrogated twice?
   - Tier 2 escalation?
   - Permanent crippling?
   - Confession-forced?

5. **Witnesses and drift:** Does witnessing an interrogation drift *all* observers, or only those who *voted* for the interrogation?

---

## 🩸 Heretic's take

This is the mechanic that unlocks the rest of the design. Without it, Heresy Rising is just Werewolf with a corruption dial. With it, the game becomes:

> **A grimdark political horror where the question isn't "who is the traitor?" but "who can still function at the end?"**

The Cripple-not-Kill mechanic connects directly to the drift system, so the corruption isn't just a stat race — it's a *capability loss*. Players fall apart in stages, and the table has to reckon with each stage.

If Nicolas locks this in, the design pillars are now:
1. Werewolf-style structure
2. Hidden drift per player
3. Drift caused by actions
4. Corruption hidden, players can lie
5. Power = risk
6. **Interrogation replaces lynching** *(NEW)*
7. **Interrogation cripples rather than kills** *(NEW)*
8. Inquisition has internal factions (Puritans / Radicals + subfactions)

This is a *real* game now.

---

## 📅 Log of revisions

- **2026-07-01** — Initial proposal from Nicolas. Three-tier system + role-tied severity + Pyrrhic outcome proposed by Heretic.
- **2026-07-06 evening** — Defaults locked: tier progression (auto-escalate 1→2→3 same target, reset on different target), T1 recovery (1 round no re-interrogation), T3 confession trigger (forced on direct ask), confession protection token scope (block re-interrogation this Day phase only), T1 witness drift scope (every living player except target). See § Defaults Locked below.

---

## 🩸 Defaults Locked (2026-07-06 evening)

These defaults were set to unblock Phase 1 build. **They are NOT canonical until Nicolas locks them.** Bot must flag every callsite with `// TODO(heresy-spec):` and reference this section.

| Default | Value | Rationale |
|---|---|---|
| Tier progression | Same-target repeat auto-escalates 1→2→3. Different target resets to 1. | Matches "cumulative damage" framing in original proposal. |
| T1 recovery | 1 round of no re-interrogation | Lower bound; T2/T3 permanent. |
| T3 confession trigger | Forced **on direct ask**, not automatic | Original spec said "if asked directly" — preserved as the literal ask-action. |
| Confession protection token | Blocks re-interrogation this Day phase only | Otherwise table just re-interrogates every Confessor; tokens must decay. |
| T1 witness drift scope | Every living player except target pays +1 | Matches CONCEPT.md §3c "witnessed violence = all living players." |
| Witness drift on T2/T3 | None | Crippling effect is the cost; piling on drift makes T2/T3 unplayable. |
