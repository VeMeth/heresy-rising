/**
 * Playground server entry point. Binds to 127.0.0.1 only — this exposes
 * omniscient state and arbitrary mutation with no auth, so it must never be
 * reachable off-host (see AGENTS.md / the dispatch's Safety section).
 */

import { createApp, listSandboxes, destroySandbox, sweepOrphanLogs } from './api.js';

const PORT = Number(process.env.PLAYGROUND_PORT) || 4200;
const HOST = '127.0.0.1';

// Best-effort cleanup of any hr game-log JSON files left behind by a
// crashed previous process (sandbox.js's sweepOrphanLogs — see its own
// comment for why this can only ever be in-process/best-effort).
sweepOrphanLogs();

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`[playground] listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[playground] port ${PORT} is already in use. Another process (a stale ` +
      `playground server, or something else) is bound there — stop it first, ` +
      `or set PLAYGROUND_PORT to run this instance on a different port.`
    );
    process.exitCode = 1;
    return;
  }
  console.error('[playground] server error:', err);
  process.exitCode = 1;
});

// Graceful shutdown: close every live sandbox's in-memory DB handle (and
// its game-log file, via destroySandbox -> sandbox.close()) before the
// process actually exits, rather than letting them leak until GC.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[playground] ${signal} received, shutting down...`);
  for (const { sessionId } of listSandboxes()) {
    try { destroySandbox(sessionId); } catch (err) { console.error(`[playground] error closing sandbox ${sessionId}:`, err); }
  }
  server.close(() => process.exit(0));
  // Belt-and-braces: force exit if something keeps the event loop alive.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
