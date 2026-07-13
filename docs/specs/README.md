# Heresy Rising — Locked Design Specs (Mirror)

> **Audience:** the coding agent. This folder is the canonical, GitHub-visible mirror of the game's locked design.

## What lives here

Locked design specs from `projects/heresy-rising/mechanics/` plus the pitch and open-questions tracker. Each file here is a mirror of its source-of-truth file in the designer's workspace.

## Source of truth — convention

| Where | Role | Who writes |
|---|---|---|
| `projects/heresy-rising/` | **Designer workspace.** Brainstorming, research, working specs, history. | Heretic (designer) — free to update |
| `heresy-rising-site/docs/specs/` | **Locked design mirror.** Read-only for designers. | **Only updated when Nicolas says "lock [X] v[N]"** |
| `heresy-rising-site/data/*.json` | Machine-readable engine data (drift thresholds, role IDs, composition) | Coder + Heretic when numbers lock |
| `heresy-rising-site/docs/` (root) | Coder-side architecture (GAME_PLAN, HANDOFF, ROSTER, etc.) | Coding agent owns |

**Rule:** the version of a spec in this folder is what the coder builds against. If a spec in `projects/` is newer than its mirror here, the mirror is **stale** — flag it to Nicolas and ask for a sync.

## Mirror banner

Every file in this folder starts with a banner like:

```
# ⚠️ MIRROR FILE — DO NOT EDIT ⚠️

**Canonical source:** `projects/heresy-rising/mechanics/X.md`
**Locked version:** v1.0.0 (2026-07-13)
**Sync rule:** edit the source. Mirror is regenerated when Nicolas says "lock [X] v[N+1]."
```

If you (the coder) need to change a spec, **do not edit the mirror.** Tell Nicolas. He locks a new version. Heretic regenerates the mirror.

## Versioning

Each spec uses SemVer-ish versioning:

- **Major (X.0.0)** — fundamental mechanic change (e.g. interrogation pivot)
- **Minor (1.X.0)** — adds a new sub-rule (e.g. drift cleansing on right interrogation)
- **Patch (1.0.X)** — typo fixes, clarification, copy edits

The coder can implement against **any 🔒 Locked** spec. 🟡 Default items in `OPEN_QUESTIONS.md` are **not safe to implement** without explicit "lock it" from Nicolas.

## Files in this folder

| File | Source | Status | Last updated |
|---|---|---|---|
| `mechanics/setup.md` | `projects/heresy-rising/mechanics/setup.md` | 🔒 Locked | 2026-07-13 |
| `mechanics/day-phase.md` | `projects/heresy-rising/mechanics/day-phase.md` | 🔒 Locked | 2026-07-13 |
| `mechanics/heretic-kit.md` | `projects/heresy-rising/mechanics/heretic-kit.md` | 🔒 Locked | 2026-07-06 |
| `mechanics/loyalist-kit.md` | `projects/heresy-rising/mechanics/loyalist-kit.md` | 🔒 Locked | 2026-07-06 |
| `mechanics/drift.md` | `projects/heresy-rising/mechanics/drift.md` | 🔒 Locked | 2026-07-06 |
| `mechanics/interrogation.md` | `projects/heresy-rising/mechanics/interrogation.md` | 🔒 Locked | 2026-07-06 |
| `pitch.md` | `projects/heresy-rising/pitch.md` | 🔒 Locked | 2026-07-05 |
| `OPEN_QUESTIONS.md` | `projects/heresy-rising/OPEN_QUESTIONS.md` | 🟡 Partial | 2026-07-13 |

---

*This folder is owned by Heretic (designer). For questions about the design, ask Nicolas. For questions about how to read the mirror, ask Heretic.*