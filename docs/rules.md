# Heresy Rising v1 Rules

Heresy Rising is a persistent, server-authoritative social-deduction game for 5–12 players. Roles are assigned from `data/roles-40k.json` using `data/composition.json`.

## Loop

`conclave → day 1 → night 1 → day mode vote → day target vote → repeat → victory`

At night, eligible roles submit a private action or skip to sleep. During the day, living players first choose **Interrogate** or **Lynch**, then choose a target. Ties trigger a re-vote.

## Interrogation and lynching

- Repeated interrogation of the same target escalates Tier 1 → Tier 2 → Tier 3.
- Tier 1 blocks one night and recovers after a round without repeat interrogation.
- Tier 2 permanently blocks night actions and removes vote weight; every vote requires a public justification.
- Tier 3 is permanent and forces a role confession when another living player directly asks.
- Lynch immediately applies Tier 3, kills the target, and publicly reveals faction.

## Drift

Drift is hidden server state. No client receives its numeric value. Players receive only private zone-flavor messages.

- Sleeping: −1
- Night power: action tier cost
- Innocent lynch voters: +2 wrong-lynch and +1 voter pressure through Day 5
- Witnessing a kill or execution: +1
- Tier 1 interrogation witnesses: +1; interrogation target pays its tier
- Priest effects, traps, and the Day 3 Heretic cap use their locked values from `data/drift.json`

A Black-zone Loyalist does not change faction automatically. Only Recruiter’s heretical catalyst can convert that player.

## Victory and chat

- Heretics win at living parity.
- Loyalists win once every Heretic is dead or Tier-3 crippled and directly confessed.
- Public chat closes at night. Heretics have faction chat at night. All dead players share one `#graveyard`.

The complete source of truth is [HANDOFF.md](HANDOFF.md).
