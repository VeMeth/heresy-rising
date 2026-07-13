<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/drift.md`
**Locked version:** v1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [mechanics/drift.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Mechanic: Drift (Corruption Engine)

**Version:** 1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06 — numerical pass, post-Haru feedback session
**Source:** Heretic + Nicolas, 2026-07-06 numerical pass
**Companion data:** `drift.json` (machine-readable, v1.0 baseline), `day-phase.md` (drift triggers table)

---

## Changelog

### 1.0.0 (2026-07-06)
- Drift MAX = 20 (raised from 10 for headroom)
- Threshold zones locked: Green 0–4 (exact), Yellow 5–9 (20% noise), Orange 10–14 (40% noise), Red 15–19 (80% noise), Black 20 (100% noise)
- Visibility = faint hints only, sent to drifting player (Q3 lock). No numeric display, ever.

---

> *Drift is hidden corruption. Players can lie about it. Triggers fire on actions.*

---

## 🩸 What drift *is*

Drift is the **mental corrosion** that accumulates when a player makes mistakes, performs violent or invasive actions, or simply exists in a grimdark universe where the Warp presses in on every soul.

- **Drift goes UP** from actions (lynch mistakes, night actions, witnessing violence, voting with the wrong crowd).
- **Drift can come DOWN** but only via explicit recovery mechanics (sleep, Priest intervention).
- **Drift is hidden.** Players see only *hints* (system messages like "you feel a chill"). The number is never shown.
- **Drift alone cannot convert you.** Conversion requires Drift == MAX *plus* an explicit heretical catalyst action.

---

## 🎯 Baseline numbers (v1)

| Constant | Value | Why |
|---|---|---|
| **MAX** | **20** | Headroom for 5+ days without instant-converting every misplay |
| **Base value** | **0** | Everyone starts pure |
| **Nightly sleep recovery** | **−1** | Free every night, costs your action |
| **Conversion threshold** | **20 (max)** | Heretical catalyst gate |
| **Drift floor** | **0** | Sleep can't cleanse you all the way |
| **Heretic cap** | **13** | Prevents "clean Heretic wins from the shadows" anti-climax |

### Heretic cap (the rule nobody saw coming)

If a Heretic's drift stays under 13 through end of Day 3, they take a **+3 drift penalty** at end-of-day. Mechanically: *"the warp notices the untouched."*

This forces Heretics to *act* — no stealthy clean-handed victory. They either play subtle (then catch the cap), or aggressive (then hit the cap and become uncatalyzable). Both paths have teeth.

---

## ⚙️ Action-tier drift costs

| Tier | Cost | Examples |
|---|---|---|
| **T0 — Pass / sleep** | **−1** | Skip your night action |
| **T1 — Soft intel** | **+1** | Light Interrogator (claim verify), Passive Informant (overhear) |
| **T2 — Active intel** | **+2** | Standard Interrogator, Witness scan, "is X role Y?" check |
| **T3 — Power play** | **+3** | Brutal Interrogator torture, Sadistic Murder, Heretic sacrament |

### Day-side triggers

| Trigger | Cost | Notes |
|---|---|---|
| Wrong lynch | **+2** | Lynch target was confirmed Loyalist (post-reveal) |
| Voted with losing side | **+1** | Your candidate got lynched and was innocent. **Halts after Day 5** — long-game flatten |

---

## 📍 Threshold zones — green → yellow → red

| Zone | Drift | Intel | Drift hints | Table notices |
|---|---|---|---|---|
| 🟢 **Green** (Clean) | 0–4 | Exact | None | None |
| 🟡 **Yellow** (Tainted) | 5–9 | 20% noise | Faint | None |
| 🟠 **Orange** (Wavering) | 10–14 | 40% noise | Loud | Behavior shows. Heretic cap kicks in |
| 🔴 **Red** (Heretical) | 15–19 | 80% noise | Constant | Obvious |
| ⬛ **Black** (Max) | 20 | Unreliable | You know | Convert-vulnerable |

### Intel noise math

When an intel role performs a T2 action in their current zone, the result is replaced with a **noise outcome** with probability = zone noise rate.

Noise outcomes:
- **unclear** — no signal either way
- **opposite** — returns the inverse of truth

T1 actions at yellow/orange halve the noise rate (gentle actions). T3 actions at green don't get any noise reduction (intrinsically noisy).

---

## 🙏 Priests

### Loyalist Priest — three sermon tiers

| Tier | Self-cost | Target effect | Frequency |
|---|---|---|---|
| **Whisper (mild)** | +1 | −2 | Daily (unlimited) |
| **Hymn (strong)** | +3 | −5 | **2× per game** *(locked 2026-07-06; lower bound of original 2–3)* |
| **Litany (brutal)** | +6 | −10 (floor 0) | Once per game |

**Net cost of a Litany rescue:** Priest enters Orange. Target exits Red entirely. **Total ±8 drift between two players.** That's the cost of dramatic redemption.

**Skip alternative:** Sleep (T0, −1). Some nights skip and recover self.

**Priest drift curve by playstyle:**
- *Whisper spam (clean support):* stays in Green (1–3 endgame)
- *Brutal save (redemption arcs):* ends around 8–12
- *Sleep shield (passive backline):* stays clean (0–2)
- *Militant sermons:* hits Orange by Day 4

### Heretic Priest (stealth role, claims Loyalist Priest)

| Tier | Self-cost | Target effect | Stealth effect |
|---|---|---|---|
| **False Comfort** | **1** *(locked 2026-07-06; upper bound of original 0–1)* | **+3 on target** | Looks like Whisper to the target |
| **Twisted Hymn** | +2 | **+7 on target** | Target feels "strengthened in faith" (wrong-feeling) |
| **Warp Litany** | +4 | **+12 on target** | Drives target into / near Red |

**Frequency:** False Comfort = daily. Twisted Hymn = 2–3× per game. Warp Litany = once per game. *Mirrors Loyalist Priest frequency defaults.*

**Flavor split:** Loyalist Priest = drains target, costs self. Heretic Priest = free buff to target, paying only if their target gets too pure to convert. **Corruption diffuses outward.**

**Detection:** Track drift deltas after Priest interventions. Loyalists who "feel better" but whose drift goes *up* are the giveaway.

---

## 📈 Sanity-check scenarios (5-day game)

### Scenario A — Loyalist Interrogator, mediocre play

| Day | Events | Drift after |
|---|---|---|
| — | — | 0 |
| Day 1 | Lynch innocent (+2) | 2 |
| Night 1 | T2 (+2), no sleep | 3 |
| Day 2 | Voted with losing side (+1) | 4 |
| Night 2 | T2 (+2), no sleep | 6 (Yellow) |
| Day 3 | Lynch innocent (+2) | 8 |
| Night 3 | T1 (+1), sleep (−1) | 8 |
| Day 4 | Lynch innocent (+2) | 10 (Orange) |
| Night 4 | T2 (+2), no sleep | 12 |
| Day 5 | Lynch innocent (+2) | 14 (Red-adjacent) |

**Verdict:** Active Loyalist ends Day 5 in Red zone but *not yet converted*. ✓

### Scenario B — Quiet Loyalist, good play

| Day | Events | Drift after |
|---|---|---|
| — | — | 0 |
| All nights | Sleep | 0 |
| Day X | One wrong lynch (+2) | 2 |
| Recovery | Sleep over 2 nights | 1 |

**Verdict:** Clean, intel reliable. ✓

### Scenario C — Brutal Interrogator, worst case

| Day | Events | Drift after |
|---|---|---|
| — | — | 0 |
| Night 1 | T3 torture (+3), no sleep | 3 |
| Day 1 | Wrong lynch (+2) | 5 (Yellow) |
| Night 2 | T3 (+3) | 8 |
| Day 2 | Wrong lynch (+2) | 10 (Orange) |
| Night 3 | T3 (+3) | 13 |
| Day 3 | Wrong lynch (+2) | 15 (Red) |
| Night 4 | T3 (+3) | 18 |
| Day 4 | Wrong lynch (+2) | **20 (MAX, convert-vulnerable)** |

**Verdict:** Hits MAX Day 4. **The Panic Arc.** A clean-to-corrupt 4-day story. ✓

---

## ⚡ Long-game check (7+ days)

Past Day 5, the "voted with losing side" trigger halts accumulating drift. Drift curve flattens naturally for steady players. Aggressive players continue climbing toward MAX at full rate.

**Open:** Does wrong-lynch also halt past Day 5? Currently NO. **Power-gated abuse possible — needs playtest decision.**

---

## ❓ Open design questions

1. Does performing a high-power night action void sleep recovery same night, or stack?
2. Can drift overflow above MAX? (Currently NO — hard cap.)
3. What is the explicit heretical catalyst *action*? (Locked as concept, action definition open.)
4. Does a successful action refund drift as a "relief" sink? (Haru floated. Currently NO.)
5. Anti-Priest mechanic scope: ship with Anti-Priest OR convert via heretical catalyst — **not both.**
6. Cults: small heretic syndicate, shared resources — ship in v2?

---

## 🩸 Heretic's take

This is the **numbers game** the design has been begging for. With MAX=20, daily costs, and threshold zones, drift stops being flavor and becomes a *gameable resource*.

The math also surfaces something cool: **intel reliability is a *negotiable* resource.** A Loyalist interrogator who tried to be a hero hits Yellow Day 2, and their intel becomes questionable. A Loyalist who slept, whispered, and stayed patient gets through Day 5 still trusted. **Patience is rewarded.**

The Heretic Priest is the standout. By making them "the *reverse* direction" of the same template, they get to use the same UI, same hints, same description — but the math is inverted. Players have to track drift deltas across Priest interventions to *find* the Heretic Priest. That's the new puzzle layer.

If Nicolas locks these numbers, v1 is one step closer to playable.

---

## 📅 Log of revisions

- **2026-07-06** — Initial numerical pass from drift.json. Pending Nicolas review. Supersedes default MAX=10 from MEMORY.md (now 20).
