// Per-session LLM resolution. Where index.js used to build ONE LLM client at
// boot from OPENAI_* env and share it across every BotSession, spawns now
// pick a *profile* (llm/profiles.js) and resolve it to a client here.
//
// llmFor() caches one ActionLLM per profile id and never rebuilds it — that
// matters because OpenAIChat carries per-client mutable state
// (`_structuredOutputSupported`, and A3's forthcoming
// `_reasoningSplitSupported`) learned from a 400 response and meant to
// persist for that client's lifetime. Rebuilding per spawn would silently
// re-probe (and re-fail) that negotiation on every bot.
import { config } from '../config.js';
import { PROFILES, DEFAULT_PROFILE_ID } from './profiles.js';
import { PassThroughLLM } from './passthroughLLM.js';
import { OpenAIChat } from './openaiChat.js';
import { ActionLLM } from './actionLLM.js';

// name|undefined|null|'' -> BOT_DEFAULT_PROFILE -> 'local'. Throws on an
// unknown name so callers (rest.js) can turn that into a 400.
export function resolveProfile(name) {
  const id = name || config.botDefaultProfile || DEFAULT_PROFILE_ID;
  const profile = PROFILES[id];
  if (!profile) {
    const err = new Error(`Unknown bot profile: ${id}`);
    err.code = 'UNKNOWN_PROFILE';
    err.profileId = id;
    throw err;
  }
  return profile;
}

// One ActionLLM (or PassThroughLLM for an unavailable profile) per profile
// id, built lazily on first use and cached forever after.
const _llmCache = new Map();

export function llmFor(profileId) {
  // Route through resolveProfile so an empty/undefined profileId falls back
  // to BOT_DEFAULT_PROFILE (and 'local' beyond that) the same way a spawn
  // request would, rather than hardcoding 'local' here independently.
  const profile = resolveProfile(profileId);
  const id = profile.id;
  if (_llmCache.has(id)) return _llmCache.get(id);

  let llm;
  if (!profile.available) {
    // No baseUrl (local) / no apiKey (minimax) — same PASSIVE contract as
    // the old global hasLLMConfig() gate, just per profile instead of
    // process-wide.
    llm = new PassThroughLLM();
  } else {
    try {
      const chat = new OpenAIChat({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
        topP: profile.topP,
        timeoutMs: profile.timeoutMs,
        maxRetries: profile.transportRetries,
        structuredOutput: profile.structuredOutput,
        // Forward-compatible with A3's openaiChat.js work: today's
        // constructor ignores unknown params harmlessly, so passing these
        // ahead of that landing is safe either way.
        reasoningSplit: profile.reasoningSplit,
        provider: profile.provider
      });
      llm = new ActionLLM({ chatModel: chat, maxRetries: profile.actionRetries });
      console.info(`[bot-manager] LLM profile ready: ${profile.id} (${chat.model} via ${profile.baseUrl})`);
    } catch (e) {
      console.warn(`[bot-manager] LLM profile ${profile.id} init failed; falling back to PassThroughLLM:`, e.message);
      llm = new PassThroughLLM();
    }
  }
  _llmCache.set(id, llm);
  return llm;
}

// Public, credential-free profile listing for GET /profiles and the admin
// spawn form. MUST NEVER include baseUrl or apiKey (plan §3.8 security
// requirement) — MINIMAX_API_KEY lives only in this process's env and the
// browser only ever sees a profile *name*.
export function listProfiles() {
  return Object.values(PROFILES).map((p) => ({
    id: p.id,
    label: p.label,
    provider: p.provider,
    model: p.model,
    available: p.available,
    contextWindow: p.contextWindow,
    costCeilingUsd: p.costCeilingUsd
  }));
}

// Test-only: clear the cached-client map so tests that mutate `config` (e.g.
// setting MINIMAX_API_KEY) or re-import profiles don't see a stale client
// from an earlier test's cache.
export function _resetLLMCacheForTests() { _llmCache.clear(); }

// --- Rolling 24h spend accumulator (plan §3.5 BOT_DAILY_USD_CAP guard) ---
//
// A2's session/actionLLM cost-accounting work calls recordSpend() as each
// paid call completes; rest.js queries spentLast24h() on every cloud spawn
// to enforce BOT_DAILY_USD_CAP. Deliberately a flat in-memory log rather than
// a persisted ledger — a manager restart resetting the daily counter is an
// acceptable trade for not needing a spend-history store.
const _spendLog = [];
const DAY_MS = 24 * 60 * 60 * 1000;

export function recordSpend(usd) {
  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount <= 0) return;
  _spendLog.push({ ts: Date.now(), usd: amount });
}

export function spentLast24h() {
  const cutoff = Date.now() - DAY_MS;
  while (_spendLog.length && _spendLog[0].ts < cutoff) _spendLog.shift();
  let total = 0;
  for (const entry of _spendLog) total += entry.usd;
  return total;
}

// Test-only: clear the spend log between tests.
export function _resetSpendForTests() { _spendLog.length = 0; }
