import express from 'express';
import { config, hasControlAuth, hasLLMConfig } from './config.js';
import { SessionStore } from './sessionStore.js';
import { EngineClient } from './engineClient.js';
import { healthHandler } from './health.js';
import { registerRestRoutes } from './rest.js';
import { llmFor } from './llm/registry.js';
import { BotPersistence } from './persistence.js';
import { BotSession } from './session.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const sessionStore = new SessionStore({ config });
const engineClient = new EngineClient({ baseUrl: config.heresyGameHost, botApiKey: config.botApiKey });
const persistence = new BotPersistence({ dir: './data/bot-sessions' });
app.set('sessionStore', sessionStore);
app.set('engineClient', engineClient);
app.set('persistence', persistence);
app.set('config', config);

// Pick the default LLM at boot via the profile registry (llm/registry.js) —
// BOT_DEFAULT_PROFILE, or 'local' if unset, which resolves to an
// OpenAI-compatible client via ActionLLM if OPENAI_BASE_URL is set (e.g. LM
// Studio at http://host.docker.internal:1234/v1), otherwise the
// PassThroughLLM (bots spawn but pass every turn). This is still what a
// fresh spawn with no `profile` in the body gets, and what the restore loop
// below falls back to for pre-profile snapshots. Per-spawn/per-session
// profile resolution happens in rest.js and (once restored) below. Tests can
// inject a mock at any time via `app.set('llm', ...)`.
const llm = llmFor(config.botDefaultProfile);
app.set('llm', llm);

// Restore any previously-persisted bot sessions. This reconnects them to
// their conclaves so bot state survives manager restarts mid-game.
const savedSessions = persistence.loadAll();
let restored = 0;
for (const snap of savedSessions) {
  try {
    // Restore each bot on the LLM profile it was spawned with (snap.profile,
    // written by A2's session.js work) rather than always falling back to
    // the process default — a restarted manager must bring a MiniMax bot
    // back as a MiniMax bot, not silently downgrade it to local. Pre-profile
    // snapshots have no `profile` field, so llmFor(undefined) resolves
    // BOT_DEFAULT_PROFILE the same way a fresh spawn with no `profile` in
    // the body would — same object as the `llm` above in that case.
    const session = new BotSession({
      id: snap.id,
      playerCode: snap.playerCode,
      conclaveCode: snap.conclaveCode,
      name: snap.name,
      config,
      llm: llmFor(snap.profile),
      profileId: snap.profile,
      engineBaseUrl: config.heresyGameHost,
      persistence,
      snapshot: snap
    });
    sessionStore.add(session);
    restored++;
  } catch (e) {
    console.warn(`[bot-manager] failed to restore session ${snap.id}:`, e.message);
  }
}
console.info(`[bot-manager] restored ${restored}/${savedSessions.length} persisted sessions`);

app.get('/health', healthHandler);
registerRestRoutes(app, sessionStore, engineClient, config);

// Fail-closed startup checks: if the control-auth secrets are missing, log and
// keep running (so /health responds) but refuse spawn attempts upstream by
// virtue of requireManagerAuth having no token to compare against.
if (!hasControlAuth(config)) {
  console.warn('[bot-manager] WARN: no ADMIN_API_KEY / SIM_BYPASS_TOKEN set — all control endpoints will reject with 403.');
}
if (!config.botApiKey) {
  console.warn('[bot-manager] WARN: BOT_API_KEY unset — engine spawn/despawn calls will be rejected with 403.');
}
if (!hasLLMConfig(config)) {
  console.warn('[bot-manager] WARN: OPENAI_BASE_URL unset — LLM stack disabled; spawned bots will pass every turn.');
}

const port = config.heresyBotPort;
const server = app.listen(port, () => {
  console.info(`[bot-manager] listening on ${port}; engine=${config.heresyGameHost}; sessions=${sessionStore.count()}`);
});

async function shutdown() {
  console.info('[bot-manager] shutting down…');
  try { await sessionStore.closeAll(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server, sessionStore, engineClient };
