# Q-BOT-PROFILES — Selectable bot model backends (local default + MiniMax M2.7 / M3)

**Status:** Plan — not yet dispatched
**Author:** analysis pass, 2026-08-03
**Baseline:** `bot-manager` test suite green at 145/145 on `master` (07875cb)

---

## TL;DR

Today the bot-manager builds **one** LLM client at boot from `OPENAI_*` env and shares it
across every `BotSession`. This plan replaces that with a **profile registry**: a named
bundle of (provider, model, endpoint, sampling, token limits, prompt budget, queue lane,
price) resolved **per spawn**. `local` stays the default and its behaviour must remain
byte-identical. Two new profiles — `minimax-m2.7` and `minimax-m3` — spawn cloud bots that
get much larger prompt budgets and output caps, plus USD cost metering and spend caps.

---

## 1. Why token limits genuinely have to change (not just "nice to have")

The current defaults are all tuned for one machine: a 12 GB-VRAM Qwen3-14B at 8k context.
Point a MiniMax model at them unchanged and you get a bot that **silently passes every turn
while billing you**. Three concrete failures:

### 1.1 `MAX_TOKENS=350` truncates MiniMax mid-thought → guaranteed pass

MiniMax M2.x is a thinking model and, on the native OpenAI-compatible route with
`reasoning_split=false` (the default), the reasoning arrives **inline in `content` wrapped in
`<think>…</think>`**. M2.x also *ignores* `thinking: {type:"disabled"}` — you cannot turn it
off. With a 350-token output cap the generation is cut off inside the think block, and
`stripThink()` (`llm/parseAction.js:19-25`) deliberately drops **everything from an unclosed
`<think>` onward**:

```js
const openIdx = out.search(/<think>/i);
if (openIdx !== -1) out = out.slice(0, openIdx);   // → '' → parse fail
```

`parseActionBlock` returns `null`, `ActionLLM` fires one nudge retry (which truncates the same
way), and the bot returns `{kind:'pass'}` — after two paid calls. This is the single most
important fix in the plan.

### 1.2 `MAX_TOKENS_PER_GAME=200000` is sized for free inference

The comment on `config.js:47` says it outright: *"now counts input too; local inference is
free."* On a paid API that same ceiling is both a real cost and a bad kill-switch — a
big-context MiniMax bot with a scaled prompt budget burns ~20k input tokens per turn and would
hit the ceiling after ~10 turns, mid-game. Cloud profiles need a **USD-denominated** ceiling as
the authoritative one, with the token ceiling raised so it never fires first.

### 1.3 The prompt budget is the whole point of the feature

`prompts/budget.js` caps the volatile user message at ~1,420 tokens (150 state + 200 summary +
150 notes + 800 chat + 120 instruction), `BufferWindow` holds 20 events, `StructuredNotes` 15
keys — all so the whole call fits an 8k window. M2.7 has **204,800** tokens of context and M3
has **1,048,576**. "More extensive bot actions" is exactly this: let the big model see the
entire game — every chat line, every announcement, a longer note ledger — instead of a 6-line
tail. That is a per-profile *scale factor* on the existing budgets, not a rewrite.

---

## 2. External facts this plan is built on

