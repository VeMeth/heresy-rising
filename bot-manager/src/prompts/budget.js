// prompts/budget.js — token-budget accounting and eviction for the volatile
// user-turn message. The base numbers below are calibrated for a 12 GB-VRAM
// Qwen3-14B at 8k context (the `local` profile, scale 1) — logged
// `usage.prompt_tokens` from a live run; len/3.5 is a starting point for the
// Qwen3 tokenizer — recalibrate CHARS_PER_TOKEN here if live usage drifts
// from the estimate.
//
// A cloud profile (MiniMax M2.7/M3) has 204,800 / 1,048,576 tokens of
// context — tens to hundreds of times the local budget. Rather than a
// second hardcoded budget table, each profile carries a `budgetScale`
// (local 1, m2.7 6, m3 12) that multiplies every entry in BASE_BUDGETS
// uniformly, so a big-context bot sees proportionally more of the game
// (state digest, rolling summary, notes, chat) instead of the same 8k-sized
// tail. `budgetsFor`/`minChatLinesFor` are the profile-aware path;
// `BUDGETS`/`MIN_CHAT_LINES` remain as the scale-1 constants so existing
// importers (and the local-invariance guardrail) are untouched.
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / CHARS_PER_TOKEN);
}

// Base (scale-1 / `local`) budgets in estimated tokens. Kept as the literal
// values the whole feature's local-invariance guarantee is measured against
// — do not change these without also updating the local-profile row in
// BOT_MODEL_PROFILES_PLAN.md §3.2.
//
// `phaseSummaries` is the second tier of long-term memory (alongside
// `rollingSummary`) — the LLM-generated end-of-phase recaps written by
// ActionLLM.consolidate() and stored in session.phaseSummaries. Empty for
// local profiles (they don't consolidate), so this budget is dead weight at
// scale 1 by design — the cloud profiles see it scaled up to ~9.6k / ~16k
// tokens, enough for a complete game's recap.
const BASE_BUDGETS = {
  stateDigest: 150,
  rollingSummary: 200,
  phaseSummaries: 800,
  notes: 150,
  recentChat: 800,
  turnInstruction: 120
};
const BASE_MIN_CHAT_LINES = 6;

// Back-compat exports: the scale-1 constants, used by anything that hasn't
// been threaded onto a profile (and by tests asserting local behaviour is
// unchanged).
export const BUDGETS = BASE_BUDGETS;
export const MIN_CHAT_LINES = BASE_MIN_CHAT_LINES;

// Profile-scaled budgets. `profile?.budgetScale` defaults to 1 (the `local`
// value) so a missing/undefined profile — e.g. a session built before
// per-profile resolution landed, or a bare fixture in a test — falls back
// to exactly today's numbers.
export function budgetsFor(profile) {
  const scale = profile?.budgetScale ?? 1;
  const out = {};
  for (const [key, value] of Object.entries(BASE_BUDGETS)) out[key] = Math.round(value * scale);
  return out;
}

export function minChatLinesFor(profile) {
  return profile?.minChatLines ?? BASE_MIN_CHAT_LINES;
}

// Trims an array of rendered lines (oldest first) to fit a token budget,
// dropping from the front (oldest) but always keeping at least `minKeep`
// entries from the end (recent chat's "min N kept" rule, N scaled per
// profile via minChatLinesFor).
export function fitLines(lines, budgetTokens, { minKeep = 0 } = {}) {
  const kept = lines.slice();
  while (kept.length > minKeep && estimateTokens(kept.join('\n')) > budgetTokens) {
    kept.shift();
  }
  return kept;
}

// Hard clamp for text that already carries its own internal cap (e.g.
// RollingSummary's own MAX_LINES) — a last-resort safety net, keeping the
// most recent (tail) content since older content is less relevant.
//
// NOTE: CHARS_PER_TOKEN is calibrated for the Qwen3 tokenizer used by the
// `local` profile. MiniMax uses a different tokenizer, so for cloud
// profiles this estimate is deliberately approximate — it exists only to
// size the *prompt budget* (how much text to keep), never to bill or to
// enforce a hard token ceiling. Real cost/usage accounting reads the API's
// actual `usage` object (see actionLLM.js), not this estimate.
export function fitToBudget(text, budgetTokens) {
  if (estimateTokens(text) <= budgetTokens) return text;
  const maxChars = Math.floor(budgetTokens * CHARS_PER_TOKEN);
  return text.slice(-maxChars);
}
