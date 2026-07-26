# Discrepancy Report: Implemented vs Documented

## Summary
Found 3 major discrepancies between the implemented game (per implemented-Gameplay.md) and the player manual (site/):

---

## Issue 1: Missing Roles in how-to-play.md

**Location:** site/how-to-play.md, lines 84-104

**Problem:** 
The how-to-play.md page claims there are "12 roles in v1: seven Loyalist, five Heretic" but only lists 5 Heretic roles, missing:
- **Animus** (custom roster, Tier T3, one-shot possession mechanic)
- **Blood Ritual** (shared faction action, not individual role)

**Current State in how-to-play.md Heretics section:**
1. Murderer
2. Saboteur
3. Heretic Priest
4. Recruiter
5. Conspirator

**Missing from how-to-play.md but documented in roles/index.md:**
- Animus (Tier T3, one-shot possession)
- Blood Ritual (Shared faction action)

**Actual Full Roster:**
- Loyalists (7): Imperial Citizen, Interrogator, Chirurgeon, Arbitrator, Novice-Psychic, Priest, Sanctioned Psyker
- Heretics (6): Murderer, Heretic Priest, Conspirator, Saboteur, Recruiter, Animus
- Plus Blood Ritual as a shared faction action (not unique slot)

**Impact:** Players reading the primer won't know about Animus or Blood Ritual, even though both are implemented and can appear in games.

**Fix Required:** Add Animus and Blood Ritual to the Heretics section of how-to-play.md, clarifying that Blood Ritual is faction-wide action and Animus is custom-roster only.

---

## Issue 2: Interrogator Mark Clearing Detail Variance

**Location:** site/how-to-play.md (line 48) vs implemented-Gameplay.md

**Problem:**
The how-to-play.md describes the interrogation mark clearing mechanics, but does not clearly state:
- Mark can ONLY be cleared on Green-zone reads (Yellow/Orange/Red cannot be cleared)
- Red reads DOUBLE the mark (making next interrogation = execution)

**Current how-to-play.md text (line 48):**
"Two interrogations on the same suspect = execution — no matter how many days apart, no matter who got interrogated in between."

**Detailed version in drift.md and interrogator.md:**
- Line 80-82 of how-to-play.md does cover this but in the Interrogation section, not in the Roles section
- interrogator.md fully covers the mechanics but how-to-play.md summary is incomplete

**Impact:** Moderate - the full mechanics are documented elsewhere, but the role summary could be clearer.

**Fix Required:** Optionally enhance the how-to-play.md Interrogator bullet point to include: "If a Loyalist is wrongly marked, you can clear the mark by spending a T1 scan on a Green-zone read (public action). Red-zone reads double the mark instead."

---

## Issue 3: Blood Ritual Not Mentioned in how-to-play.md Role List

**Location:** site/how-to-play.md, Heretics section

**Problem:**
Blood Ritual is a major game mechanic (faction-wide night attack) that is:
- Fully implemented in the game code
- Appears in game logs
- Documented in site/roles/blood-ritual.md
- Listed in roles/index.md

But is NOT mentioned anywhere in how-to-play.md

**Current Coverage:**
- roles/index.md: Documented with full explanation (it's a shared action, not a role)
- blood-ritual.md: Fully documented with mechanics, strategy, counterplay
- how-to-play.md: NOT MENTIONED

**Impact:** High - Players reading the primer get no indication that Blood Ritual exists, even though it's a core Heretic faction mechanic they'll encounter in games.

**Fix Required:** Add Blood Ritual note in the Heretics section. Note that it's a shared faction action (any Heretic can carry), not an individual role slot.

---

## Issue 4: Animus Not Mentioned in how-to-play.md

**Location:** site/how-to-play.md, Heretics section

**Problem:**
Animus is a fully implemented role that:
- Is listed in roles/index.md
- Has a dedicated page at roles/animus.md
- Can appear in custom rosters
- Is implemented in the game database schema (`possessed_by`, `possession_revealed` fields)

But is NOT mentioned anywhere in how-to-play.md

**Current Coverage:**
- roles/index.md: Listed with note "(custom-roster only)"
- animus.md: Fully documented with possession mechanics
- how-to-play.md: NOT MENTIONED

**Impact:** High - Players using or encountering Animus in custom games won't know what it is if they only read the primer.

**Fix Required:** Add Animus to the Heretics section. Note that it's custom-roster only (doesn't appear in deterministic compositions).

