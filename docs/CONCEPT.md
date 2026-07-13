# Heresy Rising — Concept Brief

> **Status:** Draft v0.2 — 2026-07-05 (post design-lock pass)
> **Audience:** Coding agents (Claude Code / Codex / Cursor / etc.) and future collaborators.
> **Source of truth for design decisions:** `/home/node/.openclaw/workspace/heretic/MEMORY.md` (locked pillars) and `/home/node/.openclaw/workspace/heretic/projects/heresy-rising/` (mechanics docs).

---

## 1. One-paragraph pitch

**Heresy Rising** is a persistent, chat-based social deduction game for **5–12 players**, set in the Warhammer 40,000 universe. Players join a faction-locked cell of the Imperium — **Loyalist** or hidden **Heretic** — and over a series of **Day / Night** phases, they debate, accuse, cripple, and damn one another in pursuit of parity. Each player has a hidden **Drift** meter that rises from *actions* (wrong lynch, witnessing violence, using high-power night actions, voting with the losing side) and only converts to Heretic when a **heretical catalyst** is performed on a maxed player. Day-phase is an **interrogate-or-lynch switch**: the table picks each round whether to **interrogate** (cripple, no death) or **lynch** (cripple-to-max then death, alignment revealed). Drift is **never reset** — it only locks in. Death is meaningful but not the only lever.

---

## 2. Locked design pillars

| # | Pillar | Source |
|---|---|---|
| 1 | Werewolf-style phase loop (Day / Night) | `MEMORY.md` |
| 2 | Hidden **Drift** meter per player | `MEMORY.md` |
| 3 | Drift caused by **actions**, not knowledge | `MEMORY.md` |
| 4 | Drift **never resets**; only locks in at max | `MEMORY.md` 2026-07-02 |
| 5 | **Power = risk.** Stronger roles drift faster | `MEMORY.md` |
| 6 | **Interrogation** is the default day action; **lynch** is the escalation lever | locked 2026-07-05 |
| 7 | Interrogation **cripples**, not kills | `MEMORY.md` 2026-07-01 |
| 8 | Crippling is **role-tied**: crippling your most powerful roles cripples *your own faction* | `MEMORY.md` 2026-07-01 |
| 9 | The Inquisition has internal subfactions (Puritan / Radical), **layered in later** | `MEMORY.md` |
| 10 | **Two-faction map (Loyalist / Heretic) for v1.** Subfactions come in a later phase | locked 2026-07-05 |
| 11 | **Drift visibility = faint hints.** System cues, never a public stat | locked 2026-07-05 |
| 12 | **Drift endgame = accumulation + heretical catalyst.** No auto-flip; conversion requires an explicit action | locked 2026-07-05 |
| 13 | **Heretic win = parity.** Heretics win when their living count ≥ Loyalists | locked 2026-07-05 |

### 2a. Hard constraints on implementation

- 🚨 **Chat-based game.** Played in Telegram / Discord, not around a table.
- 🚨 **Twists are ornaments, not base.** The 15 "potential mechanics" (`MEMORY.md`) are **not** in the base loop.
- 🚨 **One shared `#graveyard` channel.** Dead of all factions share one chat.
- 🚨 **Path = 40k-first.** Lock the design, *then* build. Don't ship placeholders.

---

## 3. The design (locked)

### 3a. Factions (v1)

| Faction | Public? | Win condition |
|---|---|---|
| **Loyalist** | Visible | Reduce Heretic living count to below parity |
| **Heretic** | Hidden (some known to GM only) | Living count ≥ Loyalist count |

Puritan and Radical subfactions are **explicitly deferred** to a later phase. Roles in v1 have *no* subfaction field — that hook exists in the data shape for future use.

### 3b. The phase loop

```
lobby → role-reveal → night → day → repeat → faction win
```

**Night** — eligible roles submit private actions (kill, investigate, protect, heretical-catalyst).
**Day** — table debates, then votes. Vote outcome is one of two modes:

