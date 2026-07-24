import dotenv from 'dotenv';
dotenv.config();

function parseNum(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

export const config = {
  // Engine (heresy-server) the bots connect to. Inside docker-compose this is
  // the service name; on the host it defaults to localhost.
  heresyGameHost: process.env.HERESY_GAME_HOST || 'http://127.0.0.1:4100',
  heresyBotPort: parseNum(process.env.HERESY_BOT_PORT, 7878),

  // Three distinct secrets, all per the v1.1.0 spec:
  //   BOT_API_KEY      — manager ↔ engine HTTP calls (reserve/despawn seats)
  //   ADMIN_API_KEY    — admin panel / proxy path (we accept this for control)
  //   SIM_BYPASS_TOKEN — sim/test harness direct path
  botApiKey: process.env.BOT_API_KEY || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  simBypassToken: process.env.SIM_BYPASS_TOKEN || '',

  // Generic OpenAI-compatible runtime (LM Studio / vLLM / llama.cpp server /
  // OpenAI itself). No default base URL: unset => PassThroughLLM (PASSIVE
  // mode) — same contract as before. LM Studio example:
  // OPENAI_BASE_URL=http://host.docker.internal:1234/v1
  openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'qwen/qwen3-14b',
  llmTimeoutMs: parseNum(process.env.LLM_TIMEOUT_MS, 120000),
  llmTemperature: parseNum(process.env.LLM_TEMPERATURE, 0.7),
  maxTokens: parseNum(process.env.MAX_TOKENS, 350),
  topP: parseNum(process.env.TOP_P, 0.9),
  llmNoThink: parseBool(process.env.LLM_NO_THINK, true),
  llmStructuredOutput: parseBool(process.env.LLM_STRUCTURED_OUTPUT, true),
  maxRetries: parseNum(process.env.MAX_RETRIES, 2),

  // Per-manager caps and tuning.
  maxBotSessions: parseNum(process.env.MAX_BOT_SESSIONS, 12),
  maxBotsPerGame: parseNum(process.env.MAX_BOTS_PER_GAME, 4),
  maxTokensPerGame: parseNum(process.env.MAX_TOKENS_PER_GAME, 200000), // now counts input too; local inference is free
  botActionDelayMs: parseNum(process.env.BOT_ACTION_DELAY_MS, 5000),

  // Conversation director tuning (director.js) — central turn-taking for
  // public day chat, replacing the old per-bot reactive debounce.
  directorTickMs: parseNum(process.env.DIRECTOR_TICK_MS, 4000),
  botMinChatGapMs: parseNum(process.env.BOT_MIN_CHAT_GAP_MS, 25000),
  botChatPerPhaseMax: parseNum(process.env.BOT_CHAT_PER_PHASE_MAX, 3),
  botIntroGapMs: parseNum(process.env.BOT_INTRO_GAP_MS, 12000),
  botReactiveThreshold: parseNum(process.env.BOT_REACTIVE_THRESHOLD, 1.0),
  botFactionChat: parseBool(process.env.BOT_FACTION_CHAT, false)
};

// Required before any spawn/despawn may succeed. The control endpoints accept
// either ADMIN_API_KEY or SIM_BYPASS_TOKEN; at least one must be set.
export function hasControlAuth(cfg = config) {
  return !!(cfg.adminApiKey || cfg.simBypassToken);
}

// Required before the LLM stack will run (otherwise PassThroughLLM/PASSIVE).
export function hasLLMConfig(cfg = config) {
  return !!cfg.openaiBaseUrl;
}

//NODE compat check
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) console.warn(`[bot-manager] WARN: Node ${process.versions.node} detected. Node 20+ required.`);