---

## Issue 5: Interrogation Mark System Not Fully Explained in how-to-play.md

**Location:** site/how-to-play.md, line 76

**Problem:**
The interrogation section claims "Two interrogations on the same suspect = execution" but doesn't clearly state:
- The mark is persistent across ALL days (set by `interrogated_before` flag)
- The mark persists even if other players are interrogated between
- Cabal cannot pivot or reset the mark
- This is a tiered-lynch mechanic (v1.3.0)

**Current how-to-play.md text (line 76):**
"Two interrogations on the same suspect = execution — once a suspect carries the mark, the second orange border on them kills them. The cabal has no pivot to clear it."

**What's Missing:**
- Explicit statement that the mark persists forever
- Explanation that "no pivot" means mark doesn't reset even if you interrogate different targets

**Better Explanation Would Be:**
"Once a suspect gets an interrogation mark, it persists until they die — across days, even if other suspects are interrogated in between. The second interrogation on that marked player is execution, regardless of vote % or how many days have passed."

**Impact:** Moderate - The core mechanic is explained but could be clearer about persistence.

**Fix Required:** Enhance line 48 or 76 to clarify mark persistence across rounds and immunity to pivot defense.

---

## Issue 6: Possession/Animus Mechanics Not in how-to-play.md

**Location:** site/how-to-play.md (entire document missing Animus mention)

**Problem:**
Possession is a unique mechanic that:
- Silences a player's vote
- Suppresses their night action
- Controls their day chat
- Results in a detonation (death + full role reveal)

This is fully implemented but never mentioned in the primer.

**Implementation Details:**
- Database: `possessed_by`, `possession_revealed` fields
- Mechanic: One-shot per game, speculative target
- Detection: Requires guessing Red zone (15-19)

**Impact:** High - Major game mechanic completely absent from primer.

**Fix Required:** Add Animus description to how-to-play.md Heretics section, with brief explanation of possession mechanic.

---

## Issue 7: Blood Ritual Mechanics Details in how-to-play.md

**Location:** site/how-to-play.md (no coverage)

**Problem:**
Blood Ritual is not mentioned at all, but it includes important mechanics:
- Faction-wide action (not individual role slot)
- Can be carried by any living Heretic each night
- First hit cripples (+3 drift)
- Second hit on same target (consecutive night) kills (+3 drift)
- Escalation resets with different target or skipped night
- Murderer can use it instead of own kill

**Impact:** High - Players don't know a core Heretic faction mechanic exists.

**Fix Required:** Add Blood Ritual to how-to-play.md Heretics section.

---

## Summary Table

| Issue | Severity | Location | Fix Type |
|-------|----------|----------|----------|
| Animus missing from how-to-play | HIGH | Role list | Add Animus to Heretics section |
| Blood Ritual missing from how-to-play | HIGH | Role list | Add Blood Ritual note to Heretics section |
| Interrogation mark persistence unclear | MEDIUM | Line 48/76 | Clarify mark persistence across rounds |
| Interrogator clear mechanics incomplete | LOW | Role bullet | Optional: expand Interrogator description |

---

## Recommended Actions

1. **HIGH PRIORITY:** Update site/how-to-play.md to include Animus and Blood Ritual in the role list
2. **MEDIUM PRIORITY:** Clarify interrogation mark persistence in how-to-play.md
3. **LOW PRIORITY:** Enhance Interrogator role description with clearing mechanics detail

All fixes should reference the existing detailed documentation (roles/ pages and drift.md) for players who want deeper understanding.

