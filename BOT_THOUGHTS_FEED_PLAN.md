# Q-BOT-FEED — Bot thoughts & activity feed in the admin panel

**Status:** Plan — dispatching
**Baseline:** `bot-manager` green at 220/220 (`4bb8c51`)

---

## TL;DR

A live, cross-bot, chronological feed in the admin panel showing what every bot
**thought**, **did**, and **declined to do** — with the reasoning text that
MiniMax already sends us and that we currently throw away.

---

## 1. What already exists, and what's missing

| | Today | Needed |
|---|---|---|
| Reasoning text | `OpenAIChat.chat()` returns `reasoningText` (from `reasoning_split`) — **never stored**. `stripThink()` deletes local `<think>` blocks. | Capture both |
| Per-bot actions | `session.actionLog`, capped 50, in `inspect()` | Keep |
| Cross-bot view | none — you click into each bot separately | The feature |
| Why-not decisions | validator rejections, duplicate suppression, truncation, director speaker choice → `console.warn` only, then gone | Surface them |
| Live-ness | 3s poll of `GET /bots` | Incremental poll |

The single highest-value line in the whole feature: `actionLLM.js` line 34
already types `reasoningText` in its JSDoc and no code path reads it.

---

## 2. Design

### 2.1 `bot-manager/src/thoughts.js` (new) — a process-wide ring buffer

```js
recordThought(entry)        // append; assigns seq + ts; enforces caps
readThoughts({ since, conclaveCode, botId, kinds, limit })
_resetThoughtsForTests()
```

Entry shape:

```js
{
  seq, ts,                                  // seq is monotonic — the poll cursor
  conclaveCode, botId, playerCode, botName,
  profileId, role, faction, round, phase,   // admin-only context
  kind,        // 'thinking' | 'action' | 'rejected' | 'suppressed' | 'error' | 'director'
  summary,     // one human-readable line, always present
  thought,     // reasoning text, may be null
  detail       // { verb, target, text, reason, promptKind, tokens, latencyMs, finishReason, attempt }
}
```

**Caps (all hard):** 500 entries globally, `thought` truncated to 2,000 chars,
`detail.text` to 500. A ring buffer, not a log — this is observability, not an
audit trail.

### 2.2 Capture points

1. **`llm/actionLLM.js` → `kind:'thinking'`.** The main event. Capture
   `response.reasoningText` (MiniMax) **and** whatever `stripThink()` removed
   from `content` (local Qwen3 emits stray `<think>` blocks even under
   `/no_think`, per that file's own header comment — free capture). Also record
   latency, `finishReason`, token split, attempt number, and whether the action
   parsed. A failed parse followed by a nudge retry should produce **two**
   entries, because "it tried twice" is exactly what an operator needs to see.

2. **`session.js` → `_logAction()`.** Already the single funnel for every
   outcome (chat, vote, action, pass, rejected, suppressed-duplicate,
   invalid_action, llm_error, socket_offline). Mirroring it into the feed is one
   small change that covers all of them — do **not** scatter `recordThought`
   calls through `_act`.

3. **`director.js` → `kind:'director'`.** Emit which bot was chosen and why
   (`reason` + score, or an intro-queue pick). Today this reasoning is entirely
   invisible; it's the answer to "why is that bot silent?"

### 2.3 Transport — incremental polling, not streaming

`GET /thoughts?since=<seq>&conclave=<code>&limit=<n>` on the bot-manager,
proxied as `GET /api/admin/bots/thoughts`.

**Route-ordering trap:** it must be registered **before**
`/api/admin/bots/:id`, or Express matches `:id === 'thoughts'`. Same trap the
`/profiles` route hit.

Polling rather than SSE/WebSocket is deliberate: the admin path is a
REST-proxied shared-secret hop through heresy-server, so a streaming path means
new proxy plumbing for marginal gain at a 3s cadence. The `since` cursor keeps
payloads to just the new entries. Revisit only if 3s proves too coarse to watch
a turn unfold.

### 2.4 UI — a third view inside the existing Bots tab

Live feed, newest first, above/next to the existing sessions table:

- **Filters:** conclave, bot, kind (thinking / actions / problems).
- **Thought text collapsed by default**, expandable — reasoning traces are long
  and would otherwise bury the action lines.
- **Badge per kind**, reusing the file's existing badge conventions; the model
  badge from the profiles work carries over.
- **Pause / auto-follow toggle**, so a feed scrolling under you doesn't stop you
  reading. Pausing must not lose entries — keep polling, just don't scroll.
- Empty state must explain the local caveat (§4) rather than looking broken.

---

## 3. Security — this feed is pure hidden information

It exposes roles, factions, and a bot's private reasoning about who it thinks is
a Heretic. That is fine for a site admin and catastrophic for a player.

- Admin-gated exactly like the other bot routes (`requireBotsAdmin` +
  `ADMIN_API_KEY` on the proxy hop). **Add an explicit test that an unauthed
  request gets 401/403** — this repo has a history of hidden-information audits.
- **Never** broadcast to a game socket or include in any player-facing payload.
  The feed is REST-only, admin-only.
- **Never persisted.** Thoughts stay out of `snapshot()` and therefore out of
  `data/bot-sessions/*.json`, which would otherwise leak reasoning into backups
  and grow without bound. Memory-only, dies with the process — state that
  explicitly in the module header so nobody "helpfully" persists it later.

---

## 4. Known caveat: local bots mostly won't have thoughts

The `local` profile runs `/no_think` (`LLM_NO_THINK=true`) and caps output at
350 tokens, so there is usually no reasoning to capture — the feed will show its
**actions** but few **thoughts**. Getting local thoughts requires
`LLM_NO_THINK=false` *and* a raised `MAX_TOKENS`, because 350 truncates a think
block mid-stream and re-triggers the silent-pass bug (profiles plan §1.1).

**Do not change those defaults as part of this feature.** Document the tradeoff
and let the operator opt in. MiniMax profiles get thoughts for free.

---

## 5. Dispatch

Rules for every agent: **make the edits, run the tests, do not `git commit` or
`git push`.** File ownership is exclusive.

| # | Agent | Model | Owns (exclusive) | Depends on |
|---|---|---|---|---|
| T1 | `thoughts-core` | Sonnet | `bot-manager/src/thoughts.js` **(new)**, `bot-manager/src/rest.js`, `bot-manager/test/thoughts.test.js` **(new)** | — |
| T2 | `thoughts-capture` | Sonnet | `bot-manager/src/llm/actionLLM.js`, `bot-manager/src/session.js`, `bot-manager/src/director.js`, `bot-manager/test/thoughts-capture.test.js` **(new)** | T1's module API |
| T3 | `thoughts-ui` | Sonnet | `heresy-client/src/components/AdminView.vue`, `heresy-server/src/index.js` (one proxy route) | T1's response shape |
| T4 | `thoughts-docs` | Haiku | `.env.example`, `docs/specs/mechanics/heresy-bot.DRIFT.md` | §4 |

**Wave 1:** T1 alone (defines the API the others import).
**Wave 2:** T2 + T3 + T4 in parallel — disjoint files, contracts frozen by T1.

---

## 6. Acceptance criteria

1. `cd bot-manager && npm test` — **220 pre-existing tests still pass**, plus new.
2. An unauthenticated `GET /thoughts` is rejected; an authed one succeeds.
3. `since=<seq>` returns only newer entries; polling twice with no activity
   returns an empty array (not the whole buffer).
4. The ring buffer is bounded: 10,000 recorded entries leave ≤500 retained and
   every `thought` ≤2,000 chars.
5. `snapshot()` contains no thought text, and no `data/bot-sessions/*.json`
   file gains a thoughts field.
6. A MiniMax-shaped response with `reasoning_content` produces a `thinking`
   entry whose `thought` is that reasoning.
7. A local-shaped response with an inline `<think>` block also produces one.
8. A parse failure + nudge retry produces two `thinking` entries.
9. `npm --prefix heresy-client run build` succeeds.
