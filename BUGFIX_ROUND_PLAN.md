# Bugfix round — messaging, dossier, and lobby UI

**Status:** Plan — for dispatch
**Baseline:** heresy-server 298/298, bot-manager 257/257, client builds (`0081097`)

Every root cause below was verified in the code, not inferred from the symptom.

---

## 1. Private "you were crippled" message talks about you in the third person

**Symptom:** *"Player 5 was left crumpled against a bulkhead, the cabal's warning made flesh."*

**Root cause (verified):** `game_data/deathFlavor.json` has three pools. `slain` and
`tortureChamber` are broadcast publicly via `this.system(...)`, so `{victim} was…`
is correct for them. **`bloodRitualCripple` is the odd one out — it is sent
privately to the victim** (`heresyGameManager.js:748`,
`this.privateSystem(c,victim,crippleBody)`) and to a targeted announcement, yet
all four of its strings are written in the same third-person voice.

**Fix:** rewrite the four `bloodRitualCripple` strings in second person ("You were
left crumpled against a bulkhead…"). Data-only change. **Do not touch `slain` or
`tortureChamber`** — third person is right there.

**Bookmarking:** it is already auto-filed (`privateSystem` defaults
`autoBookmark:true`), but with `meta = null` it lands in the **General** bucket
with no subject. Pass a meta so it files under the victim's own dossier entry —
"what happened to me" belongs with the player it happened to. Verify it actually
appears, since the reporter believed it was missing.

---

## 2. "That message is outside the loaded history" — the naive fix will not work

**Symptom:** jumping to a bookmark reports the message isn't loaded.

**Root cause (verified):** *not* a pagination problem. `App.vue:163`'s
`loadHistory()` with no cursor already loops `while (hasMore)` and loads the
**entire** history — but only for `channel.value`. Messages are stored per channel
(`messagesByChannel = {public, faction, graveyard}`), and `GameView.onJump`
(line ~517) only searches `pastDays`, which is built from the **currently
selected channel**. A bookmarked **private** or **faction** message is therefore
not missing — it is in a bucket the view isn't looking at.

So "just load more history" would not fix it. The fix is **channel-aware jumping**:

1. Bookmarks already carry `channel` (`hr_bookmarks.channel`, returned by
   `bookmarkRow`). Use it.
2. On jump, if `bookmark.channel !== channel.value`, switch channel first, await
   that channel's history load, then scroll.
3. Keep the existing collapsed-day expansion, and expand `showEarlierDays` as it
   already does.
4. Only if the id is still absent should it fall back to a message — and it should
   name the reason, not the current vague line.

**Confirm first:** that `chat:history` will actually serve `channel:'private'` for
the owner (`historyMessages` → `authorizeChannel`). If private messages are not
retrievable as a channel, they must be merged into the view another way — resolve
this before writing the jump logic.

---

## 3. Auto-filed action notes are incomplete (the big one)

**What's asked:** a player should end the game with a complete record of what they
did — every action filed under **their own** entry **and** under the **player they
targeted**; and night abilities that return no intel should produce a morning
message saying what they did, also filed.

**Root cause (verified):** `autoBookmark` is only ever reached through
`privateSystem`, and only two call sites pass an actor result —
`resolveIntel` (`heresyGameManager.js:768` drift-hint, `:782` interrogate).
Every other night action resolves silently for the actor: the engine's night kinds
are `protect, bodyguard, boobytrap, forgery, kill, possess, sermon, sleep`, and
none of them tell the actor anything. Nothing exists to file.

### 3a. The schema blocks the literal "file under both" ask

```sql
hr_bookmarks … PRIMARY KEY(game_code, owner_code, message_id)
```
One row per (owner, message), carrying a **single** `subject_code`. So the same
message **cannot** be filed under two subjects as two rows. Options:

- **(A) Add an `actor_code` / `own_action` column** and let the dossier UI list a
  message under its `subject_code` bucket **and** under a "your actions" view,
  derived rather than duplicated. **Recommended** — no duplicate rows, no PK
  change, no double-counting against the cap.
- (B) Widen the PK to include `subject_code` and insert twice. Duplicates content,
  doubles cap pressure, and makes un-bookmarking ambiguous. Not recommended.

Pick (A) unless something makes it unworkable, and say so if you switch.

### 3b. Morning "what you did last night" messages

After night resolution, send each living actor one private line naming the action
and target — *"Last night you protected Varro."* — auto-filed under the target.
Cover the silent kinds (`protect, bodyguard, boobytrap, forgery, possess, sermon,
kill`) and `sleep` ("You slept. −1 drift.").

**Hidden-information rule:** state only what the actor *chose*, never the outcome.
The spec is explicit that a Chirurgeon never learns whether their protect fired;
"you protected X" is safe, "your protect blocked a kill" is a leak. This is the
single easiest way to break the game in this item — treat it as a hard constraint
and re-read `docs/specs/mechanics/loyalist-kit.md` / `heretic-kit.md` before
wording anything.

### 3c. The 300-bookmark cap becomes a real risk

`autoBookmark` silently returns at `n >= 300`. Adding an entry per action per round
raises pressure, and the failure mode is invisible — the record just stops being
complete, which is exactly what this item is trying to guarantee. Either exclude
auto entries from that cap, give them a separate budget, or evict oldest-auto-first
and surface that in the UI. Do not leave a silent drop in place.

### 3d. Further suggestions (asked for)

1. **File votes too.** A vote is an action against a player; today nothing is filed.
   The target + justification belongs under that player's entry.
2. **A "My actions" view in the dossier** — chronological, round-stamped, separate
   from bookmarks *about* others. This is what "full access to what I did" really
   means, and (A) above makes it nearly free.
3. **Round/phase stamps in the excerpt**, so the dossier reads as a timeline rather
   than an unordered pile.
4. **End-of-game personal log** — once the game ends, hidden-info rules relax; a
   full exportable record is then safe and makes a satisfying post-mortem.
5. **Visually distinguish auto from manual entries.** The `auto` column already
   exists; the UI should show it, so players can tell what they saved from what
   the engine filed.
6. **Don't auto-file the role-reveal** — `heresyGameManager.js:663` already passes
   `{autoBookmark:false}` for it. Keep that exemption.

---

## 4. Dossier note count doesn't refresh until reload

**Root cause (verified):** `App.vue:82` holds `notes`/`bookmarks` refs populated
only by `loadNotes()` (the `notes:list` command) and by the ack of an explicit
`bookmark:toggle` / `bookmark:note`. Server-side `autoBookmark` writes straight to
SQLite and **emits nothing** — `privateSystem` emits the chat message only. So an
auto-filed bookmark is invisible until the next `loadNotes()`, i.e. a reload.

**Fix:** after a successful `autoBookmark`, emit the new bookmark row **to the
owner's socket only** (reuse whatever targeting `emitChatMessage` uses for private
messages — this is hidden information and must never broadcast). Client appends it
to `bookmarks`, matching the merge logic already in `toggleBookmark`'s handler.

