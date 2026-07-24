// prompts/budget.js — token-budget accounting and eviction for the volatile
// user-turn message. Calibrated against logged `usage.prompt_tokens` from a
// live run; len/3.5 is a starting point for the Qwen3 tokenizer — recalibrate
// CHARS_PER_TOKEN here if live usage drifts from the estimate.
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / CHARS_PER_TOKEN);
}

export const BUDGETS = {
  stateDigest: 150,
  rollingSummary: 200,
  notes: 150,
  recentChat: 800,
  turnInstruction: 120
};
export const USER_MESSAGE_TARGET_TOKENS = 3000;
export const MIN_CHAT_LINES = 6;

// Trims an array of rendered lines (oldest first) to fit a token budget,
// dropping from the front (oldest) but always keeping at least `minKeep`
// entries from the end (recent chat's "min 6 kept" rule).
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
export function fitToBudget(text, budgetTokens) {
  if (estimateTokens(text) <= budgetTokens) return text;
  const maxChars = Math.floor(budgetTokens * CHARS_PER_TOKEN);
  return text.slice(-maxChars);
}
