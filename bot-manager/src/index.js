import express from 'express';
import { config, hasControlAuth, hasLLMConfig } from './config.js';
import { SessionStore } from './sessionStore.js';
import { EngineClient } from './engineClient.js';
import { healthHandler } from './health.js';
import { registerRestRoutes } from './rest.js';
import { PassThroughLLM } from './llm/passthroughLLM.js';
import { ChatMiniMax } from './llm/chatMiniMax.js';
import { ActionLLM } from './llm/actionLLM.js';
import { BotPersistence } from './persistence.js';
import { BotSession } from './session.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const sessionStore = new SessionStore();
const engineClient = new EngineClient({ baseUrl: config.heresyGameHost, botApiKey: config.botApiKey });
const persistence = new BotPersistence({ dir: config.botSessionDir });
app.set('sessionStore', sessionStore);
app.set('engineClient', engineClient);
app.set('persistence', persistence);
app.set('config', config);

// Pick the LLM at boot: ChatMiniMax via ActionLLM if MiniMax_API_KEY is set,
// otherwise the PassThroughLLM (bots spawn but pass every turn). Tests can
// inject a mock at any time via `app.set('llm', ...)`.
let llm = new PassThroughLLM();
if (hasLLMConfig(config)) {
  try {
    const chat = new ChatMiniMax({
      apiKey: config.miniMaxApiKey,
      model: config.miniMaxModel,
      baseUrl: config.miniMaxBaseUrl,
      temperature: config.llmTemperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
      timeoutMs: config.llmTimeoutMs,
      maxRetries: config.maxRetries
    });
    llm = new ActionLLM({ chatModel: chat, maxRetries: config.maxRetries });
    console.log(`[bot-manager] LLM ready: ${chat.model} via ActionLLM`);
  } catch (e) {
    console.warn(`[bot-manager] ChatMiniMax init failed; falling back to PassThroughLLM:`, e.message);
    llm = new PassThroughLLM();
  }
}
app.set('llm', llm);

// Restore any previously-persisted bot sessions. This reconnects them to
// their conclaves so bot state survives manager restarts mid-game.
const savedSessions = persistence.loadAll();
let restored = 0;
for (const snap of savedSessions) {
  try {
    const session = new BotSession({
      id: snap.id,
      playerCode: snap.playerCode,
      conclaveCode: snap.conclaveCode,
      name: snap.name,
      config,
      llm,
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
console.log(`[bot-manager] restored ${restored}/${savedSessions.length} persisted sessions`);

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
  console.warn('[bot-manager] WARN: MiniMax_API_KEY unset — LLM stack disabled; spawned bots will pass every turn.');
}

const port = config.heresyBotPort;
const server = app.listen(port, () => {
  console.log(`[bot-manager] listening on ${port}; engine=${config.heresyGameHost}; sessions=${sessionStore.count()}`);
});

async function shutdown() {
  console.log('[bot-manager] shutting down…');
  try { await sessionStore.closeAll(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server, sessionStore, engineClient };