| Mode | Result |
|---|---|
| **Interrogate** | Target is crippled (tier 1 / 2 / 3, role-tied), survives |
| **Lynch** | Target is **crippled to max then killed**, alignment revealed publicly |

The mode is chosen by the table — either via majority vote of living players on the mode itself, or by direct nomination (see `interrogation.md` for vote-threshold spec).

### 3c. Drift

Drift is a per-player integer, **0 to 20** (MAX=20, locked 2026-07-06). Headroom for 5+ day games without instant-converting every misplay.

**Trigger costs (canonical four):**

| Trigger | Drift cost | Note |
|---|---|---|
| Wrong lynch (you voted to kill an innocent) | +2 | Slow-burn regret |
| Witnessed violence (night kill, public execution) | +1 | Applies to all living players |
| Used a high-power night action (T1/T2/T3) | +1 / +2 / +3 | Tiered by action power |
| Voted with the eventual losing side | +1 | **Halts after Day 5** (long-game flatten) |

**Tier cost spec (locked 2026-07-06):**

| Tier | Cost | Examples |
|---|---|---|
| **T0 — Pass / sleep** | **−1** | Skip night action |
| **T1 — Soft intel** | **+1** | Light Interrogator, Passive Informant |
| **T2 — Active intel** | **+2** | Standard Interrogator, Witness scan |
| **T3 — Power play** | **+3** | Brutal Interrogator torture, Heretic sacrament |

**Threshold zones (intel noise scales with zone — locked 2026-07-06):**

| Zone | Drift | Intel reliability | Drift hints | Table notices |
|---|---|---|---|---|
| 🟢 Green (Clean) | 0–4 | Exact | None | None |
| 🟡 Yellow (Tainted) | 5–9 | 20% noise | Faint | None |
| 🟠 Orange (Wavering) | 10–14 | 40% noise | Loud | Behavior shows |
| 🔴 Red (Heretical) | 15–19 | 80% noise | Constant | Obvious |
| ⬛ Black (Max) | 20 | Unreliable | You know | Convert-vulnerable |

**Nightly sleep = −1 drift** (requires skipping your night action). Sleep is the only passive anti-drift.

**Heretic drift cap = 13 by end of Day 3** (else +3 spike). Prevents stealth clean-handed Heretic wins.

**Drift floor = 0.** Sleep cannot fully cleanse — players always carry some accumulation.

Visibility is **faint hints only** — the player receives system cues like *"you feel a chill"*, *"the Emperor's light feels further today"* as drift crosses zones. No numeric display. Table sees nothing.

