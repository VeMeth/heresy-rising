<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/heretic-kit.md`
**Locked version:** v1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [mechanics/heretic-kit.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Mechanic: The Heretic Kit (5 Roles, v1)

**Version:** 1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06 — drift numerical pass + role roster finalized
**Source:** Heretic + Nicolas, 2026-07-06 numerical pass + voice messages 001/002
**Companion data:** `drift.md` / `drift.json` (drift math), `interrogation.md` (day-phase mechanics), `loyalist-kit.md` (opposing faction)

---

## Changelog

### 1.0.0 (2026-07-06)
- 5-role Heretic kit finalized: Murderer, Saboteur, Heretic-Priest, Recruiter, Conspirator
- Drift costs assigned per tier (T0–T3)
- Subfactions (Puritan / Radical) explicitly deferred to Phase 2

---

> *5-role Heretic faction spec. Each role has a night power and a drift cost.*

---

## 🩸 Design philosophy

The Heretic kit must obey **one structural law** (locked 2026-07-06, voice msg 001):

> **Every Heretic needs a believable claim.** Social deduction lives on claims. Every Heretic must occupy a slot the Loyalists believe is safe — same surface, different math.

This is *not* "anti-Priest" thinking. It's **claim-disguise thinking**. The Heretic doesn't invert the role — they perform it badly, or perform it for different reasons, while the math runs inverted.

---

## ⚔️ The 5 Heretic Roles (full draft)

### H1 — Murderer

| Field | Value |
|---|---|
| **Claim** | Imperial Citizen (default) |
| **Lore** | The Heretic who kills. Plain, brutal, traditional Werewolf slot. |
| **Night action** | Kill one player. Standard. |
| **Drift tier** | T2 (+2) per kill |
| **Night chat** | Full Heretic chat access. Sees other Heretics' plans. |
| **Detectability** | Hard to pin (just like vanilla Werewolf). Drift uncovers via behavior, not role reveal. |
| **Required?** | ✅ Yes — every Heretic cell needs a killer. |

---

### H2 — Heretic Priest (claims-matching)

| Field | Value |
|---|---|
| **Claim** | **Loyalist Priest** (same slot) |
| **Lore** | A priest whose faith has rotted from the inside. Walks the chapel, performs the litanies. The warp-speak comes out only in *effect*. |
| **Night action** | One of three sermon tiers — same UI as Loyalist Priest. Effects differ. |
| **Drift tier** | Sermon cost (same as Priest — +0/+1, +2, +4) |

**Three sermon tiers (locked in `drift.json` § `priestHeretic`):**

| Tier | Self-cost | Target effect | Stealth effect |
|---|---|---|---|
| False Comfort | **1** *(locked 2026-07-06 — upper bound of 0–1 range)* | **+3 on target** | Looks like Whisper to target — they feel relieved. Actually poison. |
| Twisted Hymn | +2 | **+7 on target** | Target feels "strengthened in faith" (wrong-feeling for a saved soul). Moves them UP a zone. |
| Warp Litany | +4 | **+12 on target** | Drives target into / near Red instantly. |

**Frequency defaults (locked 2026-07-06):**

| Tier | Frequency | Notes |
|---|---|---|
| False Comfort | Daily (unlimited) | Same as Loyalist Whisper |
| Twisted Hymn | **2–3× per game** *(range kept from spec)* | Mirrors Loyalist Hymn |
| Warp Litany | Once per game | Mirrors Loyalist Litany |

**Detection logic:**
- Track drift deltas after Priest interventions.
- Loyalists whose "Priest intervention" actually raised their drift = Heretic Priest signal.
- Detection requires **meta-tracking of drift** — and since drift is hidden, only the **acting Priest** themselves sees the deltas. To catch a Heretic Priest, you'd need to find a *real* Priest and compare notes.
- Effectively: **only one Priest per game can be detected.** If there's only one Priest slot, and it's claimed by the Heretic Priest, the Loyalists get *no Priest at all* without knowing.

**Why this is different from "Anti-Priest":**
- Anti-Priest = role-flipped Priest (literally inverted, mechanically equivalent)
- Heretic Priest = claim-disguised Priest (same surface, different math, undetectable by behavior alone)

---

### H3 — Conspirator

| Field | Value |
|---|---|
| **Claim** | Imperial Citizen (default) |
| **Lore** | The whisperer. Posts messages that *look like* they came from another player. Doublespeak, forgery, planted words. |
| **Day action** | Once per day, post a message in day chat that the system attributes to a *different player* of Conspirator's choice. |
| **Drift tier** | T1 (+1) per forgery |
| **Limit** | Once per day, not once per game. Doublespeak is their stock in trade. |

**Why this works in chat-based games:**
- Telegram/Discord attribution is real. "Message from `@alice`" vs "Message from `@bob`" matters.
- A Conspirator who frames the Loyalist Interrogator with a confession = massive chaos.
- The "real" player sees the forged message — do they correct it publicly? That admits they're the source. Do they let it stand? That lies.

**Counterplay:** Loyalists can verify-message identity by system-level claims ("check the actual sender — not what the chat shows"). But that requires *suspicion* of forgery, which itself is a signal.

---

### H4 — Saboteur (booby-trap specialist)

| Field | Value |
|---|---|
| **Claim** | Imperial Citizen (default) |
| **Lore** | Mines the path before the prey. Plants traps that fire when loyalty pokes the wrong door. |
| **Night action** | Choose one player to booby-trap. Trap expires at sunrise. |
| **Drift tier** | T2 (+2) per trap |
| **Limit** | One trap per night |

**Trigger:** Any night action *performed on the trapped player*.

**Effect on trigger:**
- Actor takes **+5 drift** (in addition to their action's normal cost).
- Action returns **false / no result**.
- Saboteur gets private notification: *"your trap sprung — `<actor>` tried to `<action>` on `<target>`."*

**Specific effects per action:**
- **Interrogate / Investigate** → result is always "their story holds together" (regardless of truth)
- **Sermon (Priest)** → target's drift doesn't change (silent fail) — and Priest gets +5 drift
- **Kill (Murderer)** → kill resolves normally, Murderer gets +5 drift on top of T2 (+2) = +7 total
- **Recruit (Recruiter)** → flip resolves, Recruiter gets +5 drift on top of T3 (+3) = +8 total

**Detection:** Silent. The trapped player doesn't know. The actor learns (their action returned garbage) but doesn't know *why*.

**Why this is interesting:**
- Saboteur is **a counter to Recruiter**. Trap the recruit-target, and the Heretics' own flip is poisoned.
- Saboteur is **predictive** — they have to guess who's targeted tonight. Reading the table is part of the role.
- Saboteur is **a spy** — they get real intel on who's poking whom, without breaking any role-disguise.

---

### H5 — Recruiter (heretical-catalyst carrier)

| Field | Value |
|---|---|
| **Claim** | Imperial Citizen (default) |
| **Lore** | The whisperer of the conversion ritual. Touches max-drift players and burns their souls over. |
| **Night action** | Target one player at **Black zone (drift 20)** to perform the heretical catalyst. |
| **Drift tier** | T3 (+3) per flip attempt |
| **Limit** | One flip attempt per night |
| **Success condition** | Target must be at Black zone (drift 20). Otherwise action fails silently. |
| **Failure condition** | If Saboteur trapped the target tonight: flip resolves but Recruiter takes +5 drift extra (= +8 total). Self-corrupting fail. |

**Why Recruiter carries the catalyst (vs Murderer):**
- Murderer + catalyst = one Heretic does both kill *and* flip. Too strong. Drift alone can't balance it.
- Recruiter + catalyst = dedicated flip role. Murderer still kills independently. **Separation of concerns.**
- Forces Heretics to manage two roles (Murderer + Recruiter) and two drift profiles. More table-talk, more coordination pressure.

**Mass-conversion prevention:**
- Only works on Black zone (drift 20). Most players don't reach Black without active effort by *someone* — and the louder the effort, the more visible the recruit-target is.
- Recruiter's night is consumed by the flip attempt. If they fail (target not at Black), they did nothing that night.
- **Net effect: Heretics can only burn the already-burned.** (Pillar 4 reaffirmed.)

---

## 🎯 Day-phase interaction matrix

| Heretic role | Day phase power | Drift cost |
|---|---|---|
| Murderer | None (night-only) | — |
| Heretic Priest | None (night-only sermons) | — |
| Conspirator | Once/day forgery | T1 (+1) |
| Saboteur | None (night-only trap) | — |
| Recruiter | None (night-only flip) | — |

**Lopsided — by design.** 3 of 5 Heretics act at night. 1 (Conspirator) acts during the day. 1 (Murderer) acts only at night. **Heretics have sparse day-phase presence** — the Conspirator is the only one who can sabotage table-talk during the day. This keeps the day phase Loyalist-dominant by default, with Conspirator as the Heretic's only day-side disruption.

---

## ⚙️ Numerical balance check (drift pass)

### Per-night drift costs across Heretic roles

| Action | Drift cost | Per night budget? |
|---|---|---|
| Murderer kill | +2 | Yes (one per night max) |
| Heretic Priest sermon | +0/+1, +2, or +4 | Yes (one per night max) |
| Conspirator forgery | +1 | Yes (one per day max — daytime) |
| Saboteur trap | +2 | Yes (one per night max) |
| Recruiter flip | +3 | Yes (one per night max, only on Black) |

**Maximum possible Heretic drift per night cycle** (all 5 Heretics act):
- Murderer +2 + Priest +4 (Warp Litany) + Saboteur +2 + Recruiter +3 = +11 drift
- Conspirator at +1 daytime
- **Total: +12 drift across all Heretics in one night.**

That's 60% of MAX. If a Heretic plays this hard every night, they hit the Heretic cap (13) by Day 2 and stay uncatalyzable. **Too risky to spam.** This forces Heretics to **choose** which actions to take — every action is a tradeoff.

---

## 🩸 Heretic's take

This kit has **two original-to-40k ideas**:

1. **Saboteur's booby-trap** — totally novel to social deduction. Most games have *detectives* and *killers* but rarely a *trap-setter*. The trap creates a meta-game layer that's invisible to the trapped and the actor alike.

2. **Heretic Priest's claim-disguise** — using the same slot as the real Priest, with detection requiring drift-delta tracking. This makes the Priest slot a **contested claim** from Day 1: who is *really* the Priest?

The kit also has **three Werewolf-classic roles** (Murderer, Conspirator-by-forgery, Recruiter-as-Mafia-roleblocker) so the genre-comparison tests stay grounded.

If Nicolas locks this, the Heretic kit is **complete**. v1 is now: 5 Loyalist + 5 Heretic + drift + interrogation + day-mode switch. **The whole game.**

---

## 📅 Log of revisions

- **2026-07-06** — Initial 5-role spec from voice messages 001 (Heretic Priest claim-disguise framing, Saboteur ideation) and 002 (Saboteur booby-trap mechanic). Murderer / Conspirator / Recruiter proposed as Murderer / Conspirator-by-forgery / Recruiter-as-catalyst-carrier.
- **2026-07-06 evening** — False Comfort self-cost locked to 1. Frequency defaults set (False Comfort daily, Twisted Hymn 2–3×/game, Warp Litany once). Companion `data/roles-40k.json` and `data/composition.json` written.

---

## ❓ Open sub-questions

1. **Heretic role count for v1** — confirm 5 is the right number. Smaller cells (6-player) may want only 1–2 Heretics.
2. **Conspirator forgery mechanic** — confirm "system attributes message to different player" is the right tool. Alternative: a player-voted message gets posted *silently* (no chat attribution) and looks like a deleted message.
3. **Saboteur trap frequency** — one per night vs one per game. One-per-night is forgiving; one-per-game is high-stakes.
4. **Recruiter failure detection** — does Recruiter learn "target not at Black"? Currently NO (silent fail). Should be YES (so they don't waste nights).
5. **Saboteur drift cost** — T2 (+2) is currently proposed. Could be T1 (cheap spam) or T3 (rare heavy trap). Playtest will tell.