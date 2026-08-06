import dotenv from 'dotenv';

dotenv.config();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export const DEFAULT_ADMIN_PASSWORD = 'BD-admin-default-7d2f940c9d0a4b0fa3e61b787c6b21a9-change-me';

function parseOrigins(value) {
  if (!value) {
    // No origins configured — fail safe rather than defaulting to permissive localhost
    return [];
  }
  if (value.trim() === '*') {
    return '*';
  }
  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function parseCodeList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(code => code.trim())
    .filter(Boolean);
}

export const config = {
  port: parseNumber(process.env.SERVER_PORT || process.env.PORT, 4100),
  adminPassword: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  cors: {
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS)
  },
  // Hidden admin/testing identity allowlist (see .env.example) — a soft gate,
  // not a real access-control boundary. Empty by default = fully inert.
  adminPlayerCodes: new Set(parseCodeList(process.env.ADMIN_PLAYER_CODES)),
  rateLimit: {
    windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.RATE_LIMIT_MAX, 120),
    standardHeaders: true,
    legacyHeaders: false
  },
  // Bot manager wiring. The manager is a separate container that listens on :7878
  // and is reached at BOT_MANAGER_URL. ADMIN_API_KEY is the bearer token the
  // *panel/proxy* presents to the manager; BOT_API_KEY is what the *manager*
  // presents to us when reserving a Conclave seat; SIM_BYPASS_TOKEN is reserved
  // for the sim/test harness talking directly to the manager.
  botManager: {
    url: process.env.BOT_MANAGER_URL || 'http://127.0.0.1:7878',
    botApiKey: process.env.BOT_API_KEY || '',
    adminApiKey: process.env.ADMIN_API_KEY || '',
    simBypassToken: process.env.SIM_BYPASS_TOKEN || ''
  },
  // Heresy Sim wiring (Phase 2). The simulator is a third sibling container
  // that listens on :7879 and is reached at HERESY_SIM_URL. SIM_BYPASS_TOKEN
  // is the bearer token *we* present to it on the proxy hop — the same
  // secret provisioned above for bot-manager's own use, shared across both
  // consumers per the locked v1.1.0 spec. Two independent caller-facing caps
  // (host preview vs admin batch) and a per-lobby cooldown for the host path
  // live here too, so index.js's socket/REST handlers don't hardcode them.
  sim: {
    url: process.env.HERESY_SIM_URL || 'http://heresy-sim:7879',
    bypassToken: process.env.SIM_BYPASS_TOKEN || '',
    maxGamesHost: parseNumber(process.env.SIM_MAX_GAMES_HOST, 100),
    maxGamesAdmin: parseNumber(process.env.SIM_MAX_GAMES_ADMIN, 500),
    hostCooldownMs: parseNumber(process.env.SIM_HOST_COOLDOWN_MS, 60_000),
    fetchTimeoutMs: parseNumber(process.env.SIM_FETCH_TIMEOUT_MS, 30_000)
  }
};

const ADMIN_API_KEY_DEFAULT = '';
export function isDefaultAdminApiKey() {
  return !process.env.ADMIN_API_KEY || config.botManager.adminApiKey === ADMIN_API_KEY_DEFAULT;
}

// A never-set or still-default admin password must never grant access in production.
export function isDefaultAdminPassword() {
  return !process.env.ADMIN_PASSWORD || config.adminPassword === DEFAULT_ADMIN_PASSWORD;
}