| Fact | Value | Source |
|---|---|---|
| OpenAI-compatible base URL | `https://api.minimax.io/v1` | MiniMax OpenAI-SDK docs |
| Model ids | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M3` | MiniMax API reference |
| Context | M2.7 204,800 · M3 1,048,576 | MiniMax API reference |
| Max output | M2.x rec. 65,536 / hard 204,800 · M3 rec. 131,072 / hard 524,288 | MiniMax API reference |
| `response_format` / `json_schema` | **Not supported on M2.x** (Text-01 only) | MiniMax issue tracker + docs |
| Thinking | inline `<think>` in `content` unless `reasoning_split:true`; M2.x ignores disable | MiniMax OpenAI-SDK docs |
| Recommended sampling | M2.7 `temperature=1.0, top_p=0.95, top_k=40`; M3 `1.0 / 0.95` | MiniMax model cards |
| Rate limits | M2.7 500 RPM / 20M TPM · M3 200 RPM / 10M TPM | MiniMax API reference |
| Price (confirm on your dashboard) | M2.7 ~$0.30/M in, $1.20/M out · M3 same ≤512k input, 2× above | pricing aggregators (they disagree: $0.24/$0.96 also quoted) |
| Ignored params | `presence_penalty`, `frequency_penalty`, `logit_bias` | MiniMax OpenAI-SDK docs |

Two consequences worth calling out:

- **Structured output must be OFF for MiniMax.** `openaiChat.js:95-99` already degrades on a
  400 that mentions `response_format`, so nothing breaks — but it wastes one round-trip per
  fresh client and logs noise. Set it false in the profile.
- **`/no_think` must not be appended for MiniMax.** `assemble.js:55` appends it to the system
  prompt whenever `llmNoThink !== false`. It's a Qwen3 convention; on MiniMax it's junk tokens
  in a cached prefix for a model that can't disable thinking anyway.

**Spec note:** the locked spec `docs/specs/mechanics/heresy-bot.md` v1.0.0 locked the stack on
*"LangChain.js + MiniMax (`MiniMax-M3` model id)"*. The July local-LLM rework drifted away from
that (logged in `heresy-bot.DRIFT.md`). This feature therefore **re-converges** with the locked
spec on model choice while keeping the local runtime as default. The mirror is never edited;
`heresy-bot.DRIFT.md` (no mirror banner — this repo owns it) gets the update.

---

## 3. Design

### 3.1 The profile object

New file `bot-manager/src/llm/profiles.js`. A profile is a frozen plain object; the table is
built once from `config` at import time.

```js
{
  id: 'minimax-m2.7',
  label: 'MiniMax M2.7',
  provider: 'minimax',            // 'local' | 'minimax'
  baseUrl, apiKey, model,
  contextWindow: 204800,
  maxTokens: 4096,                // OUTPUT cap — must fit think block + JSON action
  temperature: 1.0, topP: 0.95,
  structuredOutput: false,
  noThinkSuffix: false,
  budgetScale: 6,                 // multiplies prompts/budget.js BUDGETS
  memoryWindow: 60,               // BufferWindow size
  noteKeys: 40,                   // StructuredNotes cap
  minChatLines: 20,
  timeoutMs: 120000,
  transportRetries: 2,            // OpenAIChat-level
  actionRetries: 1,               // ActionLLM nudge retries
  lane: 'cloud',                  // llm/queue.js lane
  usdPerMTokIn: 0.30, usdPerMTokOut: 1.20,
  costCeilingTokens: 2_000_000,
  costCeilingUsd: 0.50,
  available: Boolean(apiKey)      // false → not spawnable, surfaced in /profiles
}
```

### 3.2 The three profiles

| field | `local` (DEFAULT) | `minimax-m2.7` | `minimax-m3` |
|---|---|---|---|
| model | `OPENAI_MODEL` (`qwen/qwen3-14b`) | `MiniMax-M2.7` | `MiniMax-M3` |
| baseUrl / apiKey | `OPENAI_BASE_URL` / `OPENAI_API_KEY` | `MINIMAX_BASE_URL` / `MINIMAX_API_KEY` | same |
| contextWindow | 8 192 | 204 800 | 1 048 576 |
| **maxTokens (out)** | **350** | **4 096** | **8 192** |
| temperature / topP | 0.7 / 0.9 | 1.0 / 0.95 | 1.0 / 0.95 |
| structuredOutput | **true** | false | false |
| noThinkSuffix | **true** | false | false |
| **budgetScale** | **1** | **6** (~8.5k user msg) | **12** (~17k user msg) |
| memoryWindow / noteKeys | 20 / 15 | 60 / 40 | 120 / 60 |
| minChatLines | 6 | 20 | 40 |
| timeoutMs | 120 000 | 120 000 | 180 000 |
| lane (concurrency) | `local` (1) | `cloud` (3) | `cloud` (3) |
| costCeilingTokens | 200 000 | 2 000 000 | 2 000 000 |
| costCeilingUsd | — (free) | 0.50 | 0.50 |

Every `local` value is **exactly today's value**. That is the invariant the whole plan hangs
on, and there is a test for it (§6).

Rough cost check at these settings: M2.7 turn ≈ 8.5k in + ~2k out ≈ $0.0051; a 4-bot game at
~25 turns/bot ≈ **$0.51**. M3 at scale 12 ≈ $0.012/turn ≈ $1.20/game. The $0.50/bot ceiling
lands just past a full game, which is the right place for a safety net.

### 3.3 Per-session resolution (the structural change)

New `bot-manager/src/llm/registry.js`:

```js
resolveProfile(name)   // name|undefined -> profile object, throws on unknown
llmFor(profileId)      // lazily builds + caches ONE ActionLLM per profile id
listProfiles()         // [{id,label,provider,model,available,contextWindow,costCeilingUsd}]
                       // ← never exposes baseUrl or apiKey
