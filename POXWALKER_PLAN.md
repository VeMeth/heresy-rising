# H7 Poxwalker — Implementation Plan

**Source dispatch:** `2026-08-03 poxwalker v1` (Heretic → Coder)
**Spec mirror:** `docs/specs/roles/poxwalker.md` v1.0.0 (🔒 locked, DO NOT EDIT)
**Plan status:** ✅ **Built 2026-08-03.** R1 ruled (protect clears the plague);
R2–R4 shipped on the recommendations below. Server 331/331, bot-manager
261/261, client and docs build clean. E2E not run — see §10.

---

## 1. Verdict

The mechanic is buildable and lands well on this engine. The visit-detection
half is close to free: `hr_actions` already stores one `(actor_code, kind,
target_code)` row per actor per round, so "who visited Patient Zero" is a
filter over the round's action rows, not new plumbing.

**But the dispatch cannot be implemented as written.** It describes an engine
that does not exist in this repo — most importantly a Chirurgeon with a
one-shot T3 *cure*. This repo's Chirurgeon is a nightly **protect** (doctor).
There is no heal, no cure, no `chirurgeonHealsRemaining`, and no action kind
of either sort anywhere in the codebase. The spec's entire Loyalist
counterplay rests on that cure.

**Ruled 2026-08-03: the existing protect clears the plague** (§2 R1). No new
action, no new UI. R2–R4 are engine-mapping questions with recommendations
attached; work can start on them. Everything else is mechanical and is scoped
file-by-file in §4.

---

## 2. Design rulings needed before coding

### R1 — The cure does not exist ✅ RULED: protect clears the plague

The spec's end conditions, counterplay table, heal-priority section and E10
all hinge on "the Chirurgeon's one-shot T3 cure."

Reality:

| Claim in dispatch | Reality |
|---|---|
| Chirurgeon has a one-shot T3 heal | Chirurgeon is `kind: "protect"`, T1, `driftWeight: 1`, **every night**, no limit — `game_data/roles-40k.json` |
| `chirurgeonHealsRemaining = 1` exists | No such field anywhere |
| "cure remains one-shot per game (existing)" | Nothing existing to extend |

`docs/AGENTS.md:207` also carries a locked design law: *"Chirurgeon (protect)
and Arbitrator (bodyguard) are mechanically distinct."* Bolting a cure onto
the Chirurgeon is a **change to a locked role**, not an additive change.

Options:

- **(a) New second action on the Chirurgeon.** A once-per-game `cure` that
  competes with protect for that night's single action slot (`hr_actions` PK
  is `(game_code, round, actor_code)` — one action per actor per night, so
  curing means not protecting that night). Closest to spec intent.
- **(b) Ship v1.0.0 with no cure.** Plague is uncurable; counterplay is
  "kill Patient Zero / lynch the Poxwalker" only. This is spec E10 (*no
  Chirurgeon in roster*) applied to every game. Smallest change, but it
  removes the role's designed tension.
- **(c) Repurpose protect.** A protect landing on an infected player clears
  the plague. No new action, no new UI, but it silently changes an existing
  locked role's behaviour and leaks plague state (the Chirurgeon would learn
  who is infected from the outcome).

**Ruling (2026-08-03): (c) — a Chirurgeon protect landing on an infected
player clears their plague.** No new action kind, no new UI, no new socket
route. Consequences to build to, and the ways this differs from the locked
spec:

1. **The leak concern is void.** It applied to the dispatch's *conditional
   cure button* ("visible only if the target is currently infected"), which
   would have been a free infection scanner. Protect has no such button and
   already carries the locked law that *the Chirurgeon does not learn whether
   their protection fired* (`heresyGameManager.js:820-829`). Keep it that way:
   **the cure is entirely silent to the Chirurgeon.** No ack, no report line
   change — `reportNightActions` must keep emitting the same
   `"Last night you protected X."` whether or not a plague lifted.
2. **The cure is no longer one-shot, and no longer costs +3.** It is nightly
   and rides protect's T1 (+1). This is a real balance departure from the
   spec — the plague is materially weaker than designed. It is bounded by two
   existing rules: protect occupies the Chirurgeon's only action slot, and
   `validateRotation` forbids protecting the same target on consecutive
   nights (`submitAction`), so Patient Zero cannot be locked down every night.
   **Flag to the designer as a v1.0.1 balance input** — it changes the
   dispatch's sim-validation numbers 1 and 2 more than the +1/+2 tuning does.
3. **Self-cure is possible.** Protect allows self-targeting (the client
   special-cases it, `GameView.vue:290`), so an infected Chirurgeon clears
   their own plague. Spec never contemplated this. Allow it unless told
   otherwise — blocking it would need a new exception in `submitAction`.
4. **A plague-crippled Chirurgeon silently fails.** `submitAction` returns
   `{kind:'protect', silent:true}` for a crippled actor, so the protect never
   lands and the plague is not cleared — with no feedback. That is consistent
   with existing behaviour; note it, don't fix it.
5. Source vs carrier semantics are unchanged from spec: protecting **Patient
   Zero** ends the plague entirely (source + every carrier); protecting a
   **carrier** clears only that carrier.

### R2 — Cripple is tiered, not boolean

Spec: *"Plague-Cripple and torture-Cripple share the same status flag…
re-rolled each night, no stacking, just binary on/off."*

Reality: `hr_players.cripple_tier` is `0..3` (`rules.json` → `cripple.MAX_TIER
= 3`, `PERMANENT_AT_TIER = 2`) plus `tier1_until_round`. Tier 1 lapses at the
next day transition; **tier 2+ is permanent**. There is no boolean.

The good news: **tier 1 is an almost exact fit** for "re-rolled each night, no
stacking." Setting `cripple_tier = 1, tier1_until_round = g.round + 1` inside
`resolveNight` costs the player exactly one night and self-clears at the
following day transition — the same trick Blood Ritual already uses and
explains at `heresyGameManager.js:786-793`.

Two collisions to rule on:

1. **Never downgrade.** A player already at torture-tier 2/3 (permanent) must
   not be *reduced* to tier 1 by a plague roll. Use
   `Math.max(existing, 1)` and only write `tier1_until_round` when the result
   is 1.
2. **The cure clears cripple → free torture-heal.** Spec says the cure
   "removes plague *and* Cripple." With a shared flag, curing a permanently
   torture-crippled player (tier 3, from a day lynch) also erases that.
   **Under R1(c) this is now sharply worse than it was under a one-shot
   cure**: protect is nightly, so a Chirurgeon could launder torture damage
   off an ally every other night (rotation lock permitting), permanently
   defeating the Tiered Lynch. **Recommendation, and now close to mandatory:
   the cure clears plague and any plague-set tier-1 cripple, but never clears
   torture damage.** Simplest safe test is
   `cripple_tier === 1 && tier1_until_round != null`; if that proves
   ambiguous against day-phase torture, add an explicit origin column.

### R3 — "Black" is a zone, not the number 20

Spec hardcodes drift 20. `zones` in `drift.json` puts black at `min: 20, max:
20`, but `hr_games.max_drift` is **per-game configurable** (`start()` and
`configure()` both accept `maxDrift`) and `changeDrift` clamps to it
(`heresyGameManager.js:1063`). On a table configured with `maxDrift < 20`,
black is unreachable and the Cripple roll would **never fire** — the role
silently does nothing.

**Recommendation:** test `driftZone(this.config.drift, p.drift).id === 'black'`,
never `drift === 20`. Optionally warn at lobby if `maxDrift < 20` with a
Poxwalker in the roster.

### R4 — The zone-crossing cue already exists and will double up

`changeDrift` already sends a private zone-crossing message on every zone
change (`heresyGameManager.js:1063` → `this.privateSystem(c, p,
this.hints(c)[to], {intelKind:'drift_hint', ownZone:to})`). Plague drift goes
through `changeDrift`, so an infected player crossing into Orange gets the
**generic** hint automatically. Adding the spec's plague cue on top means two
private messages for one crossing — and the plague cue is strictly more
informative, which tells the player they are infected the moment the pair
appears.

Options: **(a)** replace the generic hint with the plague cue when the player
is infected (recommended — one message, same channel, no tell from message
*count*); **(b)** send both; **(c)** drop the plague cue.

