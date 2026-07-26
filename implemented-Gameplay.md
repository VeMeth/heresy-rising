# Implemented Gameplay - Heresy Rising v1

This document is a comprehensive inventory of all game functions, mechanics, roles, and abilities that are implemented in the Heresy Rising codebase as of 2026-07-26.

## Game Phases & Structure

### Lobby Phase
- Room code generation (6-character codes)
- Player joining (5-12 player range)
- Role assignment via random shuffle
- Generic composition display (no role names revealed in lobby)
- Host designation

### Night Phase
- Player submission of night actions
- Action resolution (kill, protect, interrogate, sermon, trap, etc.)
- Drift calculation and application
- Possession checks and detonations
- Phase transitions

### Day Phase
- Voting phase (Round 1 is always skip, rounds 2+ allow votes)
- Vote counting and outcome determination based on thresholds:
  - ≥60% of living players = Lynch
  - <60% but plurality = Interrogation (Orange border)
  - No majority = Skip
- Interrogation response phase (Tier 3 confessions)
- Drift application based on outcomes
- Heretic cap application after day resolution

### End Conditions
- Loyalist win: Heretic living count < Loyalist living count (or all Heretics dead)
- Heretic win: Heretic living count ≥ Loyalist living count
- Game end announcement and stat logging

## Core Mechanics

### Drift System
**Drift is tracked per player from 0-20 and determines corruption level**

- **Drift Zones:**
  - Green (0-4): Clean
  - Yellow (5-9): Uneasiness
  - Orange (10-14): Chill/doubt
  - Red (15-19): Whisper/hunger
  - Black (20): Warp takes you (conversion possible)

- **Drift Triggers (sources):**
  - Sleep: −1 drift (passive)
  - Wrong lynch: +2 drift (voters on losing side)
  - Witnessed violence: +1 drift (all living players after a kill)
  - High-power night action: varies by role/tier (T1=+1, T2=+2, T3=+3)
  - Voted with losing side: +1 drift (minority voters)
  - Resist interrogation confession: +1 drift
  - Refuse to break under Tier 3: +2 drift
  - Day interrogation (wrong target - Loyalist): +1 drift to voters
  - Day interrogation (correct target - Heretic): −1 drift to all living

- **Drift Noise:**
  - Interrogator T1 reads apply noise to drift zone detection
  - Noise increases with reader's own drift zone
  - Yellow zone: 10-20% noise (varies by tier)
  - Orange zone: 40% noise (T2+)
  - Red zone: 40-80% noise (varies by tier)
  - Black zone: 50-90% noise (varies by tier)

### Crippling/Interrogation System
**Tracks interrogation marks on players**

- **Cripple Tiers:**
  - Tier 1: Double action cost next round, auto-recovers by next day
  - Tier 2: Permanently lose a night-action slot
  - Tier 3: Must publicly confess role on direct ask

- **Interrogation Mark Persistence:**
  - First interrogation lands the mark (sets `interrogated_before=1`)
  - Mark persists across all subsequent days
  - Second interrogation on same target = automatic execution (regardless of vote % or days passed)
  - Mark can only be cleared by Interrogator spending T1 scan on Green-zone Loyalists
  - Red-zone reads double the mark (next interrogation is execution)

- **Cripple Blocking:**
  - Various role actions can be blocked by cripple tier
  - Examples: vote is blocked on all roles, specific actions blocked per role

### Interrogator Scan System
**Loyalist investigative power with escalating intensity**

- **T1 (Soft) - +1 drift:**
  - Binary result: "Tainted (Yellow+)" or "Clean (Green)"
  - Inherent noise: 70% true, 30% flipped
  - Against Orange+ target: does NOT auto-kill (chosen intensity matters)

- **T2 (Standard) - +2 drift:**
  - Zone result: Green / Yellow / Orange / Red / Black
  - Against Orange+ target: Execute on Sight (auto-kill)

