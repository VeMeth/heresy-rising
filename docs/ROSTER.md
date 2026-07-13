# Heresy Rising — Role Roster

> **Status:** Draft v0.2 — 2026-07-05 (post design-lock)
> **Audience:** design reference for v1.
> **Source:** `CONCEPT.md`, `GAME_PLAN.md`, `interrogation.md`.

---

## 1. Role data shape (v1)

Roles live in `data/roles-40k.json` (engine reads from this, not from a hardcoded object). Shape:

```ts
type Role = {
  id: string;                    // e.g. 'interrogator-champion'
  displayName: string;           // 'Interrogator-Champion'
  faction: 'loyalist' | 'heretic';
  subfaction?: null;             // v1: always null. Phase 2: 'puritan' | 'radical'
  driftWeight: number;           // 0..3. Maps to tier cost (T1=1, T2=2, T3=3). Higher = stronger night action = drifts faster per trigger
  actions: {
    night?: {
      kind: 'kill' | 'investigate' | 'protect' | 'heretical-catalyst' | 'shield' | 'watch';
      target?: 'self' | 'other' | 'any';
      driftCost?: number;        // drift cost to USE this action (added to actor's drift)
    };
    day?: {
      kind?: 'interrogate' | 'lynch';  // day action participation (all roles vote)
    };
  };
  crippleProfile: {
    blocks: string[];            // e.g. ['investigate', 'kill', 'protect']
    onCripple: 'disable-one' | 'disable-all';
  };
  ability: string;               // human-readable, shown only to owner
  objective: string;             // win-condition reminder
};
```

**Hard rules for every role:**

1. **Power = risk.** Higher driftWeight (= tier) = stronger night action. Tier costs locked 2026-07-06: T0=-1 (sleep), T1=+1, T2=+2, T3=+3.
2. **Cripple profile must matter.** Every block in `blocks` should be a real capability; disabling one must shift gameplay.
3. **No role should be a hard counter.** Soft counters only.
4. **Chat-game-friendly.** Roles should *create conversations*, not resolve them in private.

---

## 2. Roster — v1 target: 11 roles (6 Loyalist + 5 Heretic)

> ⚠️ **2026-07-06:** Roster expanded from 10 → 11. Original target was 5 Loyalist + 5 Heretic. Priest (L6) added because Priest sermons were locked in `HANDOFF.md` §4 but no Priest slot existed. Composition table per player count lives in `data/composition.json`.

> **Approach:** Map Werewolf/Mafia archetypes to 40k equivalents first. Get the basic kit shipping. Expand with Imperial / Heretic-flavored roles in later phases.

### 2a. Werewolf-archetype mapping (the spine)

| Werewolf archetype | What it does | 40k flavor we want |
|---|---|---|
| Villager | Default. Discusses, votes, no night power. | A generic Imperial loyalist — name TBD |
| Werewolf | Hidden enemy. Faction chat. Night kill. | A hidden Heretic with a corrupting ritual |
| Seer | Investigates one player/night. Sees alignment. | Investigates one player/night. Sees **drift hint** or **role** — alignment locked out |
| Doctor | Protects one player/night from the kill. | Same protection ability, 40k-flavored |
| Detective / Bodyguard | The "smart" villager with extra info or protection | 40k-flavored specialist |

### 2b. Loyalist kit — implementation default: 6 roles

See `projects/heresy-rising/mechanics/loyalist-kit.md` for full spec. Summary:

| # | ID | Role | Claim | Night action | Day action | Drift tier |
|---|---|---|---|---|---|---|
| **L1** | `imperial-citizen` | Imperial Citizen | Imperial Citizen (self) | None (sleep T0 = −1) | Pure voter | T0 default |
| **L2** | `interrogator` | Interrogator | Interrogator (self) | Investigate one player (3 modes: story consistency / cross-reference / cumulative-bonus) | None | T2 (+2) |
| **L3** | `chirurgeon` | Chirurgeon | Chirurgeon (self) | Protect one player (Doctor slot) | None | T1 (+1) |
| **L4** | `novice-psychic` | Novice-Psychic | Novice-Psychic (self) | Drift-hint on one player (qualitative, zone-bounded) | None | T1 (+1) |
| **L5** | `arbitrator` | Arbitrator | Arbitrator (self) | Bodyguard-proxy — absorb hit for one player | None | T1 (+1) |
| **L6** | `priest` | Priest (Loyalist) | Priest (self) | Sermon — Whisper −2 daily / Hymn −5 2×/game / Litany −10 once | None | T0_special |

L6 is the claim-matching surface for Heretic Priest. This is an implementation default pending playtest lock.

**Note on L2 vs L4 split:** L2 (Interrogator) is the *political* investigator — uses conversation and contradiction. L4 (Novice-Psychic) is the *warp-impression* investigator — uses qualitative drift hints. Distinct mechanisms, not overlap.

**Design law (locked 2026-07-06):**
- **Interrogator intel degrades by zone:** Green exact → Black 100% noise. Power = risk.
- **Novice-Psychic reads drift, not alignment.** Blind to clean Heretics. Punishes action.
- **Chirurgeon (protect) and Arbitrator (bodyguard-proxy) are distinct roles** with different mechanics.

**Removed from v1 (deferred):** Daemonhunter, Sister of Battle, Confessor, Sister Hospitaller — see legacy notes below.

<details>
<summary>Legacy notes (kept for history, do not implement)</summary>