```

- `index.js` stops being the only place an LLM is built; it keeps a default for the restore
  loop and passes `snap.profile` through `llmFor()`.
- `rest.js` `POST /bots` accepts `profile`; unknown → **400**, unavailable (no key) → **409**.
- `BotSession` gains `this.profileId` / `this._profile`, both in the constructor and the
  snapshot, so a restart restores a MiniMax bot as a MiniMax bot.
- A profile with no `baseUrl`/`apiKey` resolves to `PassThroughLLM` — the existing PASSIVE
  contract, per profile instead of globally.

### 3.4 Queue lanes

`llm/queue.js` is a single process-wide FIFO chain, correct for protecting one local GPU. In a
mixed game it becomes head-of-line blocking: a 40-second MiniMax call stalls every local bot
behind it, and vice versa. Change to **named lanes** with a per-lane concurrency limit:

```js
enqueueLLMCall(fn, { lane = 'local' })   // lane 'local' keeps maxConcurrent=1 (today's behaviour)
queueDepth(lane)                          // per-lane; no-arg = total, for back-compat
```

`local` = 1 concurrent (unchanged semantics). `cloud` = `BOT_CLOUD_CONCURRENCY` (default 3),
well under MiniMax's 200–500 RPM. `director.js:104`'s `queueDepth() > 2` backpressure moves
**after** speaker selection so it tests the chosen bot's own lane.

### 3.5 Cost metering

`ActionLLM.generate` currently does `session.tokensUsed += usage.total_tokens`. Split it:

```js
const inTok  = usage.prompt_tokens     ?? estimateTokens(system) + estimateTokens(user);
const outTok = usage.completion_tokens ?? estimateTokens(lastText);
session.tokensUsed += inTok + outTok;
session.costUsd    += (inTok / 1e6) * p.usdPerMTokIn + (outTok / 1e6) * p.usdPerMTokOut;
```

`session._act()`'s budget gate becomes `tokensUsed >= costCeiling || costUsd >= costCeilingUsd`.
Both fields go into `snapshot()` (persistence has no field whitelist — it serialises whatever
`snapshot()` returns, so nothing else to change) and into `GET /bots` for the admin table.

Manager-level guards, checked in `rest.js` on spawn:

- `MAX_CLOUD_BOTS_PER_GAME` (default **2**) — cap cloud bots per conclave.
- `BOT_DAILY_USD_CAP` (default **5.00**) — process-wide rolling 24 h spend; over cap, cloud
  spawns are refused with 409 and the reason is surfaced in the admin panel.

### 3.6 Prompt budget scaling

`prompts/budget.js` exports module constants. Make them functions of a profile:

```js
export function budgetsFor(profile) { /* BASE_BUDGETS × (profile?.budgetScale ?? 1) */ }
export function minChatLinesFor(profile) { /* profile?.minChatLines ?? 6 */ }
```

`assemble.js` reads `session._profile` and threads it through; `noThinkSuffix` replaces the
`_config.llmNoThink` read at line 55, and the system-prompt cache key at lines 31-38 swaps that
term for `profile.id` (a profile change implies a prompt change). `memory.js`'s `BufferWindow`
windowSize and `StructuredNotes.MAX_KEYS` become per-instance, set from the profile in the
`BotSession` constructor — `MAX_KEYS` is a `static`, so it must move to an instance field with
the static kept as the default.

### 3.7 Admin UI

`AdminView.vue` only:

- Spawn form: **Model** `<select>` populated from a new `GET /api/admin/bots/profiles` proxy
  route, defaulting to `local`, with unavailable profiles disabled and labelled *(no API key)*.
- Sessions table: new **Model** column (badge: `LOCAL` neutral / `CLOUD` amber) and a **Cost**
  column (`$0.0412 / $0.50`).
- Banner when any cloud bot is live: *"N cloud bots active — $X.XX spent this game."*
- Existing PASSIVE banner text updated: it currently blames a global `OPENAI_BASE_URL`, which
  is no longer the only reason a bot can be passive.

### 3.8 Security

`MINIMAX_API_KEY` lives **only** in the bot-manager container's env. The browser sends a
profile *name*; the engine proxies the body untouched; the bot-manager maps name → credentials
server-side. `listProfiles()` must never return `baseUrl` or `apiKey`, and `session.inspect()`
must not start returning the profile object — only `profileId`. A grep-based check is part of
the acceptance criteria.

### 3.9 MiniMax thinking handling (the sharp edge)

This is the part most likely to produce a bot that looks alive and does nothing, so it gets its
own contract across three layers.

**Transport — `llm/openaiChat.js`**

- For `provider === 'minimax'` only, send **`reasoning_split: true`**. Reasoning then arrives in
  `reasoning_content` / `reasoning_details` and `content` carries only the final answer — the
  JSON action lands clean instead of buried behind a think block.
- Degrade exactly like the existing `response_format` handling (`openaiChat.js:95-99`): on a 400
  whose message mentions `reasoning_split`, set `_reasoningSplitSupported = false`, delete the
  field, `attempt--`, retry without burning a retry. Permanent for that client's lifetime.
- **Never send `reasoning_split` on the `local` profile** — LM Studio would 400 and we would
  waste a call recovering from a parameter we chose to send.
- Extend the `chat()` return **additively** to `{content, usage, finishReason, reasoningText}`.
  Existing callers destructure `{content, usage}`, so nothing breaks.
- Send `max_completion_tokens` *and* `max_tokens` (same value) for minimax — MiniMax documents
  the former as primary, the latter as legacy. Local keeps `max_tokens` alone.

**Parser — `llm/parseAction.js`, `stripThink()` hardening**

Today's function handles two cases. MiniMax produces four:

1. *Closed* `<think>…</think>` — handled today, keep.
2. *Unclosed* `<think>` (truncated mid-thought) — handled today by dropping from the tag onward.
   Keep: the behaviour is correct, it is just catastrophic at `maxTokens=350` (§1.1).
3. **Orphan `</think>` with no opener** — MiniMax chat templates commonly pre-fill the opening
   tag server-side, so the returned content *starts mid-reasoning* and only the closing tag
   appears. Today `stripThink` leaves the entire reasoning body in place and parsing fails on it.
   Fix: if `</think>` is present with no `<think>` before it, drop everything up to and including
   the **last** `</think>`.
4. *Reasoning containing a draft JSON action.* The fenced fallback already takes the **last**
   ```` ```action ```` block, which is right. The bare-JSON path, though, requires the whole
   string to start `{` and end `}` — after stripping, trailing prose breaks it. Add a
   conservative last-resort scan for the last balanced `{…}` containing a `"kind"` key, tried
   only after the existing two paths fail.

