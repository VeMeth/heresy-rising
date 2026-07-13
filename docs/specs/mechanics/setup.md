<!--
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/setup.md`
**Locked version:** v1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-13

**Sync rule:** edit the source. This mirror is regenerated only when Nicolas says
"lock [mechanics/setup.md] v[N+1]". Heretic then copies source → mirror with this banner.

If you (the coding agent) find this file is out of sync with the source, flag it
to Nicolas — do not edit the mirror yourself.
-->
# Heresy Rising — Game Setup

**Version:** 1.0.0
**Status:** 🔒 Locked
**Last updated:** 2026-07-13 — Conclave rename applied; room-creation flow canonical
**Source:** Heretic + Nicolas, 2026-07-06 design-lock pass + 2026-07-13 Conclave rename
**Companion files:** `day-phase.md`, `heretic-kit.md`, `loyalist-kit.md`, `drift.md`, `interrogation.md`

---

## Changelog

### 1.0.0 (2026-07-13)
- **Conclave rename** — "Lobby" / "Cell" → "Conclave" for room/session references (lore sense preserved for Inquistorial cells)
- Phase 0 renamed from "Lobby" to "Conclave"
- Section anchors remain stable; only prose updated

### 0.9.0 (2026-07-06)
- Design-lock pass — phase machine, role-reveal flow, role-assignment privacy rules canonical
- `composition` field removed from lobby state payload; replaced with `compositionLabel: "<n>-operative doctrine"`
- Host has no special disclosure of role composition

---

> *How a game begins. From Conclave creation to first dossier reveal.*

---

## 🎯 Phase 0 — Lobby (before the game starts)

| Element | Rule |
|---------|------|
| **Conclave creation** | Host creates a Conclave. 6-character room code auto-generated. |
| **Join window** | Players join by name. Seats 1–N, ordered by join time. |
| **Ready check** | All non-host players must mark ready before host can start. |
| **Player count** | 5–12 players. Outside that range → host cannot start. |
| **Parameters** | Host may set `maxDrift` (1–100, clamped to ≥1). Default: 20. |

---

## 🕶️ Composition privacy — **LOCKED 2026-07-06**

**The lobby MUST NOT reveal role names, even to the host.**

Showing the role composition before the game starts makes roles deductively knowable: at low player counts (5–7), there are only a handful of role permutations, and any role listed in the lobby can be identified to a seat through process of elimination.

| Viewer | What they see in lobby |
|--------|-----------------------|
| Any operative | Only `<n>-operative doctrine` (a generic size label). No role names. No composition list. No "seal" text. |
| Host | Same generic label. The host is a player too — they pick their seat and play like everyone else. |

**Display rule (binding on the client):**
> The lobby surfaces a single string — *"<n>-operative doctrine"* — and one line of flavor text. **No list, no toggle, no peek.**

**Server rule (binding on `state()` projection):**
> `composition` is **omitted** from the lobby state payload. The wire payload exposes only `compositionLabel` (a generic string derived from `players.length`). Role IDs are not on the wire until after `start()` runs.

---

## 🎲 Role assignment — **LOCKED 2026-07-06**

**Distribution method: pure random shuffle (Fisher-Yates).**

When the host calls `start()`:

1. The composition is read from `data/composition.json` based on `players.length`.
2. The composition array (e.g., `[interrogator, chirurgeon, recruiter, …]`) is shuffled **once** using Fisher-Yates, seeded by `Math.random()`.
3. Result is paired against the player list ordered by join time (seat order).
4. Each player's `role_id` and `faction` are written to the DB in a single transaction.
5. Game phase transitions from `lobby` → `role-reveal`. Round 0. Deadline cleared.
6. Each player receives a private message via The Vox: *"Roles assigned. Review your private dossier."*

**Why random and not something cleverer:**

- **It works.** Werewolf-standard. Universally understood. No on-ramp cost.
- **No second channel needed.** Chat-based play already constrains us to text; adding a peek-and-swap mechanic adds another private handshake the engine has to track. Random dodge that.
- **Anti-detection is the *game*, not the deal.** Drift zones, intel noise, and interrogation feedback are how players detect each other — not the random distribution.

**Why this is locked and not Q15:**

- The mechanics kit already says *"Power = risk"* and *"Every Heretic needs a believable claim."* Both depend on the distribution being non-strategic (you can't engineer your own role or someone else's with a fixed deck).
- The recruitment-via-catalyst mechanic (Heretic Priest / Recruiter) only matters if the Loyalist receiving it was **randomly** assigned to be Loyalist. If distribution were strategic (e.g., player X picks who becomes Heretic), the catalyst would be redundant.
- Locking this also closes a Was-not-Was: any future code reading "how are roles assigned?" finds a single canonical source, not a debate.

**Edge case — what the engine does NOT do:**

- ❌ No "peek at your neighbor" mechanic. (v1; revisit in Phase 2 if it strengthens the recruitment arc.)
- ❌ No host-controlled seeding. Host doesn't get to rig the deal.
- ❌ No draft or bid. Single random draw, end of story.
- ❌ No role-reveals-the-player claim. Reveal happens via **The Vox's private dossier** to the player themselves, not to the table.

---

## 📜 After assignment — `role-reveal` phase

The game enters `role-reveal` with `round = 0`. The client transitions here automatically when the host hits "Seal the chamber". Each player's private dossier is now visible in their UI sidebar — it shows:

| Field | Value |
|-------|-------|
| **Role** | e.g., *Interrogator* |
| **Faction** | Loyalist / Heretic |
| **Claim** | e.g., *"Interrogator"* (the cover story they may tell the table) |
| **Tier** | Drift cost per night action |
| **Ability** | One-paragraph mechanical summary |

The first `resolve()` call from the host transitions the game into `night` of round 1. Night 1 begins.

---

## 🛠️ Handoff notes for the coding agent

### Server changes (already shipped 2026-07-06)

1. **`state()` projection** — `composition` field removed. New field `compositionLabel: "<n>-operative doctrine"` available during lobby only.
2. **`start()` shuffle** — Fisher-Yates, unordered `composition[]`. **No change needed; the spec now backs this.**
3. **Tests** — 10/10 passing. No test touched the old `composition` field, but verify any new lobbies don't break.

### Client changes (already shipped 2026-07-06)

1. **`LobbyView.vue`** — replaced the role-list rendering with `compositionLabel`. Host has no special disclosure.
2. **Drop the host "peek at composition" affordance entirely.** It doesn't exist.

### Open question closed

Q15 (`OPEN_QUESTIONS.md`) — *"How are roles distributed?"* — **RESOLVED**. Remove from the open list. Add a canonical entry here.

---

_Locked entries above. Everything below is implementation detail or future work._