- **Daemonhunter** (was L2) — too powerful. Drift hints are too much info for v1. Defer.
- **Sister of Battle** (was L4) — drift-shield utility, overlaps with L3 (Chirurgeon).
- **Confessor** (was L4) — overlaps with L2 (Interrogator).
- **Sister Hospitaller** (was L5) — flavor conflict with Arbitrator; both bodyguard-types.

</details>

### 2c. Open sub-questions for Loyalist kit

| # | Question | Status |
|---|---|---|
| L-A | What does L4 actually see on a night investigation? | ✅ **LOCKED 2026-07-06:** qualitative drift hint (zone-bounded). Reads *drift*, not alignment. |
| L-B | L2 (Interrogator) bonus mechanics | 🟡 Three investigation modes drafted; cumulative-bonus at 2 nights; cap on pivot. Pending lock. |
| L-C | L5 (Arbitrator) protect vs proxy bodyguard | ✅ **LOCKED 2026-07-06:** proxy bodyguard. L3 (Chirurgeon) is the protect variant. Two distinct roles. |
| L-D | Confirm Citizens are pure voters (no night power) | ✅ **CONFIRMED 2026-07-06.** Citizen = noise floor, no night power. |

---

### 2d. Heretic kit — DRAFTED 2026-07-06, pending lock

See `projects/heresy-rising/mechanics/heretic-kit.md` for full spec. Summary:

| # | ID | Role | Claim | Night action | Day action | Drift tier |
|---|---|---|---|---|---|---|
| **H1** | `murderer` | Murderer | Imperial Citizen | Kill one player | — | T2 (+2) |
| **H2** | `heretic-priest` | Heretic Priest | Priest (Loyalist) | One of three inverted sermons (False Comfort / Twisted Hymn / Warp Litany) | — | T0_special (+1, +2, +4) |
| **H3** | `conspirator` | Conspirator | Imperial Citizen | — | Once/day: post message attributed to another player | T1 (+1) |
| **H4** | `saboteur` | Saboteur | Imperial Citizen | Booby-trap one player; any night action on trapped player → action fails, actor +5 drift, Saboteur notified | — | T2 (+2) |
| **H5** | `recruiter` | Recruiter | Imperial Citizen | Heretical catalyst: flip a Black-zone (drift 20) player | — | T3 (+3) |

**Design law (locked 2026-07-06):** every Heretic has a believable claim. Same surface as Loyalist, different math.

**Heretical catalyst carrier:** H5 (Recruiter). Murderer is intentionally *not* the catalyst — separation of concerns prevents the killer from being unstoppable.

**Day-phase presence:** H3 (Conspirator) is the only day-phase Heretic. The other 4 act at night, keeping day-phase Loyalist-dominant by default.

**Maximum drift cost across all 5 Heretics in one night:** +12 (Murderer +2, Heretic Priest Warp Litany +4, Saboteur +2, Recruiter +3, Conspirator +1 daytime). Forces choice — Heretics can't act maximally every night without exceeding the Heretic cap (13 by day 3, +3 spike).

---

### 2e. Removed from v1 (deferred)

These were in the v0.1 vibe list but are out of scope for v1:

| Role | Reason |
|---|---|
| Magos | Overlaps with Daemonhunter. Defer. |
| Sentinel | Overlaps with Daemonhunter. Defer. |
| Interrogator-Champion | Q4 (no dedicated initiator role) removed this. Vibe absorbed into L4 (Confessor). |
| Acolyte (Heretic) | Replaced by Werewolf-mapping: a hidden Heretic is the default enemy role, name TBD |
| Radical Acolyte | Concept preserved, deferred to Phase 2 subfactions |
| Warp-Touched | Too powerful for v1. Defer to twist layer. |
| Cantor | Flavor, defer. |
| ~~Saboteur~~ | **Resolved 2026-07-06:** Saboteur IS in v1 as H4 (booby-trap mechanic, T2). Removed from deferral list. |
| Heretic Acolyte (heretical catalyst role) | **Resolved 2026-07-06:** H5 Recruiter carries heretical-catalyst. |

### 2f. Composition per player count (5p–12p)

See `data/composition.json` for the full table. Hard rules:

- All non-Citizen roles unique per game; Citizens repeat to fill remaining slots.
- `priest` ships ≥5p (claim target must exist whenever `heretic-priest` is in game).
- `heretic-priest` ships ≥6p (needs Priest claim + ≥1 other Heretic for cover).
- `recruiter` ships ≥8p (catalyst carrier required for v1 conversion win path).
- `conspirator` ships ≥11p (forgery needs ≥10 living for density to matter).
- Heretic count ≤ Loyalist count at game start (parity-rule-friendly).

> ⚠️ **TODO(heresy-spec):** Composition drafted in 2026-07-06 session, not playtested. Review after first v1 playtest.

---

## 3. Faction hostility (predicate)

Engine never compares alignment values directly. The predicate lives in `heresy-server/src/heresyGameManager.js`:

```js
function isHostileTo(a, b) {
  // v1: any pair of different alignments is hostile
  return a !== b;
}
```

Phase 2 will need richer semantics (Puritan / Radical hostility within Loyalist), but v1 is a single comparison.

---

## 4. Versioning

This document updates as:
1. Roster brainstorming completes
2. v1 ships and playtest feedback lands
3. Phase 2 subfactions arrive

Coding agents: **confirm the phase with the user before acting.** v1 = implement §1 + the locked roster from §2 (once decided). No subfactions, no twists.