**Recommendation: (a).** Note the spec explicitly wants Patient Zero and
visitors to be indistinguishable — (a) preserves that; message-count
differences under (b) would not. Whichever is chosen, the message **must keep
`meta: {intelKind:'drift_hint', ownZone: to}`** — the client's Warp-taint
gauge is derived from that meta key (`GameView.vue:320-325`), so a cue sent
without it silently freezes the gauge for exactly the players who are
infected.

---

## 3. Corrections to the dispatch (no ruling needed)

| # | Dispatch says | Actual |
|---|---|---|
| C1 | `poxwalker_max_per_game: 1` in `hardRules`, "same shape as `recruiter_max_per_game`, `saboteur_max_per_game`, `animus_max_per_game`" | **None of those keys exist.** Uniqueness is already enforced generically by **H2** in `validators/composition.js:39-49` — every non-citizen role is unique per game. A Poxwalker max rule is **redundant; build nothing.** |
| C2 | "Validator rule H7" | Name collision. In the design docs `H7` means *Heretic role #7*. In the engine `H1–H5` are validator **hard rules** and `S1–S6` are soft rules (`validators/composition.js`). There is no engine rule H7 and adding one under that name will confuse both. |
| C3 | Role JSON uses `actionKind`, `actionFrequency`, `minPlayerCount`, `maxPerGame`, `tier: 3`, `driftWeight` on a flat object | Real shape is `{id, displayName, faction, driftWeight, tier: "T3", actions: {night: {kind, target, driftCost}, day: null}, crippleProfile, abilityTemplate, objective}`. `tier` is a **string**. `minPlayerCount`/`maxPerGame` are not role fields — thresholds live in `composition.json` → `hardRules`. |
| C4 | `data/composition.json` | `game_data/composition.json`. `data/` is runtime SQLite only (`AGENTS.md`). |
| C5 | State field names `poxwalkerSourceOf` / `poxwalkerVisited` / `poxwalkerBlackCrippleRoll` (dispatch) vs `poxwalkerInfectedBy` / `poxwalkerVisitedBy` / `poxwalkerCrippleRoll` (spec §Coder notes) | The two documents disagree with each other. Neither matters much — engine state is SQLite columns in `snake_case`, not JS objects. See §4.2 for the actual columns. |
| C6 | `const roll = Math.random() < 0.5` | Must be `this.random()`. The manager takes an injectable RNG so tests and the sim can seed it. `Math.random()` would make the roll untestable and unreproducible. |
| C7 | "Extend the existing `resolveNight` loop to add the visitor check before the per-player drift resolve" | Plague drift must be applied **after** the action passes, not before — spec says visitor drift is *"on top of their own action's normal drift cost"* and Black is evaluated *"after applying drift at night-end."* See §4.3 for placement. |
| C8 | `crippleProfile` will gate the Poxwalker's re-infect | `crippleProfile` is **descriptive metadata the engine never reads** (`roles-40k.json:8`, and the comment above `submitAction`). Cripple is one blanket rule in `submitAction` that already blocks everything except protect/bodyguard/drift-hint — so a crippled Poxwalker is already blocked for free. Fill the field in for consistency, but do not wire it. |

---

## 4. Implementation

### 4.1 Role registration — `game_data/roles-40k.json`

```json
{
  "id": "poxwalker",
  "displayName": "Poxwalker",
  "faction": "heretic",
  "driftWeight": 3,
  "tier": "T3",
  "infectLimit": "1_per_game",
  "actions": {
    "night": { "kind": "infect", "target": "hostile", "driftCost": 3 },
    "day": null
  },
  "crippleProfile": { "blocks": ["infect"], "onCripple": "disable-one" },
  "abilityTemplate": "…",
  "objective": "…"
}
```

