import { requireManagerAuth } from './auth.js';
import { BotSession } from './session.js';

// All non-/health endpoints are auth-gated. The router is mounted under '/'
// and each route individually calls the auth middleware — keeping /health open.
export function registerRestRoutes(app, sessionStore, engineClient, config) {
  const auth = requireManagerAuth(config);

  function getSessionOrThrow(req, res) {
    const id = req.params.id;
    const s = sessionStore.get(id);
    if (!s) { res.status(404).json({ error: 'Bot session not found' }); return null; }
    return s;
  }

  // POST /bots — spawn a new bot session.
  app.post('/bots', auth, async (req, res) => {
    try {
      if (!req.body || !req.body.conclaveCode) return res.status(400).json({ error: 'conclaveCode is required' });
      if (sessionStore.count() >= config.maxBotSessions) return res.status(503).json({ error: `MAX_BOT_SESSIONS (${config.maxBotSessions}) reached` });
      const { conclaveCode, seatHint, name, personaOverrides, costCeiling } = req.body;
      let spawn;
      try {
        spawn = await engineClient.spawn({ conclaveCode, name, seatHint });
      } catch (e) {
        return res.status(e.status || 502).json({ error: e.message, detail: e.body });
      }
      // Enforce per-conclave cap locally too (avoid spamming the engine).
      const inConclave = sessionStore.list().filter((s) => s.conclaveCode === conclaveCode).length;
      if (inConclave >= config.maxBotsPerGame) {
        // Try to roll back the seat reservation.
        try { await engineClient.despawn({ conclaveCode, playerCode: spawn.playerCode }); } catch {}
        return res.status(409).json({ error: `MAX_BOTS_PER_GAME (${config.maxBotsPerGame}) reached for this Conclave` });
      }
      const session = new BotSession({
        id: spawn.playerCode,
        conclaveCode,
        playerCode: spawn.playerCode,
        name: spawn.name || name || 'Heretic Bot',
        personaOverrides,
        costCeiling,
        config,
        llm: req.app.get('llm'),
        engineBaseUrl: engineClient.baseUrl
      });
      sessionStore.add(session);
      return res.json({
        botId: session.id,
        playerCode: session.playerCode,
        conclaveCode: session.conclaveCode,
        role: session.role,
        faction: session.faction
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /bots — list all sessions (lightweight inspect).
  app.get('/bots', auth, (_req, res) => {
    res.json(sessionStore.list().map((s) => ({
      botId: s.id, playerCode: s.playerCode, conclaveCode: s.conclaveCode,
      role: s.role, faction: s.faction, alive: s.alive, phase: s.phase, lastAction: s.lastAction
    })));
  });

  // GET /bots/:id — inspect one session.
  app.get('/bots/:id', auth, (req, res) => {
    const s = getSessionOrThrow(req, res); if (!s) return;
    res.json(s.inspect());
  });

  // DELETE /bots/:id — despawn: tell the engine to free the seat, close the session.
  // For v1, despawn is lobby-only (matches the spec gate on spawn). If the
  // Conclave has started, we refuse the manager-side teardown rather than
  // orphaning a seat the engine won't return.
  app.delete('/bots/:id', auth, async (req, res) => {
    const s = getSessionOrThrow(req, res); if (!s) return;
    try {
      if (s.phase && s.phase !== 'lobby') {
        return res.status(409).json({ error: `Bot is in phase ${s.phase}; despawn is lobby-only (the engine refuses mid-game seat removal)` });
      }
      try { await engineClient.despawn({ conclaveCode: s.conclaveCode, playerCode: s.playerCode }); }
      catch (e) {
        // Mirror the engine's HTTP error to the admin. Common case: the seat
        // has already moved out of lobby (game started) and the engine
        // rejects the despawn.
        return res.status(e.status && e.status !== 400 ? e.status : 409).json({ error: e.message });
      }
      await s.close();
      sessionStore.remove(s.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /bots/:id/notes — {key, value} inject into the session's notes.
  app.post('/bots/:id/notes', auth, (req, res) => {
    const s = getSessionOrThrow(req, res); if (!s) return;
    try {
      if (!req.body || !req.body.key) return res.status(400).json({ error: 'key is required' });
      s.setNote(req.body.key, req.body.value);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // GET /bots/:id/notes — read all notes.
  app.get('/bots/:id/notes', auth, (req, res) => {
    const s = getSessionOrThrow(req, res); if (!s) return;
    res.json(s.getNotes());
  });
}