**Orchestrator — `llm/actionLLM.js`**

- The nudge currently echoes `lastText.slice(0, 400)` raw. On MiniMax that is the first 400
  characters of a *thought*, which is noise at best. Echo `stripThink(lastText)` instead; if that
  is empty (all-reasoning or truncated), replace the echo with a fixed line: *"Your previous
  response contained only reasoning and was cut off before the action."*
- When `finishReason === 'length'`, log a distinct `output_truncated` warning (today this failure
  is invisible — it looks like an ordinary parse miss) and switch the nudge to a terse *"Do not
  explain. Emit ONLY the JSON action object."*, which suppresses reasoning on the retry.
- **Keep** the existing behaviour of never appending the assistant turn to `messages` (the nudge
  resets to `[system, user]`). MiniMax requires that a thinking trace, if round-tripped, be
  round-tripped *complete* — so the correct choice for a truncated response is to not include it
  at all. Do not "fix" this into a conventional multi-turn append.
- Reasoning tokens bill as output tokens and are already inside `usage.completion_tokens`, so
  §3.5's cost maths needs no change. If the server also reports
  `completion_tokens_details.reasoning_tokens`, store it on the session as `reasoningTokens` for
  admin visibility only.

**Profile fields this adds:** `reasoningSplit: true` for both MiniMax profiles, `false` for
`local` (alongside the already-specified `noThinkSuffix: false`).

---

## 4. Env vars (all new ones optional; unset = today's behaviour)

```bash
BOT_DEFAULT_PROFILE=local          # local | minimax-m2.7 | minimax-m3
MINIMAX_API_KEY=                   # unset -> MiniMax profiles marked unavailable
MINIMAX_BASE_URL=https://api.minimax.io/v1
MINIMAX_MODEL_M27=MiniMax-M2.7     # override e.g. MiniMax-M2.7-highspeed
MINIMAX_MODEL_M3=MiniMax-M3
MINIMAX_USD_PER_MTOK_IN=0.30       # confirm against your billing dashboard
MINIMAX_USD_PER_MTOK_OUT=1.20
BOT_CLOUD_CONCURRENCY=3
MAX_CLOUD_BOTS_PER_GAME=2
BOT_DAILY_USD_CAP=5.00
BOT_COST_CEILING_USD=0.50          # per bot per game, cloud profiles only
```

