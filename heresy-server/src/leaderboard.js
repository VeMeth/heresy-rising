import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'leaderboard.db');
const VALID_PREFERRED_RULESETS = new Set(['base', 'kickstarter_booster', 'big_box']);

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ended_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      outcome       TEXT NOT NULL CHECK (outcome IN ('victory', 'game-over')),
      dungeon_reached INTEGER NOT NULL DEFAULT 0,
      -- How many bosses were fully defeated (0-indexed: 0 = fell at dungeon 1 / boss 1, etc.)
      bosses_defeated INTEGER NOT NULL DEFAULT 0,
      total_bosses INTEGER NOT NULL DEFAULT 7,
      dungeon_cards_cleared INTEGER NOT NULL DEFAULT 0,
      dungeon_cards_total INTEGER NOT NULL DEFAULT 0,
      boss_reached INTEGER NOT NULL DEFAULT 0,
      boss_symbols_cleared INTEGER NOT NULL DEFAULT 0,
      boss_symbols_total INTEGER NOT NULL DEFAULT 0,
      player_count  INTEGER NOT NULL DEFAULT 1,
      team          TEXT NOT NULL DEFAULT '[]'
      -- team is JSON array of { name, hero }
    );

    CREATE INDEX IF NOT EXISTS idx_runs_ended_at    ON runs(ended_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_outcome     ON runs(outcome);
    CREATE INDEX IF NOT EXISTS idx_runs_bosses_defeated ON runs(bosses_defeated DESC);

    CREATE TABLE IF NOT EXISTS players (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_code   TEXT UNIQUE NOT NULL,
      username      TEXT NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      games_played  INTEGER NOT NULL DEFAULT 0,
      wins          INTEGER NOT NULL DEFAULT 0,
      losses        INTEGER NOT NULL DEFAULT 0,
      bosses_defeated_total INTEGER NOT NULL DEFAULT 0,
      dungeons_total INTEGER NOT NULL DEFAULT 0,
      cards_played_total INTEGER NOT NULL DEFAULT 0,
      symbols_played_total INTEGER NOT NULL DEFAULT 0,
      symbol_totals TEXT NOT NULL DEFAULT '{}',
      boss_kill_totals TEXT NOT NULL DEFAULT '{}',
      mini_boss_kill_totals TEXT NOT NULL DEFAULT '{}',
      preferred_ruleset TEXT NOT NULL DEFAULT 'base',
      preferred_game_options TEXT NOT NULL DEFAULT '{}',
      preferred_achievement TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS player_runs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      UNIQUE(player_id, run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_players_player_code ON players(player_code);
    CREATE INDEX IF NOT EXISTS idx_player_runs_player_id ON player_runs(player_id);
  `);

  ensureColumn('players', 'cards_played_total', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('players', 'symbols_played_total', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('players', 'symbol_totals', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('players', 'boss_kill_totals', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('players', 'mini_boss_kill_totals', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('players', 'preferred_ruleset', "TEXT NOT NULL DEFAULT 'base'");
  ensureColumn('players', 'preferred_game_options', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('players', 'preferred_achievement', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('runs', 'total_bosses', "INTEGER NOT NULL DEFAULT 7");
  ensureColumn('runs', 'dungeon_cards_cleared', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('runs', 'dungeon_cards_total', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('runs', 'boss_reached', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('runs', 'boss_symbols_cleared', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('runs', 'boss_symbols_total', "INTEGER NOT NULL DEFAULT 0");
}

function ensureColumn(table, column, definition) {
  const columns = getDb().prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(col => col.name === column)) return;
  getDb().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const PLAYER_CODE_PATTERN = /^BDP[A-F0-9]{12}$/;

function sanitizeUsername(username) {
  const clean = String(username ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  return clean || 'Unknown';
}

function normalizePlayerCode(playerCode) {
  return String(playerCode ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validateNormalizedPlayerCode(playerCode) {
  if (!PLAYER_CODE_PATTERN.test(playerCode)) {
    throw new Error('Invalid player code');
  }
}

function normalizePreferredRuleset(ruleset) {
  return VALID_PREFERRED_RULESETS.has(ruleset) ? ruleset : 'base';
}

function generatePlayerCode() {
  return `BDP-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function sanitizeCounterMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key).slice(0, 80), Math.max(0, Number(count) || 0)])
      .filter(([, count]) => count > 0)
  );
}

function mergeCounterMaps(base, addition) {
  const merged = { ...sanitizeCounterMap(base) };
  for (const [key, count] of Object.entries(sanitizeCounterMap(addition))) {
    merged[key] = (merged[key] || 0) + count;
  }
  return merged;
}

function createUniquePlayerCode(db) {
  for (let i = 0; i < 8; i += 1) {
    const code = generatePlayerCode();
    const existing = db.prepare('SELECT id FROM players WHERE player_code = ?').get(normalizePlayerCode(code));
    if (!existing) return code;
  }
  throw new Error('Unable to create player code');
}

function serializePlayer(row, recentRuns = []) {
  if (!row) return null;
  return {
    id: row.id,
    playerCode: row.player_code,
    username: row.username,
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    bossesDefeatedTotal: row.bosses_defeated_total,
    dungeonsTotal: row.dungeons_total,
    cardsPlayedTotal: row.cards_played_total ?? 0,
    symbolsPlayedTotal: row.symbols_played_total ?? 0,
    symbolTotals: parseJsonObject(row.symbol_totals),
    bossKillTotals: parseJsonObject(row.boss_kill_totals),
    miniBossKillTotals: parseJsonObject(row.mini_boss_kill_totals),
    preferredRuleset: normalizePreferredRuleset(row.preferred_ruleset),
    preferredGameOptions: parseJsonObject(row.preferred_game_options),
    preferredAchievement: String(row.preferred_achievement || '').slice(0, 80),
    recentRuns
  };
}

function getRecentRuns(db, playerId) {
  return db.prepare(`
    SELECT
      r.id,
      r.ended_at,
      r.outcome,
      r.dungeon_reached,
      r.bosses_defeated,
      r.total_bosses,
      r.player_count,
      r.team
    FROM player_runs pr
    JOIN runs r ON r.id = pr.run_id
    WHERE pr.player_id = ?
    ORDER BY r.ended_at DESC
    LIMIT 10
  `).all(playerId).map(row => ({
    id: row.id,
    endedAt: row.ended_at * 1000,
    outcome: row.outcome,
    dungeonReached: row.dungeon_reached,
    bossesDefeated: row.bosses_defeated,
    totalBosses: row.total_bosses || 7,
    playerCount: row.player_count,
    team: JSON.parse(row.team)
  }));
}

export function claimPlayer({ username, playerCode } = {}) {
  const db = getDb();
  const cleanUsername = sanitizeUsername(username);
  const normalizedCode = normalizePlayerCode(playerCode);
  if (normalizedCode) validateNormalizedPlayerCode(normalizedCode);
  let player = normalizedCode
    ? db.prepare('SELECT * FROM players WHERE player_code = ?').get(normalizedCode)
    : null;

  if (player) {
    db.prepare('UPDATE players SET username = ?, updated_at = unixepoch() WHERE id = ?').run(cleanUsername, player.id);
    player = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
  } else if (normalizedCode) {
    throw new Error('Player code not found');
  } else {
    const code = createUniquePlayerCode(db);
    const info = db.prepare('INSERT INTO players (player_code, username) VALUES (?, ?)').run(normalizePlayerCode(code), cleanUsername);
    player = db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
  }

  return serializePlayer(player, getRecentRuns(db, player.id));
}

export function getPlayerByCode(playerCode) {
  const db = getDb();
  const normalizedCode = normalizePlayerCode(playerCode);
  if (!normalizedCode) return null;
  validateNormalizedPlayerCode(normalizedCode);
  const player = db.prepare('SELECT * FROM players WHERE player_code = ?').get(normalizedCode);
  return serializePlayer(player, player ? getRecentRuns(db, player.id) : []);
}

export function updatePlayerPreferences({ playerCode, preferredRuleset, preferredGameOptions, preferredAchievement } = {}) {
  const db = getDb();
  const normalizedCode = normalizePlayerCode(playerCode);
  validateNormalizedPlayerCode(normalizedCode);
  const player = db.prepare('SELECT * FROM players WHERE player_code = ?').get(normalizedCode);
  if (!player) {
    throw new Error('Player code not found');
  }
  const ruleset = preferredRuleset === undefined
    ? normalizePreferredRuleset(player.preferred_ruleset)
    : normalizePreferredRuleset(preferredRuleset);
  const gameOptions = preferredGameOptions === undefined
    ? parseJsonObject(player.preferred_game_options)
    : (preferredGameOptions && typeof preferredGameOptions === 'object' && !Array.isArray(preferredGameOptions) ? preferredGameOptions : {});
  const achievement = preferredAchievement === undefined
    ? String(player.preferred_achievement || '').slice(0, 80)
    : String(preferredAchievement || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
  db.prepare('UPDATE players SET preferred_ruleset = ?, preferred_game_options = ?, preferred_achievement = ?, updated_at = unixepoch() WHERE id = ?')
    .run(ruleset, JSON.stringify(gameOptions), achievement, player.id);
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
  return serializePlayer(updated, getRecentRuns(db, player.id));
}

/**
 * Log a completed game run.
 * @param {object} params
 * @param {'victory'|'game-over'} params.outcome
 * @param {number} params.dungeonReached  - dungeon number they were on when game ended (1-based)
 * @param {number} params.bossesDefeated  - how many bosses were fully cleared
 * @param {number} params.totalBosses     - number of bosses in the selected ruleset
 * @param {number} params.dungeonCardsCleared - cards cleared in the incomplete/current dungeon
 * @param {number} params.dungeonCardsTotal   - cards in the incomplete/current dungeon
 * @param {boolean} params.bossReached         - whether the party reached the current dungeon boss
 * @param {number} params.bossSymbolsCleared   - boss symbols cleared if the party reached the boss
 * @param {number} params.bossSymbolsTotal     - total boss symbols if the party reached the boss
 * @param {Array<{name:string, hero:string, secondHero?:string, playerCode?:string, cardsPlayed?:number, symbolsContributed?:number, symbolTotals?:object, bossKillTotals?:object, miniBossKillTotals?:object}>} params.team
 */
export function logRun({
  outcome,
  dungeonReached,
  bossesDefeated,
  totalBosses = 7,
  dungeonCardsCleared = 0,
  dungeonCardsTotal = 0,
  bossReached = false,
  bossSymbolsCleared = 0,
  bossSymbolsTotal = 0,
  team
}) {
  const db = getDb();
  const cleanTotalBosses = Math.max(1, Math.min(7, Number(totalBosses) || 7));
  const cleanDungeonCardsCleared = Math.max(0, Number(dungeonCardsCleared) || 0);
  const cleanDungeonCardsTotal = Math.max(0, Number(dungeonCardsTotal) || 0);
  const cleanBossSymbolsCleared = Math.max(0, Number(bossSymbolsCleared) || 0);
  const cleanBossSymbolsTotal = Math.max(0, Number(bossSymbolsTotal) || 0);
  const insertRun = db.prepare(`
      INSERT INTO runs (
        outcome,
        dungeon_reached,
        bosses_defeated,
        total_bosses,
        dungeon_cards_cleared,
        dungeon_cards_total,
        boss_reached,
        boss_symbols_cleared,
        boss_symbols_total,
        player_count,
        team
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  const updatePlayerStats = db.prepare(`
      UPDATE players
      SET
        username = ?,
        updated_at = unixepoch(),
        games_played = games_played + 1,
        wins = wins + ?,
        losses = losses + ?,
        bosses_defeated_total = bosses_defeated_total + ?,
        dungeons_total = dungeons_total + ?,
        cards_played_total = cards_played_total + ?,
        symbols_played_total = symbols_played_total + ?,
        symbol_totals = ?,
        boss_kill_totals = ?,
        mini_boss_kill_totals = ?
      WHERE id = ?
    `);
  const linkPlayerRun = db.prepare('INSERT OR IGNORE INTO player_runs (player_id, run_id) VALUES (?, ?)');

  return db.transaction(() => {
    const publicTeam = team.map(player => ({
      name: sanitizeUsername(player?.name),
      hero: String(player?.hero ?? '').slice(0, 30),
      secondHero: String(player?.secondHero ?? '').slice(0, 30)
    }));
    const info = insertRun.run(
      outcome,
      dungeonReached,
      bossesDefeated,
      cleanTotalBosses,
      cleanDungeonCardsCleared,
      cleanDungeonCardsTotal,
      bossReached ? 1 : 0,
      cleanBossSymbolsCleared,
      cleanBossSymbolsTotal,
      publicTeam.length,
      JSON.stringify(publicTeam)
    );

    for (const player of team) {
      const playerCode = normalizePlayerCode(player?.playerCode);
      if (!playerCode) continue;
      const statsPlayer = db.prepare('SELECT * FROM players WHERE player_code = ?').get(playerCode);
      if (!statsPlayer) continue;
      const symbolTotals = sanitizeCounterMap(player?.symbolTotals);
      const symbolsContributed = Math.max(
        Number(player?.symbolsContributed) || 0,
        Object.values(symbolTotals).reduce((sum, count) => sum + count, 0)
      );
      const cardsPlayed = Math.max(0, Number(player?.cardsPlayed) || 0);
      const mergedSymbolTotals = mergeCounterMaps(parseJsonObject(statsPlayer.symbol_totals), symbolTotals);
      const mergedBossKillTotals = mergeCounterMaps(parseJsonObject(statsPlayer.boss_kill_totals), player?.bossKillTotals);
      const mergedMiniBossKillTotals = mergeCounterMaps(parseJsonObject(statsPlayer.mini_boss_kill_totals), player?.miniBossKillTotals);
      updatePlayerStats.run(
        sanitizeUsername(player?.name),
        outcome === 'victory' ? 1 : 0,
        outcome === 'game-over' ? 1 : 0,
        bossesDefeated,
        dungeonReached,
        cardsPlayed,
        symbolsContributed,
        JSON.stringify(mergedSymbolTotals),
        JSON.stringify(mergedBossKillTotals),
        JSON.stringify(mergedMiniBossKillTotals),
        statsPlayer.id
      );
      linkPlayerRun.run(statsPlayer.id, info.lastInsertRowid);
    }

    return { id: info.lastInsertRowid };
  })();
}

/**
 * Get the top N runs sorted by progress, with current-dungeon progress as tiebreaker.
 * Returns all runs; caller can slice to top N.
 * Victory runs are tagged so UI can highlight them.
 */
export function getLeaderboard(limit = 10, playerCount = null) {
  const db = getDb();
  const cleanPlayerCount = Number(playerCount);
  const hasPlayerCountFilter = Number.isInteger(cleanPlayerCount) && cleanPlayerCount > 0;
  const rows = db.prepare(`
    SELECT
      id,
      ended_at,
      outcome,
      dungeon_reached,
      bosses_defeated,
      total_bosses,
      dungeon_cards_cleared,
      dungeon_cards_total,
      boss_reached,
      boss_symbols_cleared,
      boss_symbols_total,
      player_count,
      team
    FROM runs
    ${hasPlayerCountFilter ? 'WHERE player_count = ?' : ''}
    ORDER BY
      bosses_defeated DESC,
      boss_reached DESC,
      dungeon_cards_cleared DESC,
      boss_symbols_cleared DESC,
      ended_at ASC
    LIMIT ?
  `).all(...(hasPlayerCountFilter ? [cleanPlayerCount, limit] : [limit]));

  return rows.map(row => ({
    id:              row.id,
    endedAt:         row.ended_at * 1000,
    outcome:         row.outcome,
    dungeonReached:  row.dungeon_reached,
    bossesDefeated:  row.bosses_defeated,
    totalBosses:     row.total_bosses || 7,
    dungeonCardsCleared: row.dungeon_cards_cleared || 0,
    dungeonCardsTotal: row.dungeon_cards_total || 0,
    bossReached:     !!row.boss_reached,
    bossSymbolsCleared: row.boss_symbols_cleared || 0,
    bossSymbolsTotal: row.boss_symbols_total || 0,
    playerCount:     row.player_count,
    team:            JSON.parse(row.team)
  }));
}

/**
 * Total run count — useful for showing "X games recorded".
 */
export function getRunCount(playerCount = null) {
  const cleanPlayerCount = Number(playerCount);
  if (Number.isInteger(cleanPlayerCount) && cleanPlayerCount > 0) {
    return getDb().prepare('SELECT count(*) as n FROM runs WHERE player_count = ?').get(cleanPlayerCount).n;
  }
  return getDb().prepare('SELECT count(*) as n FROM runs').get().n;
}

export function getPlayerLeaderboard(limit = 20) {
  const rows = getDb().prepare(`
    SELECT
      id,
      username,
      games_played,
      wins,
      losses,
      bosses_defeated_total,
      dungeons_total,
      cards_played_total,
      symbols_played_total,
      symbol_totals
    FROM players
    WHERE games_played > 0
    ORDER BY
      wins DESC,
      bosses_defeated_total DESC,
      games_played ASC,
      updated_at DESC
    LIMIT ?
  `).all(limit);

  return rows.map(row => ({
    id: row.id,
    username: row.username,
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    bossesDefeatedTotal: row.bosses_defeated_total,
    dungeonsTotal: row.dungeons_total,
    cardsPlayedTotal: row.cards_played_total ?? 0,
    symbolsPlayedTotal: row.symbols_played_total ?? 0,
    symbolTotals: parseJsonObject(row.symbol_totals),
    winRate: row.games_played > 0 ? row.wins / row.games_played : 0
  }));
}

export function getAdminPlayers() {
  const rows = getDb().prepare(`
    SELECT *
    FROM players
    ORDER BY updated_at DESC, id DESC
  `).all();

  return rows.map(row => serializePlayer(row, getRecentRuns(getDb(), row.id)));
}

export function updateAdminPlayer(playerId, updates = {}) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!existing) throw new Error('Player not found');

  const allowedNumberFields = {
    gamesPlayed: 'games_played',
    wins: 'wins',
    losses: 'losses',
    bossesDefeatedTotal: 'bosses_defeated_total',
    dungeonsTotal: 'dungeons_total',
    cardsPlayedTotal: 'cards_played_total',
    symbolsPlayedTotal: 'symbols_played_total'
  };
  const assignments = [];
  const values = [];

  if (updates.username !== undefined) {
    assignments.push('username = ?');
    values.push(sanitizeUsername(updates.username));
  }

  for (const [inputKey, column] of Object.entries(allowedNumberFields)) {
    if (updates[inputKey] === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(Math.max(0, Number(updates[inputKey]) || 0));
  }

  if (updates.symbolTotals !== undefined) {
    assignments.push('symbol_totals = ?');
    values.push(JSON.stringify(sanitizeCounterMap(updates.symbolTotals)));
  }
  if (updates.bossKillTotals !== undefined) {
    assignments.push('boss_kill_totals = ?');
    values.push(JSON.stringify(sanitizeCounterMap(updates.bossKillTotals)));
  }
  if (updates.miniBossKillTotals !== undefined) {
    assignments.push('mini_boss_kill_totals = ?');
    values.push(JSON.stringify(sanitizeCounterMap(updates.miniBossKillTotals)));
  }

  if (assignments.length === 0) {
    return serializePlayer(existing, getRecentRuns(db, existing.id));
  }

  assignments.push('updated_at = unixepoch()');
  db.prepare(`UPDATE players SET ${assignments.join(', ')} WHERE id = ?`).run(...values, playerId);
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  return serializePlayer(updated, getRecentRuns(db, updated.id));
}

export function mergeAdminPlayers(sourcePlayerId, targetPlayerId) {
  const db = getDb();
  const sourceId = Number(sourcePlayerId);
  const targetId = Number(targetPlayerId);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    throw new Error('Invalid player id');
  }
  if (sourceId === targetId) {
    throw new Error('Choose two different players');
  }

  return db.transaction(() => {
    const source = db.prepare('SELECT * FROM players WHERE id = ?').get(sourceId);
    const target = db.prepare('SELECT * FROM players WHERE id = ?').get(targetId);
    if (!source || !target) throw new Error('Player not found');

    const mergedSymbolTotals = mergeCounterMaps(
      parseJsonObject(target.symbol_totals),
      parseJsonObject(source.symbol_totals)
    );
    const mergedBossKillTotals = mergeCounterMaps(
      parseJsonObject(target.boss_kill_totals),
      parseJsonObject(source.boss_kill_totals)
    );
    const mergedMiniBossKillTotals = mergeCounterMaps(
      parseJsonObject(target.mini_boss_kill_totals),
      parseJsonObject(source.mini_boss_kill_totals)
    );

    db.prepare(`
      UPDATE players
      SET
        updated_at = unixepoch(),
        games_played = games_played + ?,
        wins = wins + ?,
        losses = losses + ?,
        bosses_defeated_total = bosses_defeated_total + ?,
        dungeons_total = dungeons_total + ?,
        cards_played_total = cards_played_total + ?,
        symbols_played_total = symbols_played_total + ?,
        symbol_totals = ?,
        boss_kill_totals = ?,
        mini_boss_kill_totals = ?
      WHERE id = ?
    `).run(
      Math.max(0, Number(source.games_played) || 0),
      Math.max(0, Number(source.wins) || 0),
      Math.max(0, Number(source.losses) || 0),
      Math.max(0, Number(source.bosses_defeated_total) || 0),
      Math.max(0, Number(source.dungeons_total) || 0),
      Math.max(0, Number(source.cards_played_total) || 0),
      Math.max(0, Number(source.symbols_played_total) || 0),
      JSON.stringify(mergedSymbolTotals),
      JSON.stringify(mergedBossKillTotals),
      JSON.stringify(mergedMiniBossKillTotals),
      targetId
    );

    db.prepare('UPDATE OR IGNORE player_runs SET player_id = ? WHERE player_id = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM players WHERE id = ?').run(sourceId);

    const merged = db.prepare('SELECT * FROM players WHERE id = ?').get(targetId);
    return {
      sourceDeleted: true,
      player: serializePlayer(merged, getRecentRuns(db, targetId))
    };
  })();
}

export function deleteAdminPlayer(playerId) {
  const info = getDb().prepare('DELETE FROM players WHERE id = ?').run(playerId);
  return { deleted: info.changes > 0 };
}
