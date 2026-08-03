// Bot model profiles — a named bundle of (provider, endpoint, sampling, token
// limits, prompt budget, queue lane, price) resolved per bot spawn. `local`
// is the default and its values are byte-identical to the pre-profile
// hardcoded behaviour (see the CRITICAL comment below) — everything that
// consumed OPENAI_* env vars directly keeps working unchanged.
//
// The table is built ONCE from `config` at import time and every profile
// object is frozen — profiles are read-only facts, not per-request state.
// Per-client mutable state (e.g. OpenAIChat's `_structuredOutputSupported`
// flag once a 400 teaches it structured output isn't supported) lives on the
// ActionLLM/OpenAIChat instance that registry.js caches per profile id, never
// on the profile object itself.
import { config } from '../config.js';

function freezeProfile(p) { return Object.freeze({ ...p }); }

// CRITICAL INVARIANT (plan §3.2 / §6.2): every value below must equal
// today's pre-profile behaviour exactly. There is a test
// (test/profiles.test.js) pinning this. If you touch this block, the local
// profile must still resolve to the same maxTokens/temperature/topP/
// structuredOutput/noThinkSuffix/timeoutMs/lane a `local` bot got before
// profiles existed — those values are what OPENAI_* env vars have always
// driven, and OPENAI_* keeps driving them with unchanged meaning.
const LOCAL_PROFILE = freezeProfile({
  id: 'local',
  label: 'Local',
  provider: 'local',
  baseUrl: config.openaiBaseUrl,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  contextWindow: 8192,
  maxTokens: config.maxTokens,               // MAX_TOKENS, default 350
  temperature: config.llmTemperature,        // LLM_TEMPERATURE, default 0.7
  topP: config.topP,                         // TOP_P, default 0.9
  structuredOutput: config.llmStructuredOutput, // LLM_STRUCTURED_OUTPUT, default true
  noThinkSuffix: config.llmNoThink,          // LLM_NO_THINK, default true
  reasoningSplit: false,                     // never sent on local — LM Studio would 400 (§3.9)
  // Compressed STATIC_RULES/ROLE_BLOCKS (~535 tok + ~150-300 tok/role). The
  // full spec text only fits a big-context profile; local keeps the
  // 8k-budget compression it was written for.
  richPrompt: false,
  // No 'thinking' entries in the admin thoughts feed for local bots: /no_think
  // at a 350-token cap means there is no reasoning worth showing, and emitting
  // a thought-less entry per call would evict real content from the shared
  // 500-entry ring. Local bots still show their ACTIONS in the feed.
  captureThoughts: false,
  budgetScale: 1,
  // Chat/justification trim length. Deliberately the SAME on every profile:
  // this is about game feel — a social-deduction table where humans type one
  // or two lines — not about what the model is capable of. ~40 words.
  maxChatChars: 400,
  memoryWindow: 20,
  noteKeys: 15,
  minChatLines: 6,
  timeoutMs: config.llmTimeoutMs,            // LLM_TIMEOUT_MS, default 120000
  transportRetries: config.maxRetries,       // MAX_RETRIES — index.js passed this to both
  actionRetries: config.maxRetries,          // OpenAIChat and ActionLLM identically before profiles
  lane: 'local',
  // Local inference is free: zero per-token price and no USD ceiling — the
  // budget gate must never fire on cost for this profile, only on
  // costCeilingTokens (today's MAX_TOKENS_PER_GAME behaviour, unchanged).
  usdPerMTokIn: 0,
  usdPerMTokOut: 0,
  costCeilingTokens: config.maxTokensPerGame, // MAX_TOKENS_PER_GAME, default 200000
  costCeilingUsd: Infinity,
  // Matches today's hasLLMConfig(): unset OPENAI_BASE_URL => PassThroughLLM.
  available: Boolean(config.openaiBaseUrl)
});

const MINIMAX_M27_PROFILE = freezeProfile({
  id: 'minimax-m2.7',
  label: 'MiniMax M2.7',
  provider: 'minimax',
  baseUrl: config.minimaxBaseUrl,
  apiKey: config.minimaxApiKey,
  model: config.minimaxModelM27,
  contextWindow: 204800,
  maxTokens: 4096,
  temperature: 1.0,
  topP: 0.95,
  structuredOutput: false,       // response_format/json_schema unsupported on M2.x (§2)
  noThinkSuffix: false,          // /no_think is a Qwen3 convention, junk tokens on MiniMax
  reasoningSplit: true,          // keep <think> out of `content` (§3.9)
  richPrompt: true,              // restored full rules/role text — the context is there for it
  // Sized so a WHOLE game fits, not to fill the context window. recentChat's
  // base budget is 800 tok, so scale 12 gives ~9.6k tok of chat — more than a
  // full Conclave produces (12 players, bots capped at 3 msgs/phase). Past
  // that point eviction stops binding and further scale buys nothing but
  // latency, which is the real cost on a token plan.
  captureThoughts: true,   // full reasoning capture — this is the model that has something to say
  budgetScale: 12,
  maxChatChars: 400,   // same as local — game feel, not model capability
  memoryWindow: 120,
  noteKeys: 40,
  minChatLines: 40,
  timeoutMs: 120000,
  transportRetries: 2,
  actionRetries: 1,
  lane: 'cloud',
  usdPerMTokIn: config.minimaxUsdPerMTokIn,
  usdPerMTokOut: config.minimaxUsdPerMTokOut,
  costCeilingTokens: 2_000_000,  // raised well above the USD ceiling so USD fires first (§1.2)
  costCeilingUsd: config.botCostCeilingUsd,
  available: Boolean(config.minimaxApiKey)
});

const MINIMAX_M3_PROFILE = freezeProfile({
  id: 'minimax-m3',
  label: 'MiniMax M3',
  provider: 'minimax',
  baseUrl: config.minimaxBaseUrl,
  apiKey: config.minimaxApiKey,
  model: config.minimaxModelM3,
  contextWindow: 1_048_576,
  maxTokens: 8192,
  temperature: 1.0,
  topP: 0.95,
  structuredOutput: false,
  noThinkSuffix: false,
  reasoningSplit: true,
  // Same "whole game fits" reasoning as M2.7, with headroom for an unusually
  // long Conclave — M3's 1M context means there's no reason to be tight, but
  // there's also no gain past the point where nothing gets evicted.
  captureThoughts: true,   // full reasoning capture — this is the model that has something to say
  budgetScale: 20,
  maxChatChars: 400,   // same as local — game feel, not model capability
  memoryWindow: 200,
  noteKeys: 60,
  minChatLines: 60,
  timeoutMs: 180000,
  transportRetries: 2,
  actionRetries: 1,
  lane: 'cloud',
  usdPerMTokIn: config.minimaxUsdPerMTokIn,
  usdPerMTokOut: config.minimaxUsdPerMTokOut,
  costCeilingTokens: 2_000_000,
  costCeilingUsd: config.botCostCeilingUsd,
  available: Boolean(config.minimaxApiKey)
});

// Keyed by profile id — the lookup registry.js resolves spawn requests
// against. Frozen so nothing downstream can accidentally mutate a shared
// profile object (they're shared by every session that picks that profile).
export const PROFILES = Object.freeze({
  local: LOCAL_PROFILE,
  'minimax-m2.7': MINIMAX_M27_PROFILE,
  'minimax-m3': MINIMAX_M3_PROFILE
});

export const DEFAULT_PROFILE_ID = 'local';