`OPENAI_*` keeps driving the `local` profile with no change in meaning.

---

## 5. Coding dispatch

Rules for every agent: **make the edits, run the tests, do not `git commit` and do not
`git push`.** Opus does one consolidated commit after integration verification. File ownership
below is exclusive — no agent touches a file owned by another.

| # | Agent | Model | Owns (exclusive) | Depends on |
|---|---|---|---|---|
| A1 | `profiles-registry` | Sonnet | `src/llm/profiles.js` **(new)**, `src/llm/registry.js` **(new)**, `src/config.js`, `src/index.js`, `src/rest.js`, `test/profiles.test.js` **(new)** | — |
| A2 | `session-cost` | Sonnet | `src/session.js`, `src/llm/actionLLM.js`, `test/cost-accounting.test.js` **(new)** | A1 (`profiles.js` shape) |
| A3 | `minimax-thinking` | Sonnet | `src/llm/openaiChat.js`, `src/llm/parseAction.js`, `test/parseAction.test.js`, `test/fakeOpenAI.js`, `test/thinking.test.js` **(new)** | A1 (`profiles.js` shape) |
| B | `queue-lanes` | Sonnet | `src/llm/queue.js`, `src/director.js`, `test/llm-queue.test.js`, `test/director.test.js` | lane-name contract only |
| C | `prompt-budgets` | Sonnet | `src/prompts/budget.js`, `src/prompts/assemble.js`, `src/memory.js`, `test/prompt-assembly.test.js` | reads `session._profile` (contract) |
| D | `env-docs` | Haiku | `.env.example`, `docker-compose.yml`, `docker-compose.auto.yml`, `docker-compose.manual.yml`, `docs/specs/mechanics/heresy-bot.DRIFT.md` | §4 table |
| E | `admin-ui` | Sonnet | `heresy-client/src/components/AdminView.vue`, `heresy-server/src/index.js` (one proxy route) | A1 (`/profiles` shape) |
| F | `rich-prompts` | Sonnet | `src/prompts/staticRules.js`, `src/prompts/roleBlocks.js` | C |

**Wave 1:** A1 alone (it creates the contract everything else imports).
**Wave 2:** A2 + A3 + B + C + D in parallel (disjoint files, contracts frozen by A1).
**Wave 3:** E + F in parallel.

There is no wave 4 — an earlier draft of this document called F "Phase 4", which was a stray
label from a different numbering scheme. F is the optional-quality tail of wave 3, nothing more.

`llm/actionLLM.js` (A2) imports `stripThink` from `llm/parseAction.js` (A3). The contract is that
`stripThink(text) -> string` keeps its exported name and signature; A3 only changes what it
strips. Neither agent edits the other's file.

### Per-agent briefs

**A1 — profiles + registry.** Build the profile table exactly as §3.2, frozen objects, derived
from `config`. `resolveProfile(undefined)` → `BOT_DEFAULT_PROFILE` → `local`. `llmFor()` caches
one `ActionLLM` per profile id (never rebuild per spawn — `_structuredOutputSupported` is
per-client state that must persist). Wire `rest.js` `POST /bots` to accept `profile`, return
400 unknown / 409 unavailable / 409 over `MAX_CLOUD_BOTS_PER_GAME` or `BOT_DAILY_USD_CAP`; add
`GET /profiles`; add `profile` + `costUsd` to `GET /bots`. `index.js`: restore loop resolves
`snap.profile`. **Do not** change any `local` value.

**A2 — session + cost.** Add `profileId`/`_profile` to the constructor, restore path, and
`snapshot()`. Implement the usage split and `costUsd` in `actionLLM.js` per §3.5, extend the
budget gate in `_act()`, pass `{lane: profile.lane}` to `enqueueLLMCall`. Apply the
`actionLLM.js` half of §3.9 (stripped nudge echo, `finishReason === 'length'` handling, do
**not** convert the nudge to a multi-turn append).

**A3 — MiniMax thinking.** Implement §3.9's transport and parser halves: `reasoning_split` with
permanent 400-fallback (mirroring the `response_format` pattern already in the file, never sent
on `local`), additive `{finishReason, reasoningText}` on the `chat()` return,
`max_completion_tokens` for minimax, and the four `stripThink`/`parseActionBlock` cases. Extend
`fakeOpenAI.js` with think-tag scripting (closed, unclosed/truncated, orphan closer) and a
`supportsReasoningSplit` flag. The existing `parseAction.test.js` assertions must keep passing.

