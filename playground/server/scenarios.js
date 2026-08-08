/**
 * Scenario save/load for playground boards. Captures a complete board setup
 * as human-readable JSON so developers can commit interesting edge cases to
 * git and rebuild them deterministically for testing/debugging.
 *
 * Scenarios are designed for round-trip consistency: save a board, load it
 * into a fresh sandbox, and the two should match field-for-field. Essential
 * for regression testing — capture a bug's reproduction case once, then keep
 * it green forever.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, '../scenarios');

/**
 * Sanitize a scenario name for safe use as a filename.
 * Allows [a-zA-Z0-9_-] only, max 100 chars, no path traversal.
 *
 * @param {string} name
 * @returns {string} sanitized name
 * @throws {Error} if name is invalid or contains forbidden characters
 */
function sanitizeName(name) {
  if (typeof name !== 'string') throw new Error('Scenario name must be a string');
  if (!name) throw new Error('Scenario name must not be empty');
  if (name.length > 100) throw new Error('Scenario name must be <= 100 characters');

  // Reject path traversal attempts
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Scenario name must not contain path separators or traversal sequences');
  }

  // Keep only alphanumeric, underscore, hyphen
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) {
    throw new Error('Scenario name must contain at least one alphanumeric character, underscore, or hyphen');
  }

  return sanitized;
}

/**
 * @typedef {Object} ScenarioDoc
 * @property {string} version - Format version
 * @property {string} name - Scenario name
 * @property {number} savedAt - Unix timestamp when saved
 * @property {string} [description] - Optional human-readable description
 * @property {number} seed - RNG seed (for deterministic resolution)
 * @property {Object} options - Sandbox creation options
 * @property {number} [options.maxDrift]
 * @property {string} [options.deathReveal]
 * @property {boolean} [options.anonymized]
 * @property {boolean} [options.warpTaintVisible]
 * @property {Array} players - Player array with all flags and state
 * @property {Object} game - Game row state: phase, round, dayStage, etc.
 * @property {Array} actions - Current round's submitted night actions
 * @property {Array} votes - Current round's day votes
 * @property {Array} usage - Ability use counters (once-per-game gates)
 */

/**
 * List all saved scenarios with metadata.
 *
 * @returns {{name, savedAt, playerCount, phase, round, description}[]}
 */
