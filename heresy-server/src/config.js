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

export const config = {
  port: parseNumber(process.env.SERVER_PORT || process.env.PORT, 4100),
  adminPassword: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  cors: {
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS)
  },
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
