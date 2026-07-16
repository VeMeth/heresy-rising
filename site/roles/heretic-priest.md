---
title: Heretic Priest
description: The Heretic's counter-sermonizer. Buffs heretics or herds the faithful into deeper drift.
---

# Heretic Priest

> *Smile. The litany tastes of honey this evening.*

You are the Heretic's mirror of the Priest — a chaplain of the Warp, speaking the litany backwards. **Your sermons do not drain drift. They *feed* it.**

**Night action — Counter-sermon.** One target. Three tiers, limited uses.

| Sermon | Effect (target) | Cost (you) | Uses |
|---|---|---|---|
| **False Comfort** | +3 drift (target) | +2 drift (you) | Daily, unlimited |
| **Twisted Hymn** | +7 drift | +2 drift | 2–3× per game |
| **Warp Litany** | +12 drift | +4 drift | Once per game |

> **🟠 SPEC NOT LOCKED YET.** Numerics above are the current working draft (locked 2026-07-06 in `data/drift.json`). Two open sub-questions remain:
> - **Q17 — Warp Litany target scope** (whether super-cataclysmic sermons need a "warm-up" first)
> - **Q22 — Warp Litany pre-empt refund** (any partial-refund on interrupted Litany attempts)
>
> Per the 2026-07-06 lock the most likely outcome is *both are superseded by Execute on Sight* (Priest climbing into Orange is auto-killed regardless of target), but this has not been formally confirmed. Treat the tier table above as canonical for v1 dispatch.

**Direction:** all Heretic Priest sermons *push* the target higher in drift (the Warp's corruption, see [How to Play](/how-to-play)). You are the cell's drift engine.

**Self-sermons:** False Comfort can be self-targeted for +2 to the Heretic Priest in exchange for +3 to themselves — net is +2 for +3. The Heretic Priest spends her own drift cheaply. Useful in a pinch, expensive over time.

**Why you'll burn out:** at +2/night of False Comfort use, you'll be Orange by Night 5. Execute on Sight then kills you the next time an Interrogator scans you at T1+. **Rotate down with sleep and Twisted Hymns only.**

**When you are crippled** (cripple tier > 0), the engine silently disables *all* your sermon variants. (Note: cripple profile is `disable-all`, not `disable-one` — you cannot fall back to a weaker sermon.)

**Play this role if:** you want to be the cell's *drift coach* — turning Loyalists into so much fuel for the Recruiter.

**Loyalists should look for:** Heretic Priest sermons *corrupt*, not drain. If a publicly named Loyalist climbs zone rapidly without anyone dying around them, that was a Heretic Priest. The Priest + Heretic Priest are mirror roles; one drainer, one feeder.

**Heretics should look for:** the Heretic Priest pairs with the Recruiter. Push a clean Loyalist into Yellow; later, push them to Red; *then* the Recruiter's catalyst can take hold. A Heretic Priest who sermons themselves once a day is climbing into Orange — *rotate*.