- **T3 (Brutal) - +3 drift:**
  - Confirmed faction identity
  - Against Orange+ target: Execute on Sight (auto-kill)

- **Interrogator can clear marks:**
  - Only works on Green-zone reads
  - Public action (cabal sees it)
  - Cannot clear Yellow+ reads
  - Red reads double the mark instead

### Possession System (Animus)
**One-shot speculative possession mechanic**

- **Mechanics:**
  - Animus can target one player per game
  - Must speculate target is in Red drift (15-19)
  - Costs +3 self-drift immediately (win or lose)
  - If confirmed Red at night-end: target is possessed
  - Possessed player: writes day chat, vote suppressed, night action skipped
  - At day-end (after vote tally): target detonates (dies, full role/faction/drift revealed)
  - Wrong guess: wastes silently, no confirmation feedback

- **Possession Revealed:**
  - `possessed_by` field tracks which Animus possesses which player
  - `possession_revealed` flag tracks detonation status
  - Only cleared at day-end detonation or player death

### Sermon System
**Drift manipulation via Priest and Heretic Priest roles**

**Loyalist Priest (drains drift):**
- Whisper: −2 drift on target, +1 self-cost, unlimited daily
- Hymn: −5 drift on target, +3 self-cost, 2 per game
- Litany: −10 drift on target (floored at 0), +6 self-cost, 1 per game

**Heretic Priest (feeds drift):**
- False Comfort: +3 drift on target, +2 self-cost, looks like Whisper to target
- Twisted Hymn: +7 drift on target, +2 self-cost, target feels "strengthened in faith"
- Warp Litany: +12 drift on target, +4 self-cost, appears as transcendent sermon

### Protection System
**Chirurgeon and Arbitrator defenses against night kills**

- **Chirurgeon (protect):**
  - Silently blocks night strike on target (kill or cripple)
  - Rotation rule: cannot target same player 2 consecutive nights (incl. self)
  - No feedback if protection fires
  - Blocks: kills, cripples, boobytrap, possession, heretical catalyst

- **Arbitrator (bodyguard):**
  - Sacrificial defense: dies in target's place on strike
  - Both Arbitrator and protected player learn protection fired
  - Bodyguard proxy proxy status tracked

- **Saboteur trap:**
  - Can trap protected targets
  - Trapping prevented by successful protection
  - Trap blocks actual action but doesn't prevent drift cost

### Blood Ritual (Shared Heretic Action)
**Faction-wide attack available to any living Heretic**

- **Mechanics:**
  - One per night, faction-wide (first submission wins)
  - First hit: cripples target (+3 drift cost to attacker)
  - Second hit (same target, next night): kills target (+3 drift cost), target dies with alignment revealed
  - Escalation resets if different target or night skipped
  - Any Heretic can carry it (including Murderer giving up own kill)

- **Counterplay:**
  - Chirurgeon protect: silent block
  - Arbitrator proxy: Arbitrator dies instead
  - Saboteur trap: attacker takes +5 extra drift (+8 total)

## Role System

### Loyalist Roles (7 total)

#### 1. Imperial Citizen
- **Tier:** T0
- **Action:** Sleep (automatic, −1 drift per night)
- **Claim:** Yes (self-claim available)
- **Ability:** No night power; pure voter
- **Cripple blocks:** Vote (blocks voting in day phase)
- **Notes:** Fill role, can appear multiple times per game

#### 2. Interrogator
- **Tier:** T2
- **Action (night):** Investigate at chosen intensity (T1/T2/T3)
- **Drift cost:** +1 (T1), +2 (T2), +3 (T3)
- **Claim:** Yes
- **Ability:** 
  - T1: Binary "Tainted/Clean" with noise
  - T2: Zone read
  - T3: Confirmed faction
  - T2+ on Orange+ target = Execute on Sight
  - Can clear interrogation marks on Green Loyalists (public action)
