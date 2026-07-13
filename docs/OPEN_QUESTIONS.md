# Heresy Rising — Nine Open Defaults Used by Phase 1

These are implementation placeholders pending owner lock. Every callsite is marked `// TODO(heresy-spec):`.

1. **Which Loyalist slot supports the Heretic Priest claim?** Default: add Priest as L6, producing 11 roles total (6 Loyalist, 5 Heretic).
2. **How does interrogation progress and recover?** Default: consecutive interrogation of the same target escalates T1 → T2 → T3; changing target resets to T1. T1 recovers after one round without re-interrogation; T2/T3 are permanent.
3. **When does confession occur?** Default: T3 confesses only after a direct ask. T1/T2 targets choose Confess, Resist, or Refuse + Break. Loyalist victory requires actual T3 confession.
4. **Who pays interrogation Drift?** Default: target pays tier cost (+1/+2/+3); every other living player separately gains +1 only at T1.
5. **Who receives “voted with losing side” Drift?** Default: voters whose chosen target was lynched and post-reveal Loyalist receive +1; minority voters do not. This halts after Day 5.
6. **What composition ships for 5–12 players?** Default: exact table in `data/composition.json`, including its priority fallback; unique non-Citizens and repeatable Imperial Citizens.
7. **What are the Priest frequency ambiguities?** Default: Whisper unlimited daily, Hymn twice per game, Litany once per game; False Comfort self-cost is +1.
8. **What does the confession protection token do?** Default: blocks re-interrogation during the current Day only, expires at Day → Night, forces loss of the next night action, is faction-blind, and refreshes without stacking.
9. **Who counts as a T1 witness?** Default: every living player except the interrogation target gains +1 Drift; T2/T3 have no witness Drift.

The eight older defaults already listed in `HANDOFF.md` §13 remain implemented and flagged independently where they overlap these Phase 1 mechanics.
