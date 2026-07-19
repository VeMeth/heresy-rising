import crypto from 'node:crypto';

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Accept either ADMIN_API_KEY (admin panel, proxied from heresy-server) or
// SIM_BYPASS_TOKEN (sim/test harness direct). Both arrive as a Bearer token.
// `/health` is open and does not go through this middleware.
export function requireManagerAuth(config) {
  return function managerAuth(req, res, next) {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(403).json({ error: 'Bearer token required' });
    if (config.adminApiKey && constantTimeEquals(token, config.adminApiKey)) return next();
    if (config.simBypassToken && constantTimeEquals(token, config.simBypassToken)) return next();
    return res.status(403).json({ error: 'Unknown or missing token' });
  };
}