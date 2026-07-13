# Heresy Rising — Build Handoff (v1, Phase 1)

> **For:** build / coding agent (name TBD — refer to as "you" or "the agent")
> **From:** Nicolas + Heretic
> **Path:** 40k-first (no placeholders, no subfactions, no twists)
> **Source of truth:** everything in this document; if it disagrees with another doc, this one wins
> **Phase:** Phase 0 design lock is COMPLETE. You are starting Phase 1.

---

## ⚠️ Critical instruction (read first)

**Do NOT invent mechanics.** Every system you need is specified below or in a linked file. If something is unclear, stop and ask rather than guess. Where a sub-question is unresolved, a *default* is provided — use the default and flag it in code comments for review, but do not invent alternatives.

---

## 1. What you're building

**Heresy Rising** is a chat-based social deduction game in the Warhammer 40,000 universe. It is built on Werewolf's bones but rebuilt around three novel ideas:

1. **Interrogation replaces lynching as the first escalation step** — table votes each day for a target or Skip. Same target on consecutive days becomes a lynch; otherwise the selected target is interrogated. See `docs/specs/mechanics/day-phase.md` §Core mechanic.
2. **Drift** — hidden corruption meter per player, 0 to MAX (default 20). Rises from actions, never resets, only flips to Heretic via *heretical catalyst* (a special role ability targeting a Black-zone player).
3. **Cripple-not-kill** — instead of dying, players lose *capability* (night actions, investigation power, day-vote influence). Death is rare.

Two factions v1: **Loyalist** (6 roles, including Priest) and **Heretic** (5 roles). Total roster = **11 roles**. Heretic win = parity (their living count ≥ Loyalists). Single shared `#graveyard` channel.

> ⚠️ **Roster count was 10 in early drafts.** 2026-07-06 session added Loyalist Priest (L6) as a 6th Loyalist role because HANDOFF §4 locked Priest sermons and ROSTER.md locked 5-role kit — those two facts required either dropping Priest or adding it. Resolution: add it. **Roster is 11 roles total** (6 Loyalist + 5 Heretic). Composition table per player count lives in `data/composition.json`.

---

## 2. Reading order (do this before you code)

1. `docs/CONCEPT.md` — full concept, all rules, all glossary
2. `docs/GAME_PLAN.md` — Phase 0 status, Phase 1 acceptance criteria, what's NOT in v1
3. `docs/ROSTER.md` — role data shape, both kits summarized
4. `<repo-root>/projects/heresy-rising/mechanics/drift.md` — drift mechanic spec (human)
5. `<repo-root>/projects/heresy-rising/mechanics/drift.json` — drift constants + zones + Priest deltas (machine)
6. `<repo-root>/projects/heresy-rising/mechanics/loyalist-kit.md` — 6 Loyalist roles spec'd (5 base + Priest as L6)
7. `<repo-root>/projects/heresy-rising/mechanics/heretic-kit.md` — 5 Heretic roles spec'd
8. `<repo-root>/projects/heresy-rising/mechanics/interrogation.md` — interrogation tier system
9. `<repo-root>/heresy-rising-site/data/composition.json` — per-player-count role composition table
10. `<repo-root>/heresy-rising-site/data/roles-40k.json` — machine-readable role data (engine reads from this, not hardcoded)

Total reading time: ~30 min. **Don't skip.**

---

## 3. Hard rules (do not violate)

| # | Rule |
|---|---|
| 1 | **Power = risk.** Stronger roles drift faster. |
| 2 | **Drift is hidden.** Numeric value never exposed to table. Drift hints (zone-based flavor text) sent only to the drifting player. |
| 3 | **Drift never resets.** Only locks in at max. The only "drift reduction" mechanics are Priest sermons (specific deltas in `drift.json`). |
| 4 | **Conversion requires heretical catalyst**, not max drift alone. Catalyst = role ability on Black-zone target. |
| 5 | **Roles are data, not code.** All **11** roles live in `data/roles-40k.json` (or equivalent). Engine reads role data; no hardcoded role logic. |
| 6 | **Heretics must have a believable claim.** Same surface as Loyalist, different math. (Don't break this when implementing both kits.) |
| 7 | **Chat-based, not table-based.** This is a Telegram/Discord game. UI is text-first. No graphics-heavy systems. |
| 8 | **Single shared `#graveyard`.** Dead of all factions in one channel. |

---

## 4. Drift engine — concrete spec

### Constants (from `drift.json`)

```json
{
  "MAX_DRIFT": 20,
  "BASE_DRIFT": 0,
  "NIGHTLY_SLEEP_RECOVERY": -1,
  "DRIFT_FLOOR": 0,
  "HERETIC_DRIFT_CAP": 13
}
```

### Action tier costs

| Tier | Cost | Examples |
|---|---|---|
| T0 (sleep) | −1 | Skipping night action |
| T1 (soft intel) | +1 | Novice-Psychic, Chirurgeon, Arbitrator, Conspirator, Recruiter-fail |
| T2 (active intel) | +2 | Interrogator, Saboteur, Murderer, Heretic Priest False Comfort, Heretic Priest Twisted Hymn |
| T3 (power play) | +3 | Recruiter (catalyst), Heretic Priest Warp Litany |

### Day-trigger costs

| Trigger | Cost | Notes |
|---|---|---|
| Wrong lynch | +2 | Lynch target confirmed Loyalist post-reveal |
| Witnessed violence | +1 | Public execution, night kill |
| Wrong interrogation | +1 | Voters for the interrogated Loyalist; see `docs/specs/mechanics/day-phase.md` |
| Right interrogation | −1 | All living players when the interrogated target is Heretic |

### Threshold zones (intel noise scales with zone)

| Zone | Range | Noise rate |
|---|---|---|
| 🟢 Green | 0–4 | 0% (exact) |
| 🟡 Yellow | 5–9 | 20% |
| 🟠 Orange | 10–14 | 40% |
| 🔴 Red | 15–19 | 80% |
| ⬛ Black | 20 | 100% |

**Noise rate** = probability that an intel action returns `unclear` or `opposite` instead of true result. T1 actions halve noise rate; T3 actions get no reduction.

### Priest sermons (locked deltas)

*Loyalist Priest:*

| Tier | Self-cost | Target effect | Frequency |
|---|---|---|---|
| Whisper | +1 | −2 | Daily (unlimited) |
| Hymn | +3 | −5 | **2× per game** *(lower bound of original 2–3 range; locked 2026-07-06)* |
| Litany | +6 | −10 (floor 0) | Once per game |

*Heretic Priest (claims-matching):*

| Tier | Self-cost | Target effect | Frequency |
|---|---|---|---|
| False Comfort | **1** *(upper bound of original 0–1 range; locked 2026-07-06)* | +3 | Daily |
| Twisted Hymn | +2 | +7 | 2–3× per game |
| Warp Litany | +4 | +12 | Once per game |

> ⚠️ **Why locked to single values:** Heretic Priest False Comfort at self-cost 0 would *beat* Loyalist Whisper on cost-effectiveness while doing inverted damage. Implausible. Hymn at "2–3 uses" left engine with no hard cap, so it could be abused across long games. Single values are implementation-ready. Playtest may revise.

---

## 5. Roles (11 total)

### Loyalist (6)

| # | ID | Role | Claim | Night | Day | Tier | Detectability |
|---|---|---|---|---|---|---|---|
| L1 | `imperial-citizen` | Imperial Citizen | Citizen | None (sleep) | Voter | T0 | n/a |
| L2 | `interrogator` | Interrogator | Interrogator | Investigate 1 player (3 modes) | None | T2 | Action-detected |
| L3 | `chirurgeon` | Chirurgeon | Chirurgeon | Protect 1 player | None | T1 | Action-detected |
| L4 | `novice-psychic` | Novice-Psychic | Novice-Psychic | Drift-hint on 1 player | None | T1 | Action-detected |
| L5 | `arbitrator` | Arbitrator | Arbitrator | Bodyguard-proxy 1 player | None | T1 | Action-detected |
| L6 | `priest` | Priest (Loyalist) | Priest | Whisper / Hymn / Litany sermon | None | T0_special | Drift-delta |

### Heretic (5)

| # | ID | Role | Claim | Night | Day | Tier | Detectability |
|---|---|---|---|---|---|---|---|
| H1 | `murderer` | Murderer | Citizen | Kill 1 player | None | T2 | Standard |
| H2 | `heretic-priest` | Heretic Priest | Priest (claims-matching) | Inverted sermon | None | T0_special | Drift-delta only |
| H3 | `conspirator` | Conspirator | Citizen | None | Forgery (1×/day) | T1 | Possible |
| H4 | `saboteur` | Saboteur | Citizen | Booby-trap 1 player | None | T2 | Action-detected |
| H5 | `recruiter` | Recruiter | Citizen | Heretical catalyst (Black-zone only) | None | T3 | When triggered |

**Role IDs** are kebab-case strings as they appear in `data/roles-40k.json`. Engine must read role data from JSON — never hardcode roles.

**Composition per player count** lives in `data/composition.json`. Non-Citizen roles are unique per game; Citizens repeat to fill remaining slots. Hard rules: `priest` ships ≥5p; `heretic-priest` ≥6p; `recruiter` ≥8p; `conspirator` ≥11p.

**Roles spec'd in `<repo-root>/projects/heresy-rising/mechanics/{loyalist-kit,heretic-kit}.md`** — read before implementing each.

---

## 6. Interrogation tiers (stat-damage system)

| Tier | Effect | Day-vote drift |
|---|---|---|
| 1 — Light Scarring | Lose one night action this round; recoverable | Per `docs/specs/mechanics/day-phase.md`: wrong interrogation +1 to target voters; right interrogation −1 to all living |
| 2 — Broken | Lose all night actions; vote weight −1; justify votes publicly | Same day-phase drift table |
| 3 — Crippled | No night actions; **confess role on direct ask**; overflow → auto-conversion | Lynch jumps here and applies lynch drift/reveal |

**Tier progression** *(default, 2026-07-06 — flag for review)*: same-target repeat auto-escalates 1→2→3. Different target resets to 1. T1 recovers after 1 round of no re-interrogation. T2/T3 permanent.

**Confession mechanic** *(default, 2026-07-06 — flag for review)*:
- T3: confession forced **on direct ask**, not automatic broadcast.
- T1/T2: choice mechanic per `interrogation.md` §3 (Confess / Resist / Refuse+Break).
- **Protection token** (Confess outcome): blocks re-interrogation for the rest of THIS Day phase only. Does NOT block night actions. Refreshes on new confession. No stacking. Faction-blind.

Lynch = tier-3 shortcut + death + alignment reveal.

Full spec: `<repo-root>/projects/heresy-rising/mechanics/interrogation.md`.

---

## 7. Day vote (locked target-first mechanic)

Q7 is locked as of 2026-07-13. The canonical mechanic is `docs/specs/mechanics/day-phase.md` §Core mechanic:

- Players cast one vote per day for a target or Skip. They do not vote on a mode.
- Majority of living players (>50%) is required for a non-Skip target.
- Same target voted on consecutive days → lynch: cripple to max, kill, alignment reveal.
- Different target, Skip, or no target majority → interrogation/skip per the day-phase spec.
- Ties between top targets resolve to the higher-drift target; if still tied, the round is skipped.

---

## 8. Win conditions

| Outcome | Trigger |
|---|---|
| **Heretic win** | Heretics alive ≥ Loyalists alive |
| **Loyalist win** | All Heretics crippled (tier 3) and have confessed role |
| **🔥 Pyrrhic** *(optional)* | If ≥4 players crippled in 8p game, no clean win; war ends ugly |

Implement parity + Loyalist elimination. Pyrrhic is a design polish; defer.

---

## 9. Phase 1 acceptance criteria

(You MUST satisfy these before declaring v1 done.)

- [ ] `npm run dev` (or equivalent) boots both client + server.
- [ ] 5–12 players can join lobby, ready up, host starts game.
- [ ] Roles assigned from `data/roles-40k.json` — no hardcoded ROLES object.
- [ ] Night actions resolve correctly. Recruiter's catalyst only fires on Black-zone target.
- [ ] Day vote is target-first with explicit Skip; mode is inferred from consecutive-day target history.
- [ ] Interrogation applies tier-tied crippling per spec.
- [ ] Lynch applies cripple-to-max + kill + alignment reveal.
- [ ] Drift mutates only on canonical triggers (sleep, action tier cost, day-phase outcomes, witnessed violence, Priest sermon deltas).
- [ ] Drift hints sent to drifting player only. Numeric value never exposed to anyone but engine.
- [ ] Drift MAX configurable (default 20, overridable per game setup).
- [ ] Nightly sleep = −1 only if action was skipped.
- [ ] Heretic drift cap (13 by Day 3, else +3 spike) enforced.
- [ ] Threshold zones drive intel noise rates per spec.
- [ ] Priest (Loyalist + Heretic) sermon tiers wired with locked deltas.
- [ ] Heretic parity win condition triggers correctly.
- [ ] No references to Puritan, Radical, subfaction, or any twist mechanic in code.
- [ ] Engine scenarios/barracks-agnostic — drift hints ARE configurable per game setup (Phase 2 hooks ok if stub).

---

## 10. Architecture hints

| Concern | Guidance |
|---|---|
| Roles as data | JSON in `data/roles-40k.json`. Engine reads; never hardcode role logic. |
| Drift hiding | Server-authoritative. Client never sees numbers; only sends zone-based hints. |
| Chat channels | One `#graveyard` shared by all dead. Heretic faction chat for Heretics. Day chat for everyone. |
| Anti-cheat | Server-authoritative hidden state only. Don't trust client. |
| Persistence | Game state in DB, scoped to game ID. No persistent accounts (player codes are bearer creds). |
| Scenario hooks | Drift hint text reads from a config file (e.g. `scenarios/default/hints.json`). Even if v1 has only one scenario, this flag exists in the code path so scenarios can swap without refactor. |

---

## 11. Explicit DON'Ts

| ❌ Don't | Why |
|---|---|
| Invent a role not in the 10-role list | Spec is locked. |
| Hardcode roles | Roles are data. |
| Add Puritan/Radical subfactions | Phase 2. |
| Add any twist mechanic | Phase 2/3. |
| Implement alternative win conditions | Parity is v1. |
| Expose drift numbers to clients | Hidden by design. |
| Bake planetary framing into prompts/scoring | Scenarios deferred; engine must be agnostic. |
| Replace Werewolf voting with a custom UI just because | Stick to plurality + majority defaults. Phase 2 can iterate. |

---

## 12. Where to ask

If something is unclear:
1. Re-read the linked spec file end-to-end.
2. If still unclear, check `MEMORY.md` (project root, in workspace) for the latest session-level decisions.
3. If still unclear, **stop and ask Nicolas**. Do not invent.

---

## 13. Sub-questions with defaults (use the default, flag in comments)

> **Status note:** as of 2026-07-06 evening session, defaults #9–#16 below were added to unblock Phase 1 build. They're tracked alongside the original 8 in `<repo-root>/projects/heresy-rising/OPEN_QUESTIONS.md` with canonical question text. Bot must update that file when locking any default.

| # | Question | Default to use | Status |
|---|---|---|---|
| 1 | Interrogation vote threshold | Plurality + re-vote on tie | 🟡 Sub-question 1, phase-0 open |
| 2 | Day-mode mechanics | See `docs/specs/mechanics/day-phase.md` §Core mechanic | ✅ Locked 2026-07-13 |
| 3 | Interrogator cumulative-bonus cap | 2 nights, must pivot after | 🟡 Open 2026-07-06 |
| 4 | Saboteur trap frequency | Per-night | 🟡 Open 2026-07-06 |
| 5 | Conspirator forgery variant | Attribute message to other player | 🟡 Open 2026-07-06 |
| 6 | Recruiter failure feedback | Silent fail | 🟡 Open 2026-07-06 |
| 7 | Faction hostility predicate | `isHostileTo(a,b) = a.faction !== b.faction` (trivial) | 🟡 Open 2026-07-06 |
| 8 | Pyrrhic "no clean win" | Defer (out of v1) | 🟡 Optional |
| 9 | **Priest Hymn frequency** | **2× per game** (lower bound of 2–3) | 🟡 **Open 2026-07-06, defaulted** |
| 10 | **Heretic Priest False Comfort self-cost** | **1** (upper bound of 0–1) | 🟡 **Open 2026-07-06, defaulted** |
| 11 | **Interrogation tier progression** | **Auto-escalate on same target** (1→2→3; reset on different target) | 🟡 **Open 2026-07-06, defaulted** |
| 12 | **T1 recovery** | **1 round of no re-interrogation** | 🟡 **Open 2026-07-06, defaulted** |
| 13 | **T3 confession trigger** | **Forced on direct ask, not automatic** | 🟡 **Open 2026-07-06, defaulted** |
| 14 | **Confession protection token scope** | **Block re-interrogation this Day phase only** | 🟡 **Open 2026-07-06, defaulted** |
| 15 | **T1 witness drift scope** | **Every living player except target** | 🟡 **Open 2026-07-06, defaulted** |
| 16 | **Role composition per player count** | **See `data/composition.json`** | 🟡 **Open 2026-07-06, defaulted** |

Items 9–16 are **defaults locked in the 2026-07-06 session** to unblock Phase 1 build. They are NOT canonical until Nicolas locks them — flag every callsite with `// TODO(heresy-spec):`.

---

## 14. What this handoff does NOT cover (deferred explicitly)

- Phase 2: Puritan/Radical subfactions
- Phase 2: convert-as-touch twist
- Phase 2: rosette/purity seal, daemonhost, transform ladder, etc.
- Phase 3: scenario variants (voidship / planet / regiment)
- Phase 3: any of the 15 declared twist mechanics
- Mobile native app
- Persistent accounts / login

---

## 📌 Final notes

- This is a **fun game** about **rot, suspicion, and choices**. The drift mechanic is the soul of the game — make it feel weighty without making it punitive. Players who play carefully should *stay clean*. Players who push should *feel the cost*.
- When in doubt: **Werewolf does it this way**. Default to that. Spec overrides only when explicit.
- You're building the **first playable** of a 40k-flavored social deduction game. Make it fun. Make it cuttable for a chat client. Make it readable in plain text.

Good luck. 🩸

---

*Last updated 2026-07-06. Refresh only if Nicolas explicitly asks.*