Cheaper alternative if targeting proves awkward: have the client call `loadNotes()`
when a private system message arrives. Prefer the emit — one row beats refetching
the whole dossier on every private message.

---

## 5. Interrogator T2 result reads as self-contradictory

**Symptom:** *"Player 2's story does not add up. You sense their drift zone: green"*
— an accusation followed by a reassuring fact, with no connective tissue.

**Root cause (verified):** `heresyGameManager.js:782` concatenates two independent
sentences: a faction hint (`story holds together` / `does not add up` / `You
learned nothing.`) and, at `effectiveTier >= 2`, `\` You sense their drift zone:
${targetZone.id}.\``.

The two are genuinely independent signals — faction vs. drift — and the flat
concatenation invites reading the zone as evidence *for* the accusation. It also
lowercases oddly and doesn't explain that a Green Heretic is entirely possible.

**Fix:** reword so the two readings are clearly separate, keeping both facts and
adding no new information. Something in the register of the rest of the game's
prose, e.g. *"…their story does not add up. Their drift, though, is Green — the
warp has not touched them yet."* Wording is the deliverable here; keep the
mechanical content identical, and keep the `meta` payload exactly as it is (the
bots and the dossier read it).

---

## 6. Victory seal is red for a winning Heretic

**Root cause (verified):** `GameView.vue:124` sets the seal class from the
**winning faction**, not from the viewer's result:

