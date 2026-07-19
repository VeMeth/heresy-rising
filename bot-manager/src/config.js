import dotenv from 'dotenv';
dotenv.config();

function parseNum(value, defaultValue) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
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

  // MiniMax + LangChain runtime.
  miniMaxApiKey: process.env.MiniMax_API_KEY || '',
  miniMaxModel: process.env.MiniMax_MODEL || 'MiniMax-M3',
  miniMaxBaseUrl: process.env.MiniMax_BASE_URL || 'https://api.minimax.io',

  // Per-manager caps and tuning.
  maxBotSessions: parseNum(process.env.MAX_BOT_SESSIONS, 12),
  maxBotsPerGame: parseNum(process.env.MAX_BOTS_PER_GAME, 4),
  llmTimeoutMs: parseNum(process.env.LLM_TIMEOUT_MS, 30000),
  llmTemperature: parseNum(process.env.LLM_TEMPERATURE, 0.7),
  maxTokens: parseNum(process.env.MAX_TOKENS, 512),
  topP: parseNum(process.env.TOP_P, 0.9),
  maxTokensPerGame: parseNum(process.env.MAX_TOKENS_PER_GAME, 50000),
  botActionDelayMs: parseNum(process.env.BOT_ACTION_DELAY_MS, 10000),
  chatDebounceMs: parseNum(process.env.CHAT_DEBOUNCE_MS, 2000),
  maxRetries: parseNum(process.env.MAX_RETRIES, 2),
  langChainTracing: parseBool(process.env.LANGCHAIN_TRACING, false)
};

// Required before any spawn/despawn may succeed. The control endpoints accept
// either ADMIN_API_KEY or SIM_BYPASS_TOKEN; at least one must be set.
export function hasControlAuth(cfg = config) {
  return !!(cfg.adminApiKey || cfg.simBypassToken);
}

// Required before the LLM stack will run.
export function hasLLMConfig(cfg = config) {
  return !!cfg.miniMaxApiKey;
}

//NODE compat check
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) console.warn(`[bot-manager] WARN: Node ${process.versions.node} detected. Node 20+ required.`);