**B — queue lanes.** Rewrite `queue.js` to a `Map<lane, {tail, depth, maxConcurrent}>`.
`lane:'local'` must remain a strict FIFO chain of concurrency 1 — the existing
`llm-queue.test.js` ordering assertions must pass unmodified. Add lane tests. In `director.js`,
move the backpressure check after speaker selection and key it on the chosen session's lane.

**C — prompt budgets.** Convert `BUDGETS`/`MIN_CHAT_LINES` to `budgetsFor(profile)` /
`minChatLinesFor(profile)` keeping the current values as the scale-1 base. Thread the profile
through `assemble.js`; swap the `/no_think` condition to `profile.noThinkSuffix` and the cache
key term to `profile.id`. Make `BufferWindow.windowSize` and `StructuredNotes` key cap
per-instance (keep the statics as defaults). Add tests asserting scale-1 output is unchanged
and scale-6 keeps ~6× the chat lines.

**D — env + docs.** Mechanical: add §4's vars to `.env.example` (in the existing bot block,
same comment style) and to the `heresy-bot-manager` service in all three compose files. Append
a *"MiniMax profile support (2026-08)"* section to `heresy-bot.DRIFT.md` noting the partial
re-convergence with the v1.0.0 locked stack. **Do not edit `docs/specs/mechanics/heresy-bot.md`
— it is a locked mirror.**

**E — admin UI.** §3.7. Read the profile list from the new proxy route; never hardcode model
ids in the client.

**F — rich prompts.** Add `STATIC_RULES_FULL` / full role blocks restored from the locked
mirror's Block 1 / role-block text, selected when `profile.richPrompt` is true (cloud profiles
only). Source text comes **from** the mirror; the mirror itself is not edited. The compressed
`STATIC_RULES` / `ROLE_BLOCKS` exports must remain untouched — `local` keeps them verbatim.

---

## 6. Acceptance criteria

1. `cd bot-manager && npm test` — **145 pre-existing tests still pass**, plus new ones.
2. **Local-invariance test:** with no new env set, `assembleMessages()` for a `local` bot
   returns a string byte-identical to `master`'s output for the same fixture session, and the
   `OpenAIChat` payload has the same `model`/`temperature`/`max_tokens`/`top_p`/
   `response_format` as `master`. This is the guardrail for "local stays the default."
3. Spawning with no `profile` yields `local`. Spawning `minimax-m2.7` without `MINIMAX_API_KEY`
   → 409, not a silent PASSIVE bot.
4. **Thinking suite (§3.9)** — a fake-OpenAI script that emits a *truncated unclosed* `<think>`
   proves the §1.1 failure exists at `maxTokens=350` and does not occur at the profile's cap;
   plus: closed block parses, **orphan `</think>` parses**, a 400 on `reasoning_split` falls back
   permanently and still yields an action, `finish_reason:'length'` produces the terse nudge, and
   a `local`-profile payload **never** contains `reasoning_split`.
5. `grep -rn "MINIMAX_API_KEY\|apiKey" bot-manager/src/rest.js heresy-server/src heresy-client/src`
   returns no path that can serialise a key to an HTTP response.
6. Mixed game: one `local` + one `minimax-m2.7` bot in one conclave; the local bot's turn is not
   blocked behind the cloud bot's in-flight call.
7. `npm --prefix heresy-client run build` succeeds.
8. Cost column moves during a live game and the bot stops acting at `costCeilingUsd`.

---

## 7. Open questions for the designer

1. **Price constants** — aggregators disagree ($0.30/$1.20 vs $0.24/$0.96 per M tokens). Defaults
   above are the conservative pair; confirm against the MiniMax billing dashboard, or leave the
   env overrides to absorb it.
2. **`budgetScale` 6 / 12** are first estimates. A cheaper opening position is 4 / 8; the knob is
   per-profile and env-overridable either way.
3. **`MiniMax-M2.7-highspeed`** — worth exposing as a fourth profile? Same context and price
   class, lower latency, which matters for chat pacing.
4. **Per-bot model mixing** is allowed by this design (each seat picks its own profile). Confirm
   that's wanted rather than one model per conclave.
5. **Phase 4 (F)** changes how bots reason. Ship it, or hold until the M2.7 path has been
   playtested at the compressed prompt?