```html
<div class="verdict-seal" :class="game.winner==='loyalist'?'loyalist':'heretic'">
```
with `.verdict-seal { --wax: #9f3931; }` (red) and
`.verdict-seal.loyalist { --wax: #9c7c2e; }` (gold). A Heretic who **won** sees the
red seal and reads it as a loss.

**Fix:** drive the colour from `winner === me.faction` — gold/green for victory,
red for defeat — instead of from the faction name. Keep the faction wording in the
seal face (`{{ game.winner }} Victory`); only the colour semantics change. Handle
the spectator/dead-before-assignment case where the viewer has no faction: fall
back to a neutral treatment rather than implying a result.

---

## 7. Host settings panel is oversized and one control is unstyled

**Root cause (verified):** `LobbyView.vue:64-76`. Each setting is followed by a
full paragraph of explanation (`<p class="anon-hint">`) — three of them, one
running to ~50 words — which is what makes the panel enormous. And the death-reveal
control is a bare `<label class="reveal-select">` wrapping a `<select>`, while its
siblings are `.anon-toggle` checkboxes, so it doesn't match.

**Fix:**
1. Replace each `<p class="anon-hint">` with an **(i) icon beside the setting name**
   carrying the current text as a tooltip. Keep the wording — it is good, it just
   shouldn't be permanently on screen.
2. **Style the death-reveal select** to match the surrounding controls.
3. Tooltips must be reachable without a mouse: focusable trigger, keyboard
   dismissable, and readable on touch (where `title=` alone does nothing). A plain
   `title` attribute is not sufficient on its own.
4. Don't change any setting's behaviour, default, or persisted shape — the
   read-only `<dl>` for non-hosts and the `scheduleSave` wiring stay as they are.

---

## Dispatch

Rules for every agent: **make the edits, run the tests, do not `git commit` or
`git push`.** File ownership is exclusive.

| # | Agent | Model | Owns (exclusive) | Items |
|---|---|---|---|---|
| S1 | `engine-messaging` | Sonnet | `heresy-server/src/heresyGameManager.js`, `game_data/deathFlavor.json`, `heresy-server/test/**` | 1, 3 (server), 4 (server), 5 |
| S2 | `client-dossier` | Sonnet | `heresy-client/src/App.vue`, `heresy-client/src/components/GameView.vue`, `heresy-client/src/components/PlayerDossier.vue` | 2, 3 (client), 4 (client), 6 |
| S3 | `lobby-settings` | Sonnet | `heresy-client/src/components/LobbyView.vue` | 7 |

**Wave 1:** S1 alone — it owns the schema/meta/emit contracts S2 consumes.
**Wave 2:** S2 + S3 in parallel (disjoint files).

S3 is independent of everything and could start immediately; S2 must not begin
until S1's emitted-bookmark payload and `own_action` shape are fixed.

Item 3 is the only one with real design risk (hidden-information leakage, §3b, and
the cap in §3c). If S1 has to choose, correctness of the hidden-information rule
beats completeness of the record.

## Acceptance

1. `cd heresy-server && npm test` — 298 still pass, plus new coverage.
2. `cd bot-manager && npm test` — 257 still pass (bots read these private metas).
3. `npm --prefix heresy-client run build` succeeds.
4. A crippled victim reads a second-person message and finds it in their dossier.
5. Jumping to a bookmark in a non-active channel switches channel and scrolls.
6. An auto-filed note updates the count **without** a page reload.
7. A winning Heretic sees a victory-coloured seal; a losing Loyalist sees red.
8. No new test asserts an actor learning an outcome they are not entitled to.