- **Cripple blocks:** Investigate
- **Notes:** Primary Loyalist investigator; drift zone upgrades effective intensity

#### 3. Chirurgeon
- **Tier:** T1
- **Action (night):** Protect one player
- **Drift cost:** +1
- **Claim:** Yes
- **Ability:** Silently blocks night strikes on target; rotation rule (no same target 2 nights)
- **Cripple blocks:** Protect
- **Notes:** Silent defense, no feedback on success

#### 4. Arbitrator
- **Tier:** T1
- **Action (night):** Bodyguard (sacrificial proxy) one player
- **Drift cost:** +1
- **Claim:** Yes
- **Ability:** Dies in target's place on strike; both learn proxy fired
- **Cripple blocks:** Bodyguard
- **Notes:** Marked as "worth attacking" after use

#### 5. Novice-Psychic
- **Tier:** T1
- **Action (night):** Watch one other player
- **Drift cost:** +1
- **Claim:** Yes
- **Ability:** Receives qualitative drift hint about target (zone-based, carries noise)
- **Cripple blocks:** Watch
- **Notes:** Cannot catch Heretics who haven't drifted yet; T1 = half zone rate noise

#### 6. Priest
- **Tier:** T0 (special)
- **Action (night):** Sermon with three tiers
- **Ability:**
  - Whisper: −2 target drift, +1 self-cost, unlimited daily
  - Hymn: −5 target drift, +3 self-cost, 2 per game
  - Litany: −10 target drift (floored), +6 self-cost, 1 per game
- **Cripple blocks:** All sermon actions (disable-all)
- **Notes:** Zero claim; drifts self while protecting others

#### 7. Sanctioned Psyker
- **Tier:** T2
- **Action (night):** One-shot kill (once per game)
- **Drift cost:** +15 (lands Psyker at Red, 15-19)
- **Claim:** None (looks identical to Murderer from table)
- **Ability:** One warp-kill per game; lands Psyker in Red zone; crippled Psyker cannot fire
- **Cripple blocks:** Kill
- **Notes:** T2+ Interrogator scan on Red Psyker = Execute on Sight; unique per game; ships at 7+p

### Heretic Roles (6 unique + 1 shared action)

#### 1. Murderer
- **Tier:** T3
- **Action (night):** Kill (one per night)
- **Drift cost:** +15 (gated against MAX_DRIFT, fails silently if would exceed 20)
- **Claim:** None
- **Ability:** Traditional hidden killer; drift-gated kill (must drop below 20 to fire next)
- **Cripple blocks:** Kill
- **Notes:** Full Heretic chat access; sees other Heretics' plans; unique per game

#### 2. Heretic Priest
- **Tier:** T0 (special)
- **Action (night):** Sermon with three tiers
- **Ability:**
  - False Comfort: +3 target drift, +2 self-cost, looks like Whisper to target
  - Twisted Hymn: +7 target drift, +2 self-cost, target feels "strengthened"
  - Warp Litany: +12 target drift, +4 self-cost, appears transcendent
- **Cripple blocks:** All sermon actions (disable-all)
- **Notes:** Hidden as Priest slot; drift-disguised as Loyalist Priest; unique per game

#### 3. Conspirator
- **Tier:** T1
- **Action (day):** Forgery (once per day)
- **Drift cost:** +1
- **Claim:** None
- **Ability:** Post message in day chat attributed to different player; forged sender must decide to correct or lie
- **Cripple blocks:** Forgery
- **Notes:** Heretic chat access; unique per game

#### 4. Saboteur
- **Tier:** T2
- **Action (night):** Booby-trap one player (once per night)
- **Drift cost:** +2
- **Claim:** None
- **Ability:** Any night action on trapped player: actor takes +5 extra drift, action fails/no result, Saboteur gets notification
- **Cripple blocks:** Booby-trap
- **Notes:** Silent detection (trapped player unaware); Heretic chat access; unique per game

