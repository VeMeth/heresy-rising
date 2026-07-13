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
  adminPassword: process.env.ADMIN_PASSWORD || 'BD-admin-default-7d2f940c9d0a4b0fa3e61b787c6b21a9-change-me',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  cors: {
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS)
  },
  rateLimit: {
    windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.RATE_LIMIT_MAX, 120),
    standardHeaders: true,
    legacyHeaders: false
  }
};
