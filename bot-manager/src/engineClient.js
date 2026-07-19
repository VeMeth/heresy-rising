import crypto from 'node:crypto';

// Wraps heresy-server's control HTTP endpoints (/api/bots/spawn and
// /api/bots/despawn). The bot manager is the caller; we authenticate to the
// engine with BOT_API_KEY (engine-side bearer).
export class EngineClient {
  constructor({ baseUrl, botApiKey } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.botApiKey = botApiKey || '';
  }

  _headers() {
    return { 'Authorization': `Bearer ${this.botApiKey}`, 'Content-Type': 'application/json' };
  }

  // Reserves a lobby seat on the engine for a bot. Returns the engine's
  // {playerCode, seat, isBot, name, conclaveCode}.
  async spawn({ conclaveCode, name, seatHint = null }) {
    const res = await fetch(`${this.baseUrl}/api/bots/spawn`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ conclaveCode, name, seatHint })
    });
    const body = await this._parse(res);
    if (!res.ok) throw this._error('spawn', res, body);
    return body;
  }

  // Removes a bot's seat from the lobby.
  async despawn({ conclaveCode, playerCode }) {
    const res = await fetch(`${this.baseUrl}/api/bots/despawn`, {
      method: 'DELETE',
      headers: this._headers(),
      body: JSON.stringify({ conclaveCode, playerCode })
    });
    const body = await this._parse(res);
    if (!res.ok) throw this._error('despawn', res, body);
    return body;
  }

  async _parse(res) {
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  _error(op, res, body) {
    const err = new Error(body?.error || `${op} failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    return err;
  }
}

// Lazy unique-id helper for any manager-side records not driven by playerCode.
export function shortId() {
  return crypto.randomBytes(8).toString('hex');
}