- `target: "hostile"` reuses the existing `isHostileTo` check in
  `submitAction`, which covers the spec's "non-Heretic, not self" rules with
  no new code (this is exactly how Animus's faction-lock works).
- `infectLimit` mirrors `killLimit` / `possessLimit` and is enforced via
  `this.usage(c, p, 'infect')`, same as Animus at `submitAction`.
- No `claim` field — the Heretic roles that claim Citizen omit it entirely
  (see murderer, saboteur, animus). The dispatch's `"claim":
  "imperial-citizen"` would be the only heretic with one.
- `gameConfig.js:17-27` normalises some action kinds (`watch`→`drift-hint`,
  `shield`→`bodyguard`, `booby-trap`→`boobytrap`). `infect` needs no mapping —
  keep the JSON and engine names identical.

### 4.2 State — SQLite columns, added via `ensureColumn`

Migrations go in the constructor alongside the existing block at
`heresyGameManager.js:181-262`. Additive `ALTER TABLE` only; `ensureColumn` is
idempotent and safe against the live DB.

| Table | Column | Type | Meaning |
|---|---|---|---|
| `hr_games` | `patient_zero` | `TEXT` | player_code, or NULL |
| `hr_games` | `infection_round` | `INTEGER` | round the infect landed |
| `hr_players` | `plague_source` | `INTEGER NOT NULL DEFAULT 0` | 1 = Patient Zero |
| `hr_players` | `plague_carrier` | `INTEGER NOT NULL DEFAULT 0` | 1 = infected visitor |

Deliberately **not** stored: `activePoxwalker` (derivable — the roster's
poxwalker), `sourceGone` (derivable — `patient_zero` set but that player is
dead), `infectedVisitors` array (SQL has no array type; the per-player flag is
the normalised form), `poxwalkerCrippleRoll` (a transient value inside one
resolve pass, not state).

### 4.3 Night resolution — `resolveNight`, `heresyGameManager.js:731`

Current pass order: generic per-action drift charge (`:737`) → protect
(`:738`) → bodyguard (`:739`) → sermons (`:740`) → intel + Execute on Sight
(`:747`) → catalyst (`:748`) → kills (`:754`) → blood ritual (`:782`) →
possess (`:807`) → proximity siphon (`:808`) → `reportNightActions` (`:809`)
→ win check / phase flip (`:810`).

Three insertions:

**(i) `infect` resolution — a new pass, placed with the other target-setting
passes (after sermons, before kills).** Sets `patient_zero`,
`infection_round`, `plague_source = 1`, and burns `usage('infect')`.
The +3 self-drift is charged **automatically** by the generic loop at `:737`
(any kind not in its exclusion list pays `role.driftWeight`) — do **not** add a
second charge, and do **not** add `infect` to that exclusion list.

**(ii) Plague drift — a new pass placed immediately before `applyProximitySiphon`
(`:808`).** This is after every action has resolved and after all
action-cost drift is charged, satisfying "on top of their own action's normal
drift cost."

```
if patient_zero is set:
  visitors  = actions this round whose target_code === patient_zero, actor alive, actor not the PZ
  visitedBy = the PZ's own action row's target_code (if any, alive)
  mark each of those players plague_carrier = 1
if PZ alive: changeDrift(PZ, +2, 'plague-source')
for each living plague_carrier: changeDrift(carrier, +1, 'plague-carrier')
```

Note the marking is **cumulative** — once a player visits Patient Zero they
carry the plague for the rest of the game (spec: persistent, carriers continue
after the source dies), so `plague_carrier` is set once and never cleared
except by cure/death/flip.

**(iii) Black-zone Cripple roll — immediately after (ii), same pass.**
For every living player with `plague_source` or `plague_carrier` whose zone is
`black`: `this.random() < 0.5` → `cripple_tier = max(existing, 1)`,
`tier1_until_round = g.round + 1` when the result is 1 (see R2 and the
`:786-793` comment for why `+1` and not `g.round`).

**Ordering caveat to state explicitly:** a sleeping infected player gets
`NIGHTLY_SLEEP_RECOVERY` (−1) in the generic loop at `:737` and then the
plague drift in (ii). Net for a sleeping Patient Zero is **+1/night, not
+2**. The spec does not address this. Recommend accepting it (sleep is
already the engine's universal drift brake) but flag it to the designer — it
roughly halves the climb rate for a passive Patient Zero and directly affects
the "≈10 nights to Black" number in the dispatch's sim-validation table.

### 4.4 Submission — `submitAction`, `heresyGameManager.js:1012`

Free from existing generic checks: alive target, `hostile` faction lock,
crippled-actor block, one-action-per-round slot.

Needs adding, mirroring the Animus `possessLimit` line:

- `if (action.kind === 'infect' && role.infectLimit && this.usage(c, p, 'infect') >= 1) throw new Error('The plague is already loosed — one infection per game')`
- reject if `patient_zero` is already set and that player is alive (spec: no
  re-target while Patient Zero lives)

Charge the +3 at **resolution**, not submission. Animus is the engine's only
charge-at-submission action and it needed a special exclusion at `:737` to
avoid a double charge; `infect` should stay on the default path.

Also extend the Heretic-faction cabal-chat label built in `submitAction`
(the `cabalLabel` ternary chain) with an `infect` case, so the cabal sees
"Cabalite X looses the plague on Y" like every other Heretic action.

### 4.5 Cure — inside the existing protect pass (R1(c))

No new action kind. Extend the protect pass at `heresyGameManager.js:738`:

```
for (a of actions where kind==='protect') {
  if (trapBlocks(...)) continue;          // unchanged — a trapped protect cures nothing
  protectedIds.add(a.target_code);        // unchanged
  clearPlagueOn(c, g, a.target_code);     // new
}
```

`clearPlagueOn(c, g, code)`:
- if `code === g.patient_zero` → clear `patient_zero`, `infection_round`,
  that player's `plague_source`, **and every player's `plague_carrier`**
- else if that player has `plague_carrier` → clear only theirs
- in both cases clear a plague-set cripple per R2 (tier-1-with-expiry only,
  never torture damage)
- **emit nothing** — see R1 consequence 1

Placement matters: the protect pass at `:738` runs *before* the plague pass
added in §4.3(ii), so a protect landing tonight prevents tonight's plague
drift. That is the right reading of "the cure ends the source," and it is
also the only ordering that lets a Chirurgeon race a Patient Zero to Black.

Everything else is free: no `usage()` limit (nightly per R1(c)), no new
validation (protect's existing target rules stand), no client change.

### 4.6 Death, lynch and flip hooks

Deaths are written in several places (`:747` execute-on-sight, `:757` murder,
`:785` blood ritual, plus `applyLynch` in the day path). Rather than patching
each, add one helper — `clearPlagueOn(c, playerCode)` — and call it from a
single place: the plague pass in §4.3 already skips dead players, so the only
*required* hook is **Patient Zero's death must stop new infections while
leaving existing carriers climbing**. That falls out for free if the pass
reads "if PZ alive → charge PZ and recompute visitors; carriers always
climb regardless." No per-death-site patching needed.

The one genuine hook is the **Recruiter flip** at `:748` (`heretical-catalyst`
sets `faction = 'heretic'`): per spec E6/E7, clear the target's plague flags
(and `patient_zero` if it was them) **before** the flip line runs.

### 4.7 Client, docs, bots, sim

See §7.

---

## 5. Test plan

`heresy-server/test/` is `node --test`, fresh temp SQLite per test.
New file `heresy-server/test/poxwalker.test.js`:

1. Infect submission: rejected on dead / Heretic / self targets; accepted on a
   living Loyalist; second infect rejected.
2. Patient Zero climbs +2 across two nights; Poxwalker paid exactly +3 once.
3. Visitor: an Interrogator scanning Patient Zero pays scan cost **+1**.
4. Visited-by: Patient Zero's own action target picks up +1.
5. Patient Zero dies → carriers keep climbing, no new carriers accrue.
6. Black-zone roll with a seeded RNG: deterministic cripple on `random()=0.4`,
   none on `0.6`; verify it clears at the following day transition and never
   downgrades an existing tier-3.
7. Cure via protect (R1(c)): protecting Patient Zero clears source **and**
   every carrier; protecting a carrier clears only that one; a *trapped*
   protect cures nothing; the Chirurgeon's night report line is byte-identical
   whether or not a plague lifted; **protecting a torture-crippled player does
   not clear their cripple tier** (R2.2 — this is the regression test that
   protects the Tiered Lynch).
8. Recruiter flip on Patient Zero lifts plague first.
9. Leak test in `leaks.test.js` style: no non-infected player's state payload
   ever contains plague fields; the cure ack is identical for infected and
   uninfected targets.

**Baseline:** `316 tests, 316 pass, 0 fail` on `d025e66` (verified). Any
failure after this work is caused by this work.

Fixture idiom to copy (`test/night-action-report.test.js`): `new
HeresyGameManager({databasePath, now: () => 1_000_000, random: () => 0.9})` →
`create()` → `join()`/`ready()` ×N → `start()` → `advance()` → `submitAction()`
→ `resolve(code, true)`. The injectable `random` is what makes the Black-zone
roll testable — see C6.

---

## 6. Sequencing and delegation

| Phase | Work | Who |
|---|---|---|
| 0 | ~~Designer resolves R1~~ ✅ ruled: protect clears the plague. R2–R4 proceed on the recommendations in §2 unless overruled | done |
| 1 | Role JSON entry, glossary entry, `hardRules` rationale note (no new rule per C1), client `compositionData.js` catalogue entry | Haiku — mechanical, pattern-matched off the `animus` entries |
| 2 | Engine: migrations, submit validation, infect pass, plague pass, Black roll, flip hook | Sonnet — judgment, ordering-sensitive |
| 3 | Cure inside the protect pass + `clearPlagueOn` (§4.5) | Sonnet — small, but the R2.2 torture-laundering guard must land with it |
| 4 | Client: one-shot button hiding + cue/`ownZone` wiring (panel itself is free, §7.1) | Sonnet |
| 5 | Tests | Sonnet, then Opus verifies against spec edge cases E1–E14 |
| 6 | Manual page `site/roles/poxwalker.md`, sidebar + icon in `site/.vitepress/config.mjs`, `docs/ROSTER.md` | Haiku — mechanical |
| 7 | Bot-manager: 3 catalogue entries (§7.3) | Haiku — mechanical, but all three or none |
| 8 | Sim heretic heuristic (only needed before the §8 sim-validation pass) | Sonnet |

**Reference commit:** `e8be3cd` (Animus, H6) is the exact template — 18 files
across the same layers. Read it before starting phase 2. Its follow-ups
`b4e6e3c` and `37edc4b` show what got *missed* the first time (manual page,
client role catalogue) — those are the easy ones to forget.

---

## 7. Non-engine surface

### 7.1 Client — much less work than the dispatch assumes

The night action panel (`GameView.vue:181-202`) is **fully data-driven off
`role.actions.night.kind`** — there is no per-role `v-if`. Targets come from
`actionTargets`, filtered by `nightAction.target` (`GameView.vue:290`);
submission is the generic `act(targetCode)` → `action:submit`
(`GameView.vue:348` → `App.vue:227`).

**A plain single-target `infect` therefore needs zero template changes.** The
dispatch's "Infect [target name] button in night action panel" already exists
the moment the role JSON entry does. The only `kind`-specific branches in the
whole template are Blood Ritual, Forgery, and the protect/bodyguard rotation
lock — none of which `infect` touches.

Hiding the button after the one-shot is spent is the one real client task
(Animus has the same problem; check how `possessLimit` is surfaced before
inventing something).

**Cost preview**: `roleAbilityForLobby` (`compositionData.js:133`) renders
"+N drift" from `abilityTemplate` placeholders. This is fed by the
**hand-maintained `validRoles` Map at `compositionData.js:22-91` — a duplicate
of `roles-40k.json` that is not generated.** Commit `b4e6e3c` exists precisely
because Sanctioned Psyker was missing from it for months and could not be
picked in custom rosters. **Add the Poxwalker entry here or the role is
invisible in the lobby.**

**Zone gauge caveat for R4:** `GameView.vue:320-325` derives the player's
"Warp taint" gauge by scanning private messages for the last
`meta.ownZone`. If R4(a) replaces the generic hint text with a plague cue, the
replacement **must keep `meta: {intelKind:'drift_hint', ownZone: to}`** or the
gauge silently stops updating for infected players.

`PlayerDossier.vue` has no role-specific branching — nothing to do there.

### 7.2 Sim — works with no changes

`heresy-sim` imports the manager directly. `createHeuristicAgent`
(`heresy-sim/src/agent.js:53-64`) falls back to `createRandomAgent` for any
unrecognised `roleId`, so Poxwalker sims immediately with random legal
targeting. A deliberate heuristic (infect the Priest/Interrogator, then sleep)
is a ~30-line addition to `heresy-sim/src/strategies/heretic.js` plus a map
entry — do it before the sim-validation pass in §8, since random targeting
would not exercise the heal-trap the numbers are meant to test.

### 7.3 Bot manager — **five** hand-maintained catalogues, not three

None derived from `roles-40k.json`; an unknown role degrades silently rather
than erroring, so this is easy to ship broken. The initial survey found three;
checking the Animus precedent commit `e8be3cd` turned up two more that gate the
verb just as hard:

| File | Add | Failure if skipped |
|---|---|---|
| `bot-manager/src/prompts/roleBlocks.js` (`ROLE_BLOCKS`) | a `'poxwalker'` prompt block | `roleBlock()` falls back to "Role template missing" — bot plays blind |
| `bot-manager/src/validator.js` (`ROLES_VERBS`) | `poxwalker: { verbs: ['infect', …] }` + an `infect` branch in `validateNightAction`'s switch | default-reject — bot can never act |
| `bot-manager/src/actionDispatch.js` (`verbToIntent`) | `case 'infect'` → `{engineType:'action'}` | falls to `{engineType:'unknown'}`, payload no-ops |
| `bot-manager/src/llm/parseAction.js` (`ACTION_SCHEMA` verb enum) | `'infect'` | LM Studio runs `response_format: json_schema, strict: true` — the model **cannot emit the verb at all**, a hard schema violation rather than a soft reject |
| `bot-manager/src/prompts/staticRules.js` (`STATIC_RULES` **and** `STATIC_RULES_FULL`) | `"infect"` in the verb literal | the verb list is spelled out verbatim in the instructions every bot receives — the bot never learns the action exists |

`ROLE_BLOCKS_FULL` (rich MiniMax prompts) is populated for Interrogator only;
every other role falls back to the compressed block. Poxwalker does the same —
no work needed there.

### 7.4 Docs

- `site/roles/poxwalker.md` (player manual page)
- `site/.vitepress/config.mjs` — sidebar entry (`:102` area) **and** an inline
  SVG icon (`:21` area). Both are needed; the icon is easy to miss.
- `game_data/glossary.json` — role alias entry (`{id, displayName, aliases}`)
- `docs/ROSTER.md`

### 7.5 Test baseline — memory correction

`npm --prefix heresy-server test` on `d025e66` is **316 tests, 316 pass, 0
fail**. The suite is fully green; the older "4 pre-existing failures" note is
out of date. Any failure after this work is attributable to this work.

---

## 8. Explicitly out of scope for v1.0.0

- **Preset changes.** The dispatch's own checklist leaves the 5p preset swap
  out, and the spec calls it a sim-validation question. Ship Poxwalker as a
  custom-roster role only, exactly as Animus shipped (`composition.json`
  `animus_rationale`: *"soft rule only — NOT yet added to the preset tables"*).
  **Flag for the designer:** the proposed 5p preset `murderer, poxwalker,
  priest, interrogator, chirurgeon` is 2 Heretics / 3 Loyalists. The win check
  is `living heretics >= living loyalists` (`heresyGameManager.js:1064`), so
  **the first Loyalist death ends the game as an instant Heretic win.** That
  preset is not playable as written.
- **Sim validation of the +1 / +2 numbers.** Post-implementation, per dispatch.
- No new socket route — `action:submit` (`index.js:337`) is generic and
  carries `infect` unchanged.

---

## 9. Spec drift to report back

The R1(c) ruling makes the shipped engine diverge from locked spec v1.0.0 in
three places. Per the mirror rule in `docs/specs/roles/poxwalker.md:1-14`,
**do not edit the mirror** — report these to Nicolas so the source spec can be
re-locked at v1.0.1:

| Spec says | Will ship as |
|---|---|
| Cure is a dedicated Chirurgeon action, **one-shot per game** | Cure is the existing nightly **protect**, unlimited (bounded by the rotation lock) |
| Cure costs **+3 self** (T3) | Costs protect's **+1** (T1) |
| Curing Patient Zero is **"full plague termination"** — every downstream carrier's spread ends too | **Ruled 2026-08-04 (designer):** curing the source stops the source and stops new infections, but **every existing carrier keeps carrying it** and must be cured individually. A cure and a death now behave identically. This is what makes the cheaper, unlimited cure above balance out — the Chirurgeon can only ever buy back one player per night. |
| "Poxwalker is the carrier, not the infected — cannot be cured" (heal-priority) | Unchanged, but self-protect means an infected **Chirurgeon** can cure themselves, which the spec does not contemplate |

The heal-priority section of the spec ("healing Patient Zero > healing a
visitor") no longer holds as written either: with no downstream cleanse, curing
the source and curing a carrier each buy back exactly one player. Curing the
source is still better — it stops the +2 and closes off new carriers — but it
is a difference of degree, not the categorical "cure the source or nothing"
the spec describes.

Also worth reporting, independent of R1: the dispatch's §2 validator rule and
its claimed precedents (`recruiter_max_per_game` &c.) do not exist — see C1/C2.

---

## 10. Build notes (2026-08-03)

**Shipped.** Server suite 331/331 (was 316 — 15 new Poxwalker tests), verified
green across repeated full runs. Bot-manager 261/261. Client `vite build` and
VitePress `docs:build` both clean.

R4 shipped as option (a): `changeDrift` swaps in the plague cue for an infected
player *instead of* the ordinary zone hint, keeping one crossing to one message
and preserving the `ownZone` meta the client gauge reads. Cue text lives in
`game_data/scenarios/default/plagueHints.json`, not in the engine.

### Two things found during the build

**The Poxwalker was catching their own plague.** The visit scan reads this
round's `hr_actions` rows for anything targeting Patient Zero — and the
`infect` row itself targets Patient Zero, so the Poxwalker was marked a carrier
the instant they cast. Spec is explicit that the Poxwalker is the carrier, not
the infected; `resolvePlague` now skips `kind === 'infect'` in the scan.

**A pre-existing flaky test, not caused by this work.** `game.test.js`'s "H1:
gate fires before interrupts are evaluated" picks an arbitrary Loyalist as its
target and asserts an exact drift of 1. When that draw lands on the Imperial
Citizen seated next to the drift-charging Chirurgeon, the Conclave Proximity
Siphon adds a second point and the assertion fails. Reproduced on **clean
master** at ~10% (4/40 runs), which is why the suite looked green on casual
runs. The test now excludes the Citizen from its target draw.

### Silent carriers — WORKING AS INTENDED (ruled 2026-08-04)

A carrier who sleeps every night never learns they are infected, and this is
deliberate. Do not "fix" it.

The carrier tick (+1) exactly cancels `NIGHTLY_SLEEP_RECOVERY` (−1), so a
passive carrier holds drift level indefinitely. Cues fire on zone *crossings*,
so a player in that stasis crosses nothing and is told nothing — verified over
six consecutive nights, drift pinned at 3 the whole way. The plague's only
effect on them is the denial of sleep recovery, which is invisible.

The locked spec's cue model assumed carriers visibly climb; it did not account
for sleep recovery. Ruling: **if the plague is not pushing a player, they get
no message.** The alternative — a concrete cue fired on infection — was
rejected because a visitor knows exactly who they targeted that night, so it
would identify Patient Zero with certainty on first touch and reduce the whole
mechanic to quarantine.

Revisit only if playtests show carriers never noticing at all. The two levers
are a randomised 1–2 night delayed cue, or suppressing sleep recovery for the
infected so they climb for real.

### Not done

- **E2E (`npm run test:e2e`) was not run.** Playwright's config sets
  `reuseExistingServer: !CI`, and the Docker stack currently holds
  `127.0.0.1:4100` with a pre-Poxwalker image — the suite would have silently
  tested the old server and reported a meaningless pass. Rebuild the stack
  (`docker compose -f docker-compose.manual.yml up -d --build --force-recreate`)
  or stop it, then run e2e.
- **Sim heuristic** (§6 phase 8). Poxwalker sims today via `agent.js`'s
  random-agent fallback, which will not exercise the heal-trap the flagged
  numbers are meant to test. Needed before the §8 sim-validation pass, not
  before play.
- **Preset integration** — unchanged and still out of scope; see §8, including
  why the proposed 5p preset is unplayable as written.
