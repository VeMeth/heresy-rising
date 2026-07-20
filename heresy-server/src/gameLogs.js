import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LEGACY_LOG_PATH = path.join(DATA_DIR, 'game-logs.json');
const MAX_ADMIN_LOG_EVENTS = 20000;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function safeLogId(id) {
  return String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);
}

function logPathForId(id) {
  const safeId = safeLogId(id);
  if (!safeId) return null;
  return path.join(LOG_DIR, `${safeId}.json`);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error('[GameLogs] Failed to read game log:', filePath, error.message);
    return null;
  }
}

function writeJsonFile(filePath, data) {
  ensureLogDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function migrateLegacyLogFile() {
  ensureLogDir();
  if (!fs.existsSync(LEGACY_LOG_PATH)) return;

  const legacy = readJsonFile(LEGACY_LOG_PATH);
  const logs = Array.isArray(legacy?.logs) ? legacy.logs : [];
  for (const log of logs) {
    if (!log?.id) continue;
    const filePath = logPathForId(log.id);
    if (!filePath || fs.existsSync(filePath)) continue;
    writeJsonFile(filePath, log);
  }
}

function summarizeRoom(room) {
  return {
    id: room.gameLogId,
    roomCode: room.code,
    phase: room.phase,
    ruleset: room.ruleset,
    expansionEnabled: !!room.expansionEnabled,
    isTwoPlayerMode: !!room.isTwoPlayerMode,
    currentDungeon: room.currentDungeon,
    createdAt: room.gameLogCreatedAt || room.createdAt || Date.now(),
    updatedAt: Date.now(),
    players: (room.players || []).map(player => ({
      id: player.id,
      name: player.name,
      hero: player.hero,
      secondHero: player.secondHero || null,
      playerCode: player.playerCode || ''
    }))
  };
}

function summarizeLog(log) {
  return {
    id: log.id,
    roomCode: log.roomCode,
    phase: log.phase,
    ruleset: log.ruleset,
    expansionEnabled: !!log.expansionEnabled,
    isTwoPlayerMode: !!log.isTwoPlayerMode,
    currentDungeon: log.currentDungeon,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
    playerCount: log.players?.length || 0,
    players: log.players || [],
    eventCount: log.events?.length || 0,
    historyCount: log.history?.length || 0
  };
}

export function saveGameLogSnapshot(room) {
  if (!room?.gameLogId) return;
  migrateLegacyLogFile();
  const filePath = logPathForId(room.gameLogId);
  if (!filePath) return;

  const existing = fs.existsSync(filePath) ? readJsonFile(filePath) : null;
  const summary = summarizeRoom(room);
  const log = {
    ...(existing || {}),
    ...summary,
    createdAt: existing?.createdAt || summary.createdAt,
    history: room.history || [],
    events: room.debugLog || []
  };
  writeJsonFile(filePath, log);
}

export function listGameLogs({ limit = 100 } = {}) {
  migrateLegacyLogFile();
  const max = Math.max(1, Math.min(Number(limit) || 100, 500));
  const files = fs.readdirSync(LOG_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(LOG_DIR, entry.name));

  return files
    .map(readJsonFile)
    .filter(Boolean)
    .map(summarizeLog)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, max);
}

export function getGameLog(id) {
  migrateLegacyLogFile();
  const filePath = logPathForId(id);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const log = readJsonFile(filePath);
  if (!log) return null;
  return {
    ...log,
    events: (log.events || []).slice(-MAX_ADMIN_LOG_EVENTS),
    history: log.history || []
  };
}

export function deleteGameLog(id) {
  migrateLegacyLogFile();
  const filePath = logPathForId(id);
  if (!filePath || !fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