export function listScenarios() {
  if (!fs.existsSync(SCENARIOS_DIR)) {
    return [];
  }

  return fs.readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const content = fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf-8');
        const doc = JSON.parse(content);
        return {
          name: doc.name,
          savedAt: doc.savedAt,
          playerCount: doc.players.length,
          phase: doc.game.phase,
          round: doc.game.round,
          description: doc.description || null,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Save the current board state to a JSON scenario file.
 * Creates playground/scenarios/ if missing.
 *
 * @param {string} name - Scenario name (sanitized for filename)
 * @param {Sandbox} sandbox
 * @param {Object} [meta]
 * @param {string} [meta.description]
 * @returns {{name: string, path: string}}
 */
export function saveScenario(name, sandbox, meta) {
  const sanitized = sanitizeName(name);
  const doc = scenarioFromSandbox(sandbox, { name: sanitized, ...meta });

  if (!fs.existsSync(SCENARIOS_DIR)) {
    fs.mkdirSync(SCENARIOS_DIR, { recursive: true });
  }

  const filePath = path.join(SCENARIOS_DIR, `${sanitized}.json`);
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');

  return { name: doc.name, path: filePath };
}

/**
 * Load a scenario by name (filename without .json).
 *
 * @param {string} name
 * @returns {ScenarioDoc}
 * @throws {Error} if scenario file not found or invalid JSON
 */
export function loadScenario(name) {
  const sanitized = sanitizeName(name);
  const filePath = path.join(SCENARIOS_DIR, `${sanitized}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Scenario not found: ${name}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Extract the complete board state into a scenario document.
 * Reads players, game fields, current-round actions/votes, and usage counters.
 *
 * @param {Sandbox} sandbox
 * @param {Object} [meta]
 * @param {string} [meta.name]
 * @param {string} [meta.description]
 * @returns {ScenarioDoc}
 */
export function scenarioFromSandbox(sandbox, meta) {
  const { manager, code, seed } = sandbox;
  const gameRow = manager.game(code);
  const playerRows = manager.players(code);

  if (!gameRow) {
    throw new Error('Game not found');
  }

  // Extract actions for the current round
  const currentRound = gameRow.round;
  const actions = manager.db.prepare(
    'SELECT actor_code, kind, target_code, variant, data FROM hr_actions WHERE game_code=? AND round=?'
  ).all(code, currentRound) || [];

  // Extract votes for the current round
  const votes = manager.db.prepare(
    'SELECT voter_code, choice, justification FROM hr_votes WHERE game_code=? AND round=?'
  ).all(code, currentRound) || [];

  // Extract usage rows (ability use counters)
  const usage = manager.db.prepare(
    'SELECT player_code, ability, uses FROM hr_usage WHERE game_code=?'
  ).all(code) || [];

  return {
    version: '1',
    name: meta?.name || 'untitled',
    savedAt: Date.now(),
    description: meta?.description || null,
    seed,
    options: {
      maxDrift: gameRow.max_drift,
      deathReveal: gameRow.death_reveal,
      anonymized: Boolean(gameRow.anonymized),
      warpTaintVisible: Boolean(gameRow.warp_taint_visible),
    },
    players: playerRows.map(p => ({
      name: p.name,
      playerCode: p.player_code,
      seat: p.seat,
      roleId: p.role_id,
      faction: p.faction,
      drift: p.drift,
      alive: Boolean(p.alive),
      crippleTier: p.cripple_tier,
      torturedBefore: Boolean(p.tortured_before),
      markPublic: Boolean(p.mark_public),
      possessedBy: p.possessed_by || null,
      possessionRevealed: Boolean(p.possession_revealed),
      plagueCarrier: Boolean(p.plague_carrier),
      tier1UntilRound: p.tier1_until_round || null,
      skipNextNight: Boolean(p.skip_next_night),
      deathCause: p.death_cause || null,
    })),
    game: {
      phase: gameRow.phase,
      round: gameRow.round,
      dayStage: gameRow.day_stage || null,
      patientZero: gameRow.patient_zero || null,
      lastTorturedTarget: gameRow.last_tortured_target || null,
      lastTortureTier: gameRow.last_torture_tier,
    },
    actions: actions.map(a => ({
      actorCode: a.actor_code,
      kind: a.kind,
      targetCode: a.target_code || null,
      variant: a.variant || null,
      data: a.data || null,
    })),
    votes: votes.map(v => ({
      voterCode: v.voter_code,
      choice: v.choice,
      justification: v.justification || null,
    })),
    usage: usage.map(u => ({
      playerCode: u.player_code,
      ability: u.ability,
      uses: u.uses,
    })),
  };
}

/**
 * Replay a scenario onto an existing sandbox to restore the exact board state.
 * Applies game fields, player mutations, then re-submits actions and votes.
 * Uses only whitelisted sandbox methods (never raw SQL of its own).
 *
 * IMPORTANT: The sandbox must already have the same NUMBER of players, one
 * per seat, as the scenario. It does NOT need the same player codes — it
 * can't, structurally: createSandbox() (sandbox.js) stamps every player code
 * with a fresh `${sessionId}-p${i}` on every call, so two independently
 * created sandboxes never share a player code even when built from the exact
 * same players/roster arrays. Seat number is the one thing that stays stable
 * across sandboxes built from the same roster, so every code the scenario
 * doc references (player codes, action actor/target codes, vote voter codes
 * and target choices, possessedBy) is translated seat-for-seat onto the
 * local sandbox's actual codes below, rather than assumed to match literally.
 *
 * @param {Sandbox} sandbox
 * @param {ScenarioDoc} doc
 * @throws {Error} if player counts don't match
 */
export function applyScenario(sandbox, doc) {
  const { manager, code } = sandbox;

  // Verify the players match in count, and build the seat -> local code map.
  const localPlayers = manager.players(code);
  if (localPlayers.length !== doc.players.length) {
    throw new Error(
      `Player count mismatch: sandbox has ${localPlayers.length}, scenario has ${doc.players.length}`
    );
  }
  const localCodeBySeat = new Map(localPlayers.map(p => [p.seat, p.player_code]));
  const localCodeForDocCode = new Map();
  for (const playerDoc of doc.players) {
    const localCode = localCodeBySeat.get(playerDoc.seat);
    if (!localCode) {
      throw new Error(`No local player at seat ${playerDoc.seat} for scenario player ${playerDoc.playerCode}`);
    }
    localCodeForDocCode.set(playerDoc.playerCode, localCode);
  }
  // Translates a doc-side code to its local-sandbox equivalent. Values that
  // aren't a known scenario player code — null, undefined, or the literal
  // 'skip' vote choice — pass through unchanged.
  const translate = (docCode) => (docCode == null ? docCode : (localCodeForDocCode.get(docCode) ?? docCode));

  // Apply game-level fields first (phase, round, dayStage, drift/reveal
  // options, etc.) — BEFORE any player field is touched, since
  // adminUpdatePlayer clamps drift to [0, max_drift] using whatever
  // max_drift is current at call time. Setting it after restoring drift
  // values would silently corrupt any drift saved above a fresh sandbox's
  // default max_drift.
  sandbox.setGameFields({
    phase: doc.game.phase,
    round: doc.game.round,
    dayStage: doc.game.dayStage,
    patientZero: translate(doc.game.patientZero),
    lastTorturedTarget: translate(doc.game.lastTorturedTarget),
    lastTortureTier: doc.game.lastTortureTier,
    maxDrift: doc.options?.maxDrift,
    deathReveal: doc.options?.deathReveal,
    anonymized: doc.options?.anonymized,
    warpTaintVisible: doc.options?.warpTaintVisible,
  });

  // Apply player-level fields (role, faction, drift, alive, cripple, flags, causes)
  for (const playerDoc of doc.players) {
    const localCode = translate(playerDoc.playerCode);

    // Common fields via updatePlayer. roleId/faction are included so this
    // also works against a fresh sandbox whose roster/manualAssignments
    // don't happen to match the scenario's — the board converges on the
    // saved state regardless of what the fresh sandbox started with.
    sandbox.updatePlayer(localCode, {
      roleId: playerDoc.roleId,
      faction: playerDoc.faction,
      drift: playerDoc.drift,
      alive: playerDoc.alive ? 1 : 0,
      crippleTier: playerDoc.crippleTier,
    });

    // Raw fields via setPlayerRaw (tortured_before, mark_public, possessed_by, etc.)
    sandbox.setPlayerRaw(localCode, {
      torturedBefore: playerDoc.torturedBefore,
      markPublic: playerDoc.markPublic,
      possessedBy: translate(playerDoc.possessedBy),
      possessionRevealed: playerDoc.possessionRevealed,
      plagueCarrier: playerDoc.plagueCarrier,
      tier1UntilRound: playerDoc.tier1UntilRound,
      skipNextNight: playerDoc.skipNextNight,
      deathCause: playerDoc.deathCause,
    });
  }

  // Re-submit night actions for the current round.
  // (Actions are validated; silently rejected if they would fail validation.)
  for (const action of doc.actions) {
    try {
      const actorCode = translate(action.actorCode);
      const targetCode = translate(action.targetCode);
      if (action.kind === 'blood-ritual') {
        // Blood Ritual is a faction-wide action, not tied to the actor's own
        // role — submitAction() dispatches purely off the actor's role.actions
        // entry and has no `kind` parameter, so routing a blood-ritual doc
        // entry through it would silently submit whatever THAT role's own
        // night action is instead (wrong kind, wrong validation).
        manager.submitFactionAction(code, actorCode, { targetCode });
      } else {
        manager.submitAction(code, actorCode, {
          targetCode,
          variant: action.variant,
          data: action.data,
        });
      }
    } catch {
      // Silently skip actions that fail validation (e.g., role no longer has that action).
      // The scenario is a snapshot in time; it's not required to be playable forward.
    }
  }

  // Re-submit day votes for the current round
  for (const vote of doc.votes) {
    try {
      manager.vote(code, translate(vote.voterCode), translate(vote.choice), vote.justification);
    } catch {
      // Silently skip votes that fail validation.
    }
  }

  // Re-set ability usage counters (kill, possess, infect limits)
  for (const u of doc.usage) {
    sandbox.setUsage(translate(u.playerCode), u.ability, u.uses);
  }
}