#### 5. Recruiter
- **Tier:** T3
- **Action (night):** Heretical Catalyst (once per night, requires target at Black drift)
- **Drift cost:** +3
- **Claim:** None
- **Ability:** Target at Black zone (20 drift) flips to Heretic (silent, immediate); fails silently if not Black
- **Special:** If Saboteur trapped target: flip resolves but +5 extra drift to Recruiter (+8 total)
- **Cripple blocks:** Heretical catalyst
- **Notes:** Heretic chat access; unique per game; ships at 10+p

#### 6. Animus
- **Tier:** T3
- **Action (night):** Possess (one per game, speculative)
- **Drift cost:** +3 (paid immediately, win or lose)
- **Claim:** None
- **Ability:** Speculate target is Red (15-19); if confirmed at night-end, possess target (silent their vote, skip night action, control day chat); day-end detonation reveals all role/faction/drift info
- **Cripple blocks:** Possess
- **Notes:** Heretic chat access; guessing wrong wastes silently; unique per game; ships at 8+p recommended (custom roster only)

#### 7. Blood Ritual (Shared Heretic Action)
- **Action (night):** Attack (one per night, faction-wide)
- **Drift cost:** +3
- **Ability:**
  - First hit on target: cripples (+3 drift to attacker)
  - Second hit on same target (consecutive night): kills (+3 drift to attacker)
  - Escalation resets with different target or skipped night
  - Any Heretic can carry (Murderer can use instead of own kill)
- **Notes:** Heretic chat determines who carries; faction-wide (not individual slot)

## Game Configuration & Composition

### Player Count & Role Distribution
- **5 players:** 1 Heretic / 3 Loyalists + 1 Citizen
- **6-9 players:** 2-3 Heretics / 5-6 Loyalists
  - Heretic Priest joins at 6p
  - Novice-Psychic joins at 6p
  - Saboteur joins at 8p
  - Sanctioned Psyker joins at 7p
- **10-11 players:** 4-5 Heretics / 5-6 Loyalists
  - Recruiter joins at 10p
  - Conspirator joins at 11p
- **12 players:** 5 Heretics / 6 Loyalists + 2 Citizens

### Fallback Priority (for compositions)
1. Sanctioned Psyker
2. Priest
3. Interrogator
4. Chirurgeon
5. Novice-Psychic
6. Arbitrator
7. Murderer
8. Heretic Priest
9. Saboteur
10. Recruiter
11. Conspirator

## Database Schema & Tracking

### Game Row Tracking
- Game code, host code, mode (sync/async)
- Phase, day_stage, status, round
- Deadline (for phase transitions)
- Day/Night duration settings (day_ms, night_ms)
- Max drift ceiling
- Hint profile
- Last interrogated target & tier
- Winner
- Timestamps

### Player Row Tracking
- Game code, player code, name, seat
- Role ID, faction (assigned at game start)
- Drift (0-20)
- Alive status
- Ready status
- Connected status
- Cripple tier (0-3)
- Tier 1 until round (for auto-recovery)
- Confessed status & token round
- Skip next night flag
- Bot flag
- Possessed by (Animus possession)
- Possession revealed (detonation flag)
- Interrogated before (mark persistence)

### Action Row Tracking
- Game code, round, actor code
- Action kind (sleep, kill, protect, shield, investigate, sermon, etc.)
- Target code, variant (for sermon tiers, interrogator tiers)
- Action data (JSON for complex payloads)
- Created timestamp

### Vote Row Tracking
- Game code, round, stage (day voting)
- Voter code, choice (who they voted for)
- Created timestamp

### Message Tracking
- Game code, channel (private, day, night, cabal)
- Recipient code (for private messages)
- Author name, body, kind
- Meta (JSON for additional info)

### Usage Tracking
- Game code, player code, ability
- Usage count per ability

### Event Tracking
- Game code, event type
- Event payload (JSON)

## Game Modes

### Sync Mode (Real-time)
- Day: 5 minutes (300,000ms default)
- Night: 2 minutes (120,000ms default)

### Async Mode (Extended)
- Day: 24 hours (86,400,000ms default)
- Night: 12 hours (43,200,000ms default)

### Configurable Phase Times
- Floor start: 10 seconds minimum
- Floor configure: 60 seconds minimum
- Ceiling: 24 hours maximum

## Drift-Related Constants & Formulas

### Drift Gains/Losses
- Sleep: −1
- Wrong lynch: +2 (voters on losing side)
- Witnessed violence: +1 (all living after kill)
- Voted minority: +1 (voters on losing side)
- Resist interrogation: +1
- Refuse Tier 3 break: +2
- Day interrogation (wrong Loyalist): +1 to voters
- Day interrogation (correct Heretic): −1 to all living

### Drift Gates
- Murderer kill: gated at MAX_DRIFT (20), fails silently if would exceed
- Recruiter catalyst: requires target at exactly 20 (Black zone)
- Sanctioned Psyker kill: lands user at 15-19 (Red zone)

### Drift Noise Levels (by zone)
- Green: 0% noise
- Yellow: 10-40% noise (varies by interrogator tier)
- Orange: 20-60% noise (varies by interrogator tier)
- Red: 40-80% noise (varies by interrogator tier)
- Black: 50-90% noise (varies by interrogator tier)

## Interrogation Mechanics

### Interrogation Thresholds
- Lynch: ≥60% of living players
- Interrogation: <60% but plurality
- Skip: no majority or explicit stand-down vote

### Interrogation Mark System
- First interrogation: sets `interrogated_before` flag on player
- Mark persists forever (until death)
- Second interrogation on marked player: execution regardless of vote %
- Red-zone reads double the mark (next interrogation = execution)
- T1 clear: can clear mark on Green-zone Loyalists (public)
- Yellow+ reads: cannot clear (read unreliable)

### Tier 3 Confession Mechanics
- Triggered when interrogation reaches Tier 3
- Crippled player asked: "Do you confess?"
- Options:
  - Confess: public role reveal, skip next night
  - Resist: +1 drift, await interrogation response phase
  - Refuse to break: +2 drift, cripple tier raised to at least 2, skip next night

## Chat Channels

### Day Chat
- All players participate
- Voting happens in day chat
- Public discussion
- Conspirator forgery messages appear here

### Night Chat (Heretic-only)
- Only living Heretics see this
- Cabal coordination
- Blood Ritual voting
- Action plan discussion

### Private Messages
- One-on-one player messages
- System messages (private alerts for actions)

### System Messages (Public)
- Phase announcements
- Vote outcomes
- Drift zone transitions
- Possession detonations
- Action results (deaths, confessions, etc.)

## Notable Locked Specifications

### Tiered Lynch v1.3.0
- Interrogation mark persists across game
- No cabal pivot defense (no reset on wrong target)
- Interrogator T1 scan can clear marks on Green Loyalists only
- Second interrogation on marked target = execution

### Day-Phase Spec (locked 2026-07-05)
- Four canonical drift triggers
- Vote thresholds: 60% = lynch, <60% plurality = interrogate
- Round 1 always skips (no voting)
- Vote-with-losing-side drift penalty applies

### Loyalist Kit (v1.2.0)
- Interrogator T1-T3 intensity system
- Zone-upgrade mechanic (target zone affects effective tier)
- Execute on Sight at Orange+
- Noise table for accuracy

### Heresy-Rising-Composition (5-12 player deterministic rosters)
- Fallback priority for role slot filling
- Hard rules for role parity
- Citizens fill remainder slots

## Conclusion

This document represents all implemented game mechanics as of the current codebase state. Roles, abilities, and mechanics are locked per the specifications referenced in the configuration files and spec documents.

