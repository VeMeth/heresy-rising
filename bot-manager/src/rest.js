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
        engineBaseUrl: engineClient.baseUrl,
        persistence: req.app.get('persistence')
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
      role: s.role, faction: s.faction, alive: s.alive, phase: s.phase, lastAction: s.lastAction,
      llmPassive: !!(s._llm && (s._llm.label === 'passthrough' || s._llm._label === 'passthrough')),
      memoryBytes: s.shortTermMemory?.length ?? 0,
      tokensUsed: s.tokensUsed
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
  // If the engine call fails (e.g. game already deleted), we still clean up
  // the local session — the seat is already gone.
  app.delete('/bots/:id', auth, async (req, res) => {
    const s = getSessionOrThrow(req, res); if (!s) return;
    try {
      if (s.phase && s.phase !== 'lobby') {
        try {
          await engineClient.despawn({ conclaveCode: s.conclaveCode, playerCode: s.playerCode });
        } catch (e) {
          // Engine rejected the despawn (game doesn't exist or other error).
          // Still clean up locally — the seat can't be orphaned if the game is gone.
          await s.close();
          sessionStore.remove(s.id);
          req.app.get('persistence')?.remove(s.id);
          return res.json({ ok: true, note: 'local cleanup only; engine rejected despawn: ' + e.message });
        }
      } else {
        await engineClient.despawn({ conclaveCode: s.conclaveCode, playerCode: s.playerCode });
      }
      await s.close();
      sessionStore.remove(s.id);
      req.app.get('persistence')?.remove(s.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /bots/by-conclave/:conclaveCode — despawn ALL bots in a conclave.
  // Used when the game is deleted; force-teardown regardless of phase since the
  // game no longer exists. Tries to clean up engine seats but does not fail if
  // the engine is already gone.
  app.delete('/bots/by-conclave/:conclaveCode', auth, async (req, res) => {
    const conclaveCode = req.params.conclaveCode;
    const matches = sessionStore.list().filter((s) => s.conclaveCode === conclaveCode);
    const results = [];
    for (const s of matches) {
      try {
        await engineClient.despawn({ conclaveCode, playerCode: s.playerCode }).catch(() => {});
        await s.close();
        sessionStore.remove(s.id);
        req.app.get('persistence')?.remove(s.id);
        results.push({ botId: s.id, ok: true });
      } catch (e) {
        results.push({ botId: s.id, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, count: results.length, results });
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