<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/loyalist-kit.md`
**Locked version:** v1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [mechanics/loyalist-kit.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Mechanic: The Loyalist Kit (6 Roles, v1)

**Version:** 1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-06 — formalized from role-briefing.md penciled roster; L6 Priest added to satisfy HANDOFF.md §4 Priest-sermon requirement
**Source:** Heretic + Nicolas, 2026-07-06 numerical pass + 2026-07-06 evening session
**Companion data:** `drift.md` / `drift.json` (drift math, threshold zones, Priest tiers), `interrogation.md` (day-phase mechanics), `heretic-kit.md` (opposing faction)

---

## Changelog

### 1.0.0 (2026-07-06)
- 6-role Loyalist kit finalized: Citizen, Interrogator, Chirurgeon, Arbitrator, Novice-Psychic, Priest
- Priest sermon costs locked: Whisper (+1/−2 daily), Hymn (+3/−5 2×/game), Litany (+6/−10 once)
- Two-defender / two-investigator composition rationale codified (Werewolf sweet spot)

---

> *6-role Loyalist faction spec. Citizens are the noise floor; the rest are the cell's edge.*

---

## 🩸 Design philosophy

The Loyalist kit has the opposite design constraint from the Heretic kit:

> **Loyalists must be *detectable* through their actions.** They investigate, protect, defend. Their night actions create *information* the table can use. Drift pollutes their work as they climb the zones — that's the punishment for power.

Two structural laws (locked 2026-07-06):

| Law | Implication |
|---|---|
| **Power = risk** | Stronger roles drift faster. Interrogator (T2 nightly) > Citizen (T0 default). |
| **Detective synthesis is gated by zone** | An Interrogator in Orange zone (10–14) returns 40%-noisy intel. The Novice-Psychic's drift hints carry the same noise. Loyalists are *penalized* for accumulating drift — their own weapons dull. |

This is the *interesting* design move: **Loyalists can ignore Drift, but Ignored Drift ignores them back.**

---

## ⚔️ The 6 Loyalist Roles (full draft)

### L1 — Imperial Citizen

| Field | Value |
|---|---|
| **Claim** | Imperial Citizen (self — no false claim possible) |
| **Lore** | The default loyalist. Hive ganger, factory worker, scribe, clerk, voidship rating. The Imperial majority. Has no night power — survives on wit, votes, and reads. |
| **Night action** | **None.** Sleep = T0 (−1 drift). |
| **Drift tier** | T0 by default. Only goes up from system pressure (wrong lynch, voted with losing side, witnessing violence). |
| **Day role** | Pure voter. Counts toward majority thresholds. |
| **Detectability** | N/A. Citizen is the noise floor — they *look* like everyone else because that's what they are. |
| **Required?** | ✅ Yes — every cell must have Citizens as the majority. |

**Why Citizens exist:** Standard Werewolf structure. Without them, every non-Citizen is a "special" role and information density plummets by Day 2. Citizens make the table *crowded*, which makes the heretics harder to find by signal-to-noise.

---

### L2 — Interrogator

| Field | Value |
|---|---|
| **Claim** | Interrogator (self — official Inquisition agent) |
| **Lore** | Junior agent of the Inquisition. Political, not psyker. Catches heretics through memory, contradiction, and conversation — not warp-magic. |
| **Night action** | Investigate one player. Three investigation modes (player chooses at night). |
| **Drift tier** | T2 (+2) per night action |

**Three investigation modes (player picks one per night):**

| Mode | What they learn | Drift tier cost |
|---|---|---|
| **Story consistency** | "Their story holds together" / "something doesn't add up" / "you learned nothing." | T2 (+2) |
| **Cross-reference** | Interrogator names a specific claim (e.g. "X said they're a Citizen"). True / false / unverifiable. | T2 (+2) |
| **Cumulative bonus** | If Interrogator investigates the same player two nights in a row, the second night gives a sharper hint: "specifically, they lied about X." Cap at 2 nights on the same target — must pivot after. | T2 (+2) per night |

**Threshold zone effects on Interrogator output:**

| Interrogator drift zone | Intel noise rate | Effect |
|---|---|---|
| 🟢 Green (0–4) | 0% | Output is exact |
| 🟡 Yellow (5–9) | 20% | 1-in-5 chance the result is "unclear" or "opposite" |
| 🟠 Orange (10–14) | 40% | Coin-flip noise |
| 🔴 Red (15–19) | 80% | Mostly unreliable |
| ⬛ Black (20) | 100% | Always wrong / silent |

**Why this matters:** an Interrogator who tortures-and-probes every night *climbs into Orange by Day 4*. By Day 5, their intel is coin-flip. **A Loyalist who burns bright burns out.**

**Counterplay:** Interrogator must alternate between investigation nights and sleep nights to stay in Green/Yellow. Sacrifice consistency for reliability.

---

### L3 — Chirurgeon

| Field | Value |
|---|---|
| **Claim** | Chirurgeon (self — Medicae officer) |
| **Lore** | The cell's medic. Keeps the Inquisition alive through bullet wounds, poison, and Warp-induced nightmares. Their job is survival — making sure that when Murderer strikes, *someone* lives. |
| **Night action** | Protect one player from the night kill. Standard Doctor slot. |
| **Drift tier** | T1 (+1) per night action |
| **Night chat** | None. Chirurgeon acts silently. |

**Mechanic:**
- Chirurgeon designates one player per night.
- If Murderer (or any night-killing role) targets that player, the kill is prevented.
- Chirurgeon does *not* learn whether their protection fired or not. They learn only that they used their night action.
- Standard Doctor semantics from Werewolf, just chat-flavored.

**Drift trade-off:** Chirurgeon is T1 (lowest non-passive tier). If they protect every night for 5 days, they accrue +5 drift — landing them at Yellow by Day 4. Manageable. A green-zone Chirurgeon is reliable; an orange-zone one is making poor calls.

**Counterplay:** Murderer can "test" a Chirurgeon by deliberately targeting them — Chirurgeon's protection fires on themselves, wasting the resource. Murderer learns nothing about Citizens. Standard Werewolf double-kill logic, slightly drift-priced.

---

### L4 — Novice-Psychic (drift-hint oracle)

| Field | Value |
|---|---|
| **Claim** | Novice-Psychic (self — barely-trained sanctioned psyker) |
| **Lore** | The thinnest psyker the Inquisition tolerates. Feels the warp on people but cannot shape it. Their gift is impressionistic — qualitative hints, not faction reveals. |
| **Night action** | Receive a **drift hint** about one target. Qualitative only — no faction, no role, no number. |
| **Drift tier** | T1 (+1) per night action |

**What the drift hint returns** (scoped by target's zone):

| Target zone | Hint returns |
|---|---|
| 🟢 Green (0–4) | "Their soul is clean. Whatever they're hiding, it's not warp-taint." |
| 🟡 Yellow (5–9) | "Something whispers behind their eyes. Watch them." |
| 🟠 Orange (10–14) | "The warp presses close to them. The Emperor's light is dimmer when they're near." |
| 🔴 Red (15–19) | "They are half-lost already. The warp sings when it sees them." |
| ⬛ Black (20) | "They are not one soul anymore. There are voices behind their eyes." |

**Plus base failure mode:**
- T1 at green: 0% noise
- T1 at yellow: 10% noise (T1 is gentle, half-rate)
- T1 at orange: 20% noise
- T1 at red: 40% noise
- T1 at black: 50% noise

**Noise rates are T1 × zone rate (per `drift.json` § intelReliability).**

**Why L4 is *not* Seer:**
- A Seer sees faction. L4 sees *warp-taint*. A Loyalist Interrogator in Black zone *still* reads as "not one soul anymore" to L4 — because L4 reads drift, not alignment.
- **This means L4 cannot catch Heretics who haven't drifted yet.** A Heretic who plays clean (T0 every night, no kills, no sermons) reads as Green to L4. *Until they act, L4 is blind to them.*

**Counterplay:** Heretic Murderer who kills every night climbs to T2 territory. By Night 3, L4 sees them as Yellow or Orange. Recruiter (T3 every night when active) climbs fastest. **L4 is a counter to aggressive Heretics, not stealthy ones.**

---

### L5 — Arbitrator

| Field | Value |
|---|---|
| **Claim** | Arbitrator (self — Adeptus Arbites enforcer) |
| **Lore** | The law. The badge. The bodyguard who takes the bullet meant for someone else. |
| **Night action** | **Bodyguard.** Take the hit for one chosen player tonight. |
| **Drift tier** | T1 (+1) per night action |
| **Limit** | Once per night (one player protected) |
| **Failure mode** | If the protected player was not targeted, Arbitrator's action has no game effect — they just spent the night on guard duty. |

**Bodyguard semantics (proxy variant, locked):**
- Arbitrator designates *one* player per night as their proxy.
- If Murderer (or any night-killing role) targets the proxy, **the kill lands on the Arbitrator instead.**
- Arbitrator survives (this is Werewolf-bodyguard, not death).
- Arbitrator *learns* the next day that they absorbed a hit (visible to the protected player and to the cell).

**Drift cost:** T1, low. Arbitrator can bodyguard every night for 5 days and land at +5 — same as Chirurgeon. Arbitor-and-Chirurgeon are the durable defenders; Interrogator is the volatile investigator.

**Bodyguard vs Protect (key distinction):**

| Aspect | Chirurgeon (Protect) | Arbitrator (Bodyguard) |
|---|---|---|
| Target on hit | Target protected, no damage | Target protected, **Arbitrator** takes damage |
| Survives | Both survive | Both survive |
| Drift tier | T1 (+1) | T1 (+1) |
| Discovers target afterward | No | Yes |
| Strategic role | Hides the protected | Marks the Arbitrator as "worth attacking" |

These are **two complementary defender roles**. A cell can have both. Chirurgeon for ambiguous threats (don't know who Murderer will hit), Arbitrator for confirmed protection (you know who's in danger — protect them, soak the hit yourself).

---

## 🎯 Day-phase interaction matrix

| Loyalist role | Day-phase power | Drift cost |
|---|---|---|
| Imperial Citizen | Pure voter | — |
| Interrogator | None (night-only) | — |
| Chirurgeon | None (night-only) | — |
| Novice-Psychic | None (night-only) | — |
| Arbitrator | None (night-only) | — |

**Lopsided — but in a different way from Heretics.** Loyalists act *at night* but the day is *their* phase: votes, mode-switch (interrogate/lynch), and they are the only ones with day-side power (voting + lynch initiator).

This balances the kit: **Heretics dominate night (3 of 5 act nightly); Loyalists dominate day (all 5 vote, mode-switch, lynch init).**

---

## ⚙️ Numerical balance check (drift pass)

### Per-night drift costs across Loyalist roles

| Action | Drift cost | Per night budget? |
|---|---|---|
| Citizen (sleep) | −1 | Default |
| Interrogator (any mode) | +2 | Yes |
| Chirurgeon (protect) | +1 | Yes |
| Novice-Psychic (drift hint) | +1 | Yes |
| Arbitrator (bodyguard) | +1 | Yes |

**Maximum possible Loyalist drift per night** (all 5 act on their roles, excluding Citizen):
- Interrogator +2 + Chirurgeon +1 + Novice-Psychic +1 + Arbitrator +1 = +5 drift (without Priest)
- With Priest active (Litany): +6 self, −10 target = net −4 across two players, but Priest climbs
- Citizen contributes −1 (sleep)
- **Net cell-wide drift: +4 drift across 4 active Loyalists in one night** (Priest trades drift between self and target).

That's ~20% of MAX. A Loyalist playing hero-every-night hits Yellow by Day 3, Orange by Day 5, Black by Day 7-8. **Steady pressure.**

**Sanity check:** A Loyalist who *sleeps* every night (T0 = −1) ends Day 5 at +0 if no system pressure hit them. A Loyalist who *acts* every night ends Day 5 at +15-20 (Red or Black). **The tradeoff is real: act and risk, or rest and stay clean.**

---

## ⚔️ Loyalist kit vs Heretic kit — role symmetry

| Aspect | Loyalist | Heretic |
|---|---|---|
| Night-action density | 5 of 6 nightly (excluding Citizen; Priest is on-demand) | 4 of 5 nightly (excluding Conspirator) |
| Day-action density | 6 vote + mode-switch | 1 (Conspirator forgery) |
| Kill capability | None | 1 (Murderer) |
| Convert capability | None | 1 (Recruiter — flip-from-catalyst) |
| Defender role | 2 (Chirurgeon + Arbitrator) | 0 |
| Investigator role | 2 (Interrogator + Novice-Psychic) | 0 (Saboteur is *anti*-investigator) |
| Information attacker | 0 | 1 (Saboteur booby-trap) |
| Identity-disguising role | 1 (Novice-Psychic reads drift; Heretic Priest masquerades as Priest) | 2 (Heretic Priest, Conspirator forgery) |
| Catalyst carrier | n/a | 1 (Recruiter) |
| Passive scout / claim-disguiser | 1 (Interrogator's claim can be forged by Conspirator) | 0 |

**Net effect:**
- Loyalists have **structural advantage in defense and investigation** (5 of 10 roles).
- Heretics have **structural advantage in deception and disruption** (5 of 10 roles).
- The cell must *coordinate* to use their information edge; Heretics must *disguise* to escape detection.
- **Parity win condition favors the side that better uses its own structural advantage.**

---

## 🩸 Heretic's take

The Loyalist kit mirrors the Heretic kit **without being its inverse.** Both have 5 roles, both act mostly at night (one Conspirator-as-day-side for Heretics; voting/mode-switch for Loyalists), but the *kind* of night-action is structurally different.

What this kit does:
1. **Locks Citizen as noise-floor.** Without Citizens, every non-Citizen is a "suspect." With Citizens (~50–60% of cell), the table is overwhelmingly Innocent-Looking.
2. **Two defenders, two investigators.** This is the *Werewolf* sweet spot — enough redundancy that the cell doesn't collapse if one role is killed, but not so many that investigation is air-tight.
3. **Novice-Psychic as anti-stealth-Heretoric.** Reads *drift*, not alignment. Blind to clean Heretics. **Punishes action, rewards silence.** This is the counter to the Heretic Priest by design.
4. **Interrogator's zone-noise is the punishment.** A 5-day Interrogator torture-spree ends in Orange, where their intel is coin-flip. This is the *exact* design law: **power = risk.**
5. **Bodyguard/Protect distinction creates defender *strategy*.** Chirurgeon for unknown threats, Arbitrator for known. Both T1, low drift. Solid tier.

If Nicolas locks this, **v1 has 10 roles total** (5 Loyalist + 5 Heretic) + drift + interrogation + day-mode switch + threshold zones. **The whole game.**

---

## 📅 Log of revisions

- **2026-07-06** — Initial 5-role spec formalized from role-briefing.md penciled roster. Bodyguard/Protect distinction locked, drift-zone effects on Interrogator output locked, Novice-Psychic re-defined as drift-hint oracle (not Seer).
- **2026-07-06 evening** — L6 Priest added. Roster is now 6 Loyalist + 5 Heretic = 11 total. Composition table per player count in `data/composition.json`.

---

## L6 — Priest (Loyalist)

| Field | Value |
|---|---|
| **ID** | `priest` |
| **Claim** | Priest (self) |
| **Lore** | The faithful shepherd. Holds the cell together through sermons, absolution, and the threat of holy intervention. Their job is *drift maintenance* — keeping the cell clean enough that intel remains reliable. |
| **Night action** | One of three sermon tiers. Self-cost vs target-effect trade. |
| **Drift tier** | T0_special (sermon-dependent: +1/+3/+6 self, varies target) |
| **Day action** | None (voter + mode-switch only) |
| **Detectability** | Drift-delta only — Priest is identifiable via their drift impact on the table (climbs with use), not via any direct reveal. |
| **Required?** | ✅ Yes — claim target for `heretic-priest`. Without L6, H2 cannot ship. |
| **Min player count** | 5 (ships whenever game ≥5p) |

### Three sermon tiers (locked in `drift.json` § `priestLoyalist`)

| Tier | Self-cost | Target effect | Frequency |
|---|---|---|---|
| **Whisper** (mild) | +1 | −2 | Daily (unlimited) |
| **Hymn** (strong) | +3 | −5 | **2× per game** *(locked 2026-07-06)* |
| **Litany** (brutal) | +6 | −10 (floor 0) | Once per game |

**Drift curve by playstyle:**

| Playstyle | Endgame drift |
|---|---|
| Whisper spam (clean support) | 0–3 |
| Brutal save (redemption arcs) | 8–12 by Day 4 |
| Sleep shield (passive backline) | 0–2 |
| Militant sermons | Hits Orange by Day 4 |

**Net cost of a Litany rescue:** Priest enters Orange zone. Target exits Red entirely. **±8 drift between two players.** That's the cost of dramatic redemption.

**Skip alternative:** Sleep (T0, −1). Some nights skip and recover self.

### Why this role matters for v1

The Priest is the **claim-disguise surface** for the Heretic Priest. Both roles ship with the same `claim: "Priest"` field in `data/roles-40k.json`. The only difference is the **math**:

| Aspect | Loyalist Priest | Heretic Priest |
|---|---|---|
| Claim | Priest (self) | Priest (claims-matching) |
| Faction | loyalist | heretic |
| Whisper | −2 (target) | +3 (target, looks like Whisper) |
| Hymn | −5 (target) | +7 (target, looks like Hymn) |
| Litany | −10 (target, floor 0) | +12 (target, drives to Red) |

**Detection requires drift-delta tracking.** Since drift is hidden, only the *acting Priest themselves* sees the deltas. To catch a Heretic Priest, the Loyalists must find the real Priest and compare notes — which is impossible if there's only one Priest slot and it's the Heretic Priest.

**This is a contested-claim game.** Whoever wins the Priest slot at role-assign time controls both Priest mechanics AND a stealth Heretic slot. v1 keeps this tension; Phase 2 can expand.

### Open sub-questions

1. **Whisper self-cost at 0?** Currently +1. If 0, Whisper spam becomes free — Priest climbs no drift. Probably too strong.
2. **Litany floor** — currently 0 (target can never go below 0). Locked. Flag for review if "below 0 = -drift" becomes a twist later.
3. **Sermon tier visibility** — should the target see which tier was used, or just the effect? Currently shows the tier name in chat. *Default: tier name visible, drift change visible (target only).*

---

## ❓ Open sub-questions

1. **L4 (Novice-Psychic) — keep "drift hint" or shift to "role reveal"?** Current spec is qualitative drift. Was there a Seer-original in mind that should come back? Per locked design law (no Seer in v1), drift-hint is correct.
2. **Interrogator cumulative-bonus cap at 2 nights.** Increase to 3 nights? Decrease to 1? Tradeoff is intel power vs pressure to pivot.
3. **Chirurgeon + Arbitrator — keep both as separate roles, or merge into a single Defender?** Currently locked as separate (different mechanics). Confirm.
4. **Bodyguard variant** (proxy, not protect) is locked. Should Arbitrator instead be *additional* defender (two-protects stacked) — that would change competitive balance.