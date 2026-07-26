// Session state persistence — writes/reads bot session snapshots to/from disk
// so bot state (memory, notes, role, phase) survives container restarts.
// Each session is one JSON file named by playerCode.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Session ids/playerCodes originate from the engine service (a different
// trust boundary) and are used directly as filenames — sanitize to a safe
// basename before ever touching the filesystem so a malicious/misbehaving
// engine response can't write or delete outside this.dir via `..` segments.
function safeFileId(id) {
  const cleaned = basename(String(id ?? '')).replace(/[^A-Za-z0-9_-]/g, '');
  if (!cleaned) throw new Error(`invalid session id: ${JSON.stringify(id)}`);
  return cleaned;
}

export class BotPersistence {
  constructor({ dir = './data/bot-sessions' } = {}) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  /** Serialise a session snapshot to disk. Fire-and-forget safe. */
  save(session) {
    try {
      const data = session.snapshot();
      const path = join(this.dir, `${safeFileId(data.id)}.json`);
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.warn(`[persist] save failed for ${session.id}:`, e.message);
    }
  }

  /** Remove a session file (called on despawn). */
  remove(playerCode) {
    try {
      const path = join(this.dir, `${safeFileId(playerCode)}.json`);
      if (existsSync(path)) unlinkSync(path);
    } catch (e) {
      console.warn(`[persist] remove failed for ${playerCode}:`, e.message);
    }
  }

  /** Load all saved session snapshots from disk. */
  loadAll() {
    const sessions = [];
    try {
      if (!existsSync(this.dir)) return sessions;
      const files = readdirSync(this.dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const path = join(this.dir, file);
          const raw = readFileSync(path, 'utf-8');
          sessions.push(JSON.parse(raw));
        } catch (e) {
          console.warn(`[persist] skipping corrupt session file ${file}:`, e.message);
        }
      }
    } catch (e) {
      console.warn(`[persist] loadAll failed:`, e.message);
    }
    return sessions;
  }
}
