---
title: Saboteur
description: The Heretic's trap-setter. T2 booby-trap on one player per night; the next action against them costs the actor +5 drift and returns false.
---

# Saboteur

> *Bait the coil. Wait for the foot.*

You are the Heretic's trapper. Each night, you place a booby-trap on one operative. If a night action targets the trapped player — Interrogation, Sermon, kill, anything — the next action against them **costs the actor an extra +5 drift** *and* **silently returns false.** You learn that the trap sprang and who stepped in it.

**Night action — Booby-trap.** One target. The trap expires at sunrise.

**Drift cost (Warp invoice):** **+2 per night you trap.** T2 is steep — you climb fast.

> **🟠 Spec status:** v1 spec is finalized (drift cost +2, trigger +5, specific effects per action listed below). Q19 (fail-cost refund) was superseded by Execute on Sight mechanics — Saboteur's climb is its own deterrent.

**Trigger:** any night action *performed on the trapped player.*

**Effects on trigger:**

| Actor's action | What happens |
|---|---|
| **Interrogate** | Result is always "their story holds together." Actor pays +5 extra drift. |
| **Drift Hint** | Hint is the wrong zone (or a near-useless generic). Actor pays +5. |
| **Sermon (Priest)** | Target's drift doesn't change (silent fail). Priest pays +5 on top of their sermon cost. |
| **Kill (Murderer)** | Kill proceeds normally (this is the *only* exception). Murderer pays +5 on top of +2 = +7 total. |
| **Catalyst (Recruiter)** | Conversion proceeds normally (this is the only counter to the trap-on-recruit). Recruiter pays +5 on top of +3 = +8 total. |

**You learn:** a private system message: *"Your trap sprung — `<actor>` tried to `<action>` on `<target>`."* You know *that* it fired and *who* acted. You do not learn what the action's *result* was — just that there was an attempt.

**The trapped player does not know.** Detection is silent. The actor learns (their action returned garbage) but doesn't know *why*.

**Saboteur traps do not stack.** One trap per operative per night. Once a trap springs, the target is safe until you re-trap them.

**When you are crippled** (cripple tier > 0), the engine silently rejects your action — no trap, no drift cost.

**Drift curve:** at +2/night, the Saboteur is Orange-zone by Night 5. By Night 7 they are in Red. A single Interrogator T1+ scan at Orange is Execute on Sight — *you die*. **Trap sparingly** and sleep often.

**Play this role if:** you want to *punish* the Loyalists for acting — make every Interrogator think twice about scanning, every Priest hesitate to sermon.

**Loyalists should look for:** the trap fires when *someone targets the trapped player*. If a T2 Interrogator suddenly pays +5 drift for "nothing happened," you have a Saboteur. The trap-target is *not* the trapped player — it is the *actor*. Use this to invert: scan who paid the +5.

**Heretics should look for:** traps land on Interrogators. Trap the Interrogator's favorite target and the next Interrogation scan costs +7 total drift. They start to *fear* acting.
