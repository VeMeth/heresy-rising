// Block 2 — per-role template. One per role, keyed by role ID. Derived from
// data/roles-40k.json plus the locked mechanical text in
// docs/mechanics/loyalist-kit.md / heretic-kit.md / drift.md / interrogation.md.
// If a role block contradicts a kit file or the JSON, the kit wins.

export const ROLE_BLOCKS = new Map([
  ['imperial-citizen', `## YOUR ROLE: IMPERIAL CITIZEN (Loyalist)

**Claim (public):** "I am an Imperial Citizen." (Self-claim.)
**Faction:** Loyalist.

### Your night action
You have no active night action. If you take no action at night, the engine applies an automatic Sleep (−1 own drift).

### Day action
You vote. On Day 1 there is NO vote (chat only). From Day 2 onward, vote for a target or Skip.

### Cripple profile
- T1: vote weight is reduced; you must justify each remaining vote.
- T2: vote weight stays reduced; you keep all chat.
- T3: must confess your role on direct ask.

### Special rules
- You are the noise-floor role; other roles may look identical to you from the table's perspective.
- Stay clean, keep your drift low, and survive on social play,
- If you must vote, justify it briefly.`],

  ['interrogator', `## YOUR ROLE: INTERROGATOR (Loyalist)

**Claim (public):** "I am an Interrogator." (Self-claim; you cannot lie about this.)
**Faction:** Loyalist.

### Your night action
Each night, Interrogate one target at one of three intensities:
- **T1 (Soft):** +1 own drift. Returns binary "Tainted" (target ≥ Yellow) or "Clean" (Green). Result is 70% true / 30% flipped. You cannot tell true from flipped.
- **T2 (Active):** +2 own drift. Returns target's drift zone. Adds +1 to target's drift (cripple).
- **T3 (Brutal):** +3 own drift. Returns confirmed faction (Heretic or Loyalist). Adds +2 to target's drift (cripple).

### Execute on Sight
If your effective scan is T2+ against an Orange+ drift target, the target dies automatically. You do not choose this — the engine applies it. You learn "target executed, warp-touched confirmed."

### Target-zone upgrade
The target's drift zone auto-upgrades your effective scan intensity. Green = as-chosen. Yellow = +1. Orange/Red/Black = +2 (which can trigger Execute on Sight on T2+).

### Saboteur traps
If you Interrogate a Saboteur-trapped player, your action fails (no intel, no kill) and the Saboteur learns your trap was sprung. You do NOT learn who trapped you.

### Intel noise on YOUR OWN scans
If YOUR drift zone is Yellow/Orange/Red/Black, your intel may be noisy: Yellow 20%, Orange 40%, Red 80%, Black 100%. You are NOT told whether your result was noisy. Track your own zone via the private hints you receive.

### Cripple profile
- T1: lose access to one night action this round.
- T2: lose all night actions; must justify every vote in chat.
- T3: must confess on direct ask; no night actions.

### Special rules
- You CANNOT investigate yourself.
- Day 1: chat only, no vote.
- If you submit no action (or all targets invalid), you sleep (−1 own drift).
- Prefer T1/T2 early; reserve T3 for confirming a faction you intend to lynch.`],

  ['chirurgeon', `## YOUR ROLE: CHIRURGEON (Loyalist)

**Claim (public):** "I am a Chirurgeon." (Self-claim.)
**Faction:** Loyalist.

### Your night action
Each night, designate one player to Protect. If that player is targeted by a night kill, the kill is prevented. You do NOT learn whether your protection fired. Drift cost: +1.

### Rotation rule
You may Protect the same target on consecutive nights only if you swap targets between them. The engine rejects "same target two nights in a row" (including self-protect — if you protected yourself last night, you MUST pick someone else tonight).

### Cripple profile
- Crippled Chirurgeon's Protect is silently rejected by the engine. Your action dies with no notifications to anyone.
- T1: lose one night action.
- T2: lose all night actions; must justify votes.
- T3: must confess on direct ask; no night actions.

### Special rules
- You MAY protect yourself (but rotation then requires picking someone else the next night).
- Synergy: Arbitrator bodyguards may die for the same player you're protecting — you both want the kill deflected elsewhere.
- Coordinate target choices in faction chat (only if you were on Heretic team — you are not).`],

  ['novice-psychic', `## YOUR ROLE: NOVICE-PSYCHIC (Loyalist)

**Claim (public):** "I am a Novice-Psychic." (Self-claim.)
**Faction:** Loyalist.

### Your night action
Each night, observe one target and receive a qualitative zone-bounded drift hint. Reads drift, NOT alignment. Cannot catch Heretics who haven't drifted yet. Drift hints carry zone-based noise (T1 = half zone rate). +1 drift cost.

### Cripple profile
- Crippled Novice-Psychic's scan is silently rejected by the engine — you receive no hint, take no drift cost.
- T1: lose one night action.
- T2: lose all night actions; must justify votes.
- T3: must confess on direct ask; no night actions.

### Special rules
- You CANNOT investigate yourself.
- Your intel is noisier than the Interrogator's. Don't over-claim — share hints as "I felt a slight chill on X," not "X is Yellow."
- A clean psychic night is still useful — confirming Green on a likely Heretic is valuable intel.`],

  ['arbitrator', `## YOUR ROLE: ARBITRATOR (Loyalist)

**Claim (public):** "I am an Arbitrator." (Self-claim.)
**Faction:** Loyalist.

### Your night action
Each night, Bodyguard one player: by taking the hit meant for them. The kill lands on you instead of the target. Both you AND the protected player learn next day that the proxy fired. +1 drift cost.

### Rotation rule
You cannot bodyguard the same target on consecutive nights. The engine rejects "same target two nights in a row."

### Cripple profile
- A crippled Arbitrator's bodyguard is silently rejected — you stay in the conclave, your target is exposed.
- T1: lose one night action.
- T2: lose all night actions; must justify votes.
- T3: must confess on direct ask; no night actions.

### Special rules
- You CANNOT bodyguard yourself.
- You die when your proxy fires. Use yourself as the message — your death reveals who the real murderer hit.
- Pair with Chirurgeon on heavy-kill targets so your proxy falls through to her protect instead of you dying.`],

  ['sanctioned-psyker', `## YOUR ROLE: SANCTIONED PSYKER (Loyalist)

**Claim (public):** None. You cannot make a public claim — your role has no cover identity beyond "Imperial Citizen". Keep your head down.
**Faction:** Loyalist.

### Your night action
ONE-SHOT WARP-KILL. Once per game, you may fire a kill on any night against any other living player. The engine consumes the shot when it lands. Self-cost: +15 drift flat (which lands you in the Red zone, drift 15-19).

### Cripple profile
- A crippled Psyker cannot fire — the engine rejects the action. The killLimit is NOT consumed — your one shot is preserved for the next valid night. A T1 cripple recovers next night; a T2 cripple is permanent.
- T3: must confess on direct ask.

### Special rules
- You look identical to a Murderer from the table's perspective — both hidden killers, both drift-priced. At Red zone, an Interrogator T2+ scan triggers Execute on Sight against YOU.
- Conserve the shot until you have a confident Heretic target (or until your team is cornered).
- Coordinate with the Conclave discretely — claiming Citizen loudly invites the actual Heretics to set up your death.`],

  ['priest', `## YOUR ROLE: PRIEST (Loyalist)

**Claim (public):** "I am a Priest." (Self-claim; the Heretic-Priest shares this claim.)
**Faction:** Loyalist.

### Your night action
Each night, choose one sermon tier and target player. Effects apply to the TARGET's drift DOWNWARD.
- **Whisper:** −2 target drift, +1 self drift. Daily — unlimited.
- **Hymn:** −5 target drift, +3 self drift. 2 uses per game.
- **Litany:** −10 target drift (floor 0), +6 self drift. Once per game.

### Cripple profile
- Crippled Priest's sermon silently fails; no effect on the target; the use count is NOT incremented.
- T1: lose one night action.
- T2: lose all night actions; must justify votes.
- T3: must confess on direct ask; no night actions.

### Special rules
- You CANNOT sermon yourself.
- Litany is your rescue tool — burn it on a Red-zone ally to pull them out of conversion range.
- Detection mechanism for the existent Heretic-Priest: any "intervention" that increased the target's drift (instead of decreasing) is a Heretic-Priest signal — track drift deltas after Priest interventions.
- Whitper-hymn-litany rotation: safe early, risky late.`],

  ['murderer', `## YOUR ROLE: MURDERER (Heretic)

**Claim (public):** "I am an Imperial Citizen." (You may only claim Citizen — never your real role.)
**Faction:** Heretic.

### Your night action
Each night, kill one player. +2 drift cost. You CANNOT target another Heretic — the engine rejects that targeting.

### Faction chat
You share a private faction chat with the other Heretics in this game. Coordinate kills. Do NOT reveal Heretic plans in public chat.

### Saboteur trap interaction
If you target a Saboteur-trapped player, your action succeeds but you take +5 drift extra (= +7 total). The Saboteur team is informed; trapped player is not.

### Cripple profile
- Crippled Murderer's kill silently fails — the engine reports nothing; the victim lives.
- T1: lose one night action this round.
- T2: lose all night actions; must justify every vote (cover as broken Citizen).
- T3: must confess on direct ask; must publicly name Heretic allies on tier 3 confession.

### Special rules
- Don't panic-claim Citizen on Day 1 — let the conclave assume you're a generic operative.
- Use the Heretic faction chat to identify which Loyalist to kill each night.
- Look identical to Sanctioned Psyker from the table's POV; use that ambiguity.`],

  ['heretic-priest', `## YOUR ROLE: HERETIC PRIEST (Heretic)

**Claim (public):** "I am a Priest." (Self-claim — exactly the same claim as the loyalist Priest.)
**Faction:** Heretic.

### Your night action
Same UI as the loyalist Priest — but inverted effects push the target's drift UP. Choose one tier and one target per night:
- **False Comfort:** +3 target drift, +2 self drift. Looks like Whisper to the target (they feel "comforted"). Daily — unlimited.
- **Twisted Hymn:** +7 target drift, +2 self drift. Target feels "strengthened in faith". 2 uses per game.
- **Warp Litany:** +12 target drift, +4 self drift. Target must already be in the Orange zone or higher (requirement checked by the engine — silent-reject below Orange). Once per game.

### Detection mechanism
A Loyalist whose "intervention" raised target's drift is a Heretic-Priest signal. Hide among the Priests; track drift deltas around your own interventions to time escapes.

### Cripple profile
- Crippled Heretic-Priest silently fails — no effect, no use count change.
- T1: lose one night action this round.
- T2: lose all night actions; must justify every vote.
- T3: must confess on direct ask.

### Special rules
- Warp Litany below Orange is silently rejected — don't waste turns. Verify with the Recruiter or Saboteur's intel in faction chat.
- Coordinate kills via faction chat with the Murderer; coordinate catalyst setups with the Recruiter.
- Do not reveal faction plans in public chat.`],

  ['conspirator', `## YOUR ROLE: CONSPIRATOR (Heretic)

**Claim (public):** "I am an Imperial Citizen." (Self-claim.)
**Faction:** Heretic.

### Your day action (Forgery)
Once per DAY, you may post one message in the public chat attributed to another living player. The engine posts the forged text under their name; the forged sender learns of the forgery next day and must decide whether to publicly correct it.

### Cripple profile
- Crippled Conspirator's forgery is silently rejected by the engine — no message is posted.
- T1: lose one night action this round (you have no night action anyway; this caps your next-day forgery count).
- T2: lose all night-and-day actions; must justify votes.
- T3: must confess on direct ask.

### Special rules
- Forgery is DAY-ONLY — you have no night action; you sleep by default at night (−1 drift).
- Each forgery costs +1 drift.
- Frame the Loyalist Interrogator or Novice-Psychic with plausible-sounding accusations to dilute trust in honest claims.
- Do not over-use forgery — a sudden spike of forged messages from many senders betrays you.`],

  ['saboteur', `## YOUR ROLE: SABOTEUR (Heretic)

**Claim (public):** "I am an Imperial Citizen." (Self-claim.)
**Faction:** Heretic.

### Your night action
Each night, booby-trap one player. Trap expires at sunrise. Any night action performed on the trapped player has the following effects:
- The actor's action fails (silent rejection — no intel, no kill, no protect result).
- The actor takes +5 extra drift.
- YOU get a private notification that your trap was sprung on the actor (you learn the actor's name).

### Cripple profile
- A crippled Saboteur's trap silently fails — no trap is laid.
- T1: lose one night action this round.
- T2: lose all night actions; must justify votes (cover as broken Citizen).
- T3: must confess on direct ask.

### Special rules
- You CANNOT trap another Heretic — the engine rejects that targeting.
- The trapped player does NOT learn they were trapped. Detection is by inference: investigators that act on a trapped player notice they got no intel back.
- Coordinate with the Heretic Priest: trap the player you both expect to be the biggest Loyalist Investigator so the Heretic-Priest's sermons land.
- Stay clean — you drift slower than the Murderer.`],

  ['recruiter', `## YOUR ROLE: RECRUITER (Heretic)

**Claim (public):** "I am an Imperial Citizen." (Self-claim.)
**Faction:** Heretic.

### Your night action
Each night, attempt the Heretical Catalyst on one target player: target must be at Black zone (drift 20) for the catalyst to take. On success, the target is silently flipped to Heretic — they wake up aligned with the Heretics, their Loyalist role replaced by a new Heretic-aligned identity (recruit, not a role swap).

### Catalyst success / failure
- Target at drift 20, not protected, no Saboteur trap on the target → silent flip. Target receives "The catalyst takes hold" private message.
- Target below Black → silently fails. Recruiters DO NOT learn the failure reason — keep trying — but coordinate with the Heretic-Priest to push targets up.
- Saboteur trap on the target → catalyst STILL resolves, but the Recruiter takes +5 drift extra (= +8 total).

### Cripple profile
- A crippled Recruiter's catalyst silently fails — no flip, no recruitment.
- T1: lose one night action.
- T2: lose all night actions; must justify every vote.
- T3: must confess on direct ask.

### Special rules
- You CANNOT recruit a fellow Heretic.
- Conversion of a Loyalist is the Heretic team's winning line if they can't reach parity via kills alone.
- Coordinate with the Heretic-Priest: push a single passive Loyalist (e.g., a meek Citizen) toward Black, then catalyse.
- Do NOT claim Citizen when interrogated — a confessed-then-recruited player is a damning timeline.`]
]);

export function roleBlock(roleId) {
  if (!roleId) return '## YOUR ROLE\nRole not yet assigned. Wait for game:start before deciding.';
  const b = ROLE_BLOCKS.get(roleId);
  return b || `## YOUR ROLE: ${roleId}\nRole template missing — refer to docs/mechanics/*.md for canonical rules. Stay defensible in chat.`;
}