**Drift does not reset.** Convertible Drift (twist #9) is the *one* exception — and it's an active player choice, not a cure.

**Conversion** requires a **heretical action performed on the target** (a Heretic-aligned ability targeting a max-drift player at Black zone). No auto-flip. A max-drift player who never gets touched stays maxed but loyal.

**Priests (locked 2026-07-06).** Two roles claim Priest — one Loyalist, one Heretic.

*Loyalist Priest three sermon tiers:*

| Tier | Self-cost | Target effect | Frequency |
|---|---|---|---|
| Whisper (mild) | +1 | −2 | Daily (unlimited) |
| Hymn (strong) | +3 | −5 | **2× per game** *(2026-07-06: lower bound of 2–3 range, locked)* |
| Litany (brutal) | +6 | −10 (floor 0) | Once per game |

*Heretic Priest (stealth) tiers — same UI, inverted math:*

| Tier | Self-cost | Target effect | Stealth effect |
|---|---|---|---|
| False Comfort | **1** *(2026-07-06: upper bound of 0–1 range, locked)* | **+3** | Looks like Whisper |
| Twisted Hymn | +2 | **+7** | Target feels "strengthened" (wrong-feeling) |
| Warp Litany | +4 | **+12** | Drives target into / near Red |

Detection logic: track drift deltas after Priest interventions. Loyalists whose "priest intervention" actually raises their drift = Heretic Priest.

Full spec: `projects/heresy-rising/mechanics/drift.md` § Priests. Machine data: `projects/heresy-rising/mechanics/drift.json`.

### 3d. Interrogation tiers (from `interrogation.md`)

| Tier | Effect on target | Drift cost |
|---|---|---|
| **1 — Light Scarring** | Lose one night action this round; recoverable | target **+1**; every living player except target **+1** |
| **2 — Broken** | Lose all night actions; vote weight -1; must justify votes publicly | target **+2**; no witness drift |
| **3 — Crippled** | No night actions; **confess role on direct ask**; overflow → auto-conversion | target **+3** (overflow); no witness drift |

**Tier progression** *(default 2026-07-06, flag for review)*: same-target repeat auto-escalates 1→2→3. Different target resets to 1. T1 recovers after 1 round of no re-interrogation. T2/T3 permanent.

**Confession mechanic** *(default 2026-07-06, flag for review)*:
- T3: confession forced **on direct ask**, not automatic broadcast.
- T1/T2: choice mechanic per `interrogation.md` §3 (Confess / Resist / Refuse+Break).
- **Protection token** (Confess outcome): blocks re-interrogation for the rest of THIS Day phase only. Does NOT block night actions. Refreshes on new confession. No stacking. Faction-blind.

Lynch is the **tier-3 shortcut**: cripple-to-max, then death, alignment revealed.

### 3e. The 40k seam

Every role must be **data-swap-clean**. Concretely:

- **11 roles total** in v1 (6 Loyalist + 5 Heretic). See `data/roles-40k.json`.
- Roles stored as `{ id, alignment, action, driftWeight, crippleProfile, subfaction? }`. `driftWeight` is 0..3 and maps to the tier cost system (T1=+1, T2=+2, T3=+3) — locked 2026-07-06.
- `alignment` enum (v1): `loyalist | heretic`. Phase 2+: `loyalist | puritan | radical | heretic`. Engine never `switch`es on alignment directly; uses an `isHostileTo(other)` predicate.
- `crippleProfile` lists the role's stat blocks; crippling disables one. Lynch disables all.
- New role data files (`data/roles-40k.json`) swap in without engine surgery.
- **Composition per player count** lives in `data/composition.json`. Non-Citizen roles unique per game; Citizens repeat. Hard rules: `priest` ≥5p, `heretic-priest` ≥6p, `recruiter` ≥8p, `conspirator` ≥11p.

---

## 4. Out of scope (v1)

- ❌ Puritan / Radical subfactions in role data
- ❌ Hidden objectives, quorum-conversion, or alternative win conditions (parity only)
- ❌ Any of the 15 twist mechanics
- ❌ Mobile native app (web client only)
- ❌ Persistent accounts / login (player codes are bearer credentials)
- ❌ Scenario variants (voidship / planet / regiment) — *deferred 2026-07-06; default v1 cell = Imperial Regiment*. Engine architecture must not bake in planetary framing (barracks-agnostic). See `MEMORY.md` decoration #16.

---

## 5. Non-goals

- No anti-cheat beyond server-authoritative hidden state
- No real-money / gambling / NFT / blockchain. **Ever.**

---

## 6. Compliance note

Heresy Rising is an **unofficial, non-commercial Warhammer 40,000 fan project**. Not affiliated with, endorsed by, or sponsored by Games Workshop. Warhammer 40,000 and related marks belong to their respective owners.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| **Drift** | Hidden per-player corruption meter (0–MAX). Rises from actions. Never decreases. |
| **Heretical catalyst** | A faction ability that, when targeted at a max-drift player, flips them to Heretic |
| **Interrogate** | Day-phase vote outcome. Cripples (tiers 1–3), does not kill |
| **Lynch** | Day-phase vote outcome. Cripples-to-max, then kills, alignment revealed |
| **Cripple** | Role-tied stat damage. Disables part of a role's power |
| **Cell** | One game of Heresy Rising |
| **#graveyard** | Shared dead-player chat (single channel, all factions) |