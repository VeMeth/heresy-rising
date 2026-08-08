/**
 * Generate a runnable node:test regression test from a board state.
 *
 * Captures an interesting board setup and its resolution as a permanent
 * test case, so the exact sequence of moves and outcomes stays green in CI.
 * Generated files are meant to be manually reviewed and moved into
 * heresy-server/test/ — they start in playground/exports/ to avoid
 * accidentally writing into the engine's test suite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, '../exports');

/**
 * Sanitize a test name for safe use as a filename.
 * Same rules as scenarios: [a-zA-Z0-9_-] only, max 100 chars.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  if (typeof name !== 'string') throw new Error('Test name must be a string');
  if (!name) throw new Error('Test name must not be empty');
  if (name.length > 100) throw new Error('Test name must be <= 100 characters');

  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Test name must not contain path separators or traversal sequences');
  }

  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) {
    throw new Error('Test name must contain at least one alphanumeric character, underscore, or hyphen');
  }

  return sanitized;
}

/**
 * Escape a string for use in a JavaScript string literal.
 * Uses JSON.stringify to handle quotes, backslashes, newlines, etc.
 *
 * @param {string} str
 * @returns {string} quoted and escaped string, ready to paste into code
 */
function escapeString(str) {
  return JSON.stringify(str);
}

/**
 * Render free-form text as one or more `//` comment lines, safe to splice
 * directly into generated source. Every line — including ones produced by
 * splitting on \r\n, \r, or \n — gets its own `// ` prefix, so the text can
 * never break out of the comment no matter what it contains.
 *
 * @param {string} text
 * @returns {string}
 */
function commentBlock(text) {
  return String(text)
    .split(/\r\n|\r|\n/)
    .map(line => `// ${line}`)
    .join('\n');
}

/**
 * Generate a runnable node:test file from a board state.
 * Outputs to playground/exports/<name>.test.js by default.
 *
 * @param {Object} opts
 * @param {Sandbox} opts.sandbox - The board state to test
 * @param {Object} [opts.trace] - The last resolution's outcomes. If omitted, a minimal
 *   trace object is used with just player status fields.
 * @param {string} opts.name - Test file name (becomes filename)
 * @param {string} [opts.description] - Optional description for the generated file
 * @param {string} [opts.outputPath] - Custom output directory (defaults to playground/exports)
 * @returns {{path: string, source: string}} - path to the generated file and its source
 */
export function exportTest(opts = {}) {
  const { sandbox, trace, name, description, outputPath } = opts;

  if (!sandbox) throw new Error('exportTest requires opts.sandbox');
  if (!name) throw new Error('exportTest requires opts.name');

  const sanitized = sanitizeName(name);
  const outDir = outputPath || EXPORTS_DIR;

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Build the source code
  const source = generateTestSource({ sandbox, trace, name: sanitized, description, outDir });

  // Write to file
  const filePath = path.join(outDir, `${sanitized}.test.js`);
  fs.writeFileSync(filePath, source, 'utf-8');

  return { path: filePath, source };
}

/**
 * Generate the test file source code.
 *
 * @param {Object} opts
 * @param {Sandbox} opts.sandbox
 * @param {Object} [opts.trace]
 * @param {string} opts.name
 * @param {string} [opts.description]
 * @param {string} opts.outDir - Directory the generated file will be written to
 *   (needed to compute the relative import paths below).
 * @returns {string} JavaScript source code
 */
function generateTestSource(opts) {
  const { sandbox, trace, name, description, outDir } = opts;
  const { manager, code, seed } = sandbox;
  const gameRow = manager.game(code);
  const playerRows = manager.players(code);

  if (!gameRow) throw new Error('Game not found');

  // Build a trace object if not provided
  const traceData = trace || buildMinimalTrace(manager, code);

  // Extract scenario data
  const currentRound = gameRow.round;
  const actions = manager.db.prepare(
    'SELECT actor_code, kind, target_code, variant, data FROM hr_actions WHERE game_code=? AND round=?'
  ).all(code, currentRound) || [];

  const votes = manager.db.prepare(
    'SELECT voter_code, choice, justification FROM hr_votes WHERE game_code=? AND round=?'
  ).all(code, currentRound) || [];

  const usage = manager.db.prepare(
    'SELECT player_code, ability, uses FROM hr_usage WHERE game_code=?'
  ).all(code) || [];

  // Build the manual assignments (seat -> roleId)
  const manualAssignments = {};
  const players = [];
  playerRows.forEach((p, i) => {
    manualAssignments[p.player_code] = p.role_id;
    players.push({
      playerCode: p.player_code,
      name: p.name,
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
    });
  });

  // Build the assertions for the trace
  const traceAssertions = buildTraceAssertions(traceData, players, gameRow);

  // Compute the import path from the output directory to heresy-server/src.
  // Derived from this file's own location (playground/server/) rather than
  // hardcoded, so exportTest keeps working if the repo is ever checked out
  // somewhere other than this exact path.
  const repoRoot = path.resolve(__dirname, '..', '..');
  const heresyPath = path.join(repoRoot, 'heresy-server/src/heresyGameManager.js');
  const scenariosPath = path.join(repoRoot, 'playground/server/scenarios.js');
  const relHeresyPath = path.relative(outDir, heresyPath);
  const relScenariosPath = path.relative(outDir, scenariosPath);

  // Generate the source. `description` is free-form user text and may
  // contain newlines — embedded raw it would close the `//` comment early
  // and spill into the source as executable code (or a syntax error).
  // commentBlock() below prefixes every line with `// ` so it can never
  // escape the comment, however many lines it has.
  const descriptionComment = description ? `${commentBlock(description)}\n` : '';
  return `// Regression test: ${name}
// Generated from playground scenario on ${new Date().toISOString()}
${descriptionComment}// This test rebuilds an interesting board state and verifies the exact outcomes.
// To move this test into heresy-server/test/:
//   1. Adjust the import paths above (currently relative to playground/exports/)
//   2. Copy the scenario JSON file from playground/scenarios/ into this test's directory
//   3. Run the test to verify it passes in its new location

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from ${escapeString(relHeresyPath)};
import { scenarioFromSandbox, applyScenario } from ${escapeString(relScenariosPath)};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-test-'));
  const manager = new HeresyGameManager({
    databasePath: path.join(dir, 'game.db'),
    now: () => 1_000_000,
    random: () => 0.9,
  });
  return { manager, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test(${escapeString(name)}, () => {
  const f = fixture();
  try {
    // Build the board from scratch with deterministic role assignment.
    // Every seat (including the host) keeps its ORIGINAL playground player
    // code — manualAssignments below is keyed by those same codes, so the
    // host must join under its real code, not a placeholder like 'p0'.
    const hostCode = ${escapeString(players[0].playerCode)};
    const { code } = f.manager.create({ playerCode: hostCode, name: ${escapeString(players[0].name)} });

    for (let i = 1; i < ${players.length}; i++) {
      const player = [${players.map(p => `{ name: ${escapeString(p.name)}, playerCode: ${escapeString(p.playerCode)} }`).join(', ')}][i];
      f.manager.join({ code, playerCode: player.playerCode, name: player.name });
      f.manager.ready(code, player.playerCode, true);
    }

    // Ready the host
    f.manager.ready(code, hostCode, true);

    // Start with full manual composition — admin-list the host first
    const manualAssignments = {
${Object.entries(manualAssignments).map(([pc, roleId]) => `      ${escapeString(pc)}: ${escapeString(roleId)},`).join('\n')}
    };

    const roster = [
${playerRows.map(p => `      ${escapeString(p.role_id)},`).join('\n')}
    ];

    f.manager.adminPlayerCodes.add(hostCode);
    const startResult = f.manager.start(code, hostCode, {
      maxDrift: ${gameRow.max_drift},
      composition: { source: 'custom', roster, manualAssignments, confirmedWarnings: [] },
    });
    assert.ok(!startResult || startResult.ok !== false, 'start succeeded');

    // Verify every seat landed the requested role
    for (const pc of Object.keys(manualAssignments)) {
      const player = f.manager.player(code, pc);
      assert.equal(player.role_id, manualAssignments[pc], \`\${pc} has correct role\`);
    }

    // Apply the scenario to restore the exact board state
    const scenario = {
      version: '1',
      name: ${escapeString(name)},
      savedAt: Date.now(),
      seed: ${seed},
      options: {
        maxDrift: ${gameRow.max_drift},
        deathReveal: ${escapeString(gameRow.death_reveal)},
        anonymized: ${Boolean(gameRow.anonymized)},
        warpTaintVisible: ${Boolean(gameRow.warp_taint_visible)},
      },
      players: [
${players.map(p => `        {
          name: ${escapeString(p.name)},
          playerCode: ${escapeString(p.playerCode)},
          seat: ${p.seat},
          roleId: ${escapeString(p.roleId)},
          faction: ${escapeString(p.faction)},
          drift: ${p.drift},
          alive: ${p.alive},
          crippleTier: ${p.crippleTier},
          torturedBefore: ${p.torturedBefore},
          markPublic: ${p.markPublic},
          possessedBy: ${p.possessedBy ? escapeString(p.possessedBy) : 'null'},
          possessionRevealed: ${p.possessionRevealed},
          plagueCarrier: ${p.plagueCarrier},
          tier1UntilRound: ${p.tier1UntilRound ? escapeString(p.tier1UntilRound) : 'null'},
          skipNextNight: ${p.skipNextNight},
          deathCause: ${p.deathCause ? escapeString(p.deathCause) : 'null'},
        },`).join('\n')}
      ],
      game: {
        phase: ${escapeString(gameRow.phase)},
        round: ${gameRow.round},
        dayStage: ${gameRow.day_stage ? escapeString(gameRow.day_stage) : 'null'},
        patientZero: ${gameRow.patient_zero ? escapeString(gameRow.patient_zero) : 'null'},
        lastTorturedTarget: ${gameRow.last_tortured_target ? escapeString(gameRow.last_tortured_target) : 'null'},
        lastTortureTier: ${gameRow.last_torture_tier},
      },
      actions: [
${actions.map(a => `        { actorCode: ${escapeString(a.actor_code)}, kind: ${escapeString(a.kind)}, targetCode: ${a.target_code ? escapeString(a.target_code) : 'null'}, variant: ${a.variant ? escapeString(a.variant) : 'null'}, data: ${a.data ? escapeString(a.data) : 'null'} },`).join('\n')}
      ],
      votes: [
${votes.map(v => `        { voterCode: ${escapeString(v.voter_code)}, choice: ${escapeString(v.choice)}, justification: ${v.justification ? escapeString(v.justification) : 'null'} },`).join('\n')}
      ],
      usage: [
${usage.map(u => `        { playerCode: ${escapeString(u.player_code)}, ability: ${escapeString(u.ability)}, uses: ${u.uses} },`).join('\n')}
      ],
    };

    // Create a sandbox-like wrapper to use applyScenario
    const sandboxWrapper = {
      manager: f.manager,
      code,
      updatePlayer: (pc, updates) => f.manager.adminUpdatePlayer(code, pc, updates),
      setPlayerRaw: (pc, updates) => {
        // Manually apply raw fields (this is a simplified version)
        for (const [key, value] of Object.entries(updates)) {
          if (key === 'torturedBefore') {
            f.manager.db.prepare('UPDATE hr_players SET tortured_before=? WHERE game_code=? AND player_code=?').run(value ? 1 : 0, code, pc);
          } else if (key === 'markPublic') {
            f.manager.db.prepare('UPDATE hr_players SET mark_public=? WHERE game_code=? AND player_code=?').run(value ? 1 : 0, code, pc);
          } else if (key === 'possessedBy') {
            f.manager.db.prepare('UPDATE hr_players SET possessed_by=? WHERE game_code=? AND player_code=?').run(value, code, pc);
          } else if (key === 'possessionRevealed') {
            f.manager.db.prepare('UPDATE hr_players SET possession_revealed=? WHERE game_code=? AND player_code=?').run(value ? 1 : 0, code, pc);
          } else if (key === 'plagueCarrier') {
            f.manager.db.prepare('UPDATE hr_players SET plague_carrier=? WHERE game_code=? AND player_code=?').run(value ? 1 : 0, code, pc);
          } else if (key === 'tier1UntilRound') {
            f.manager.db.prepare('UPDATE hr_players SET tier1_until_round=? WHERE game_code=? AND player_code=?').run(value, code, pc);
          } else if (key === 'skipNextNight') {
            f.manager.db.prepare('UPDATE hr_players SET skip_next_night=? WHERE game_code=? AND player_code=?').run(value ? 1 : 0, code, pc);
          } else if (key === 'deathCause') {
            f.manager.db.prepare('UPDATE hr_players SET death_cause=? WHERE game_code=? AND player_code=?').run(value, code, pc);
          }
        }
      },
      setGameFields: (updates) => {
        for (const [key, value] of Object.entries(updates)) {
          if (key === 'phase') {
            f.manager.db.prepare('UPDATE hr_games SET phase=? WHERE code=?').run(value, code);
          } else if (key === 'round') {
            f.manager.db.prepare('UPDATE hr_games SET round=? WHERE code=?').run(value, code);
          } else if (key === 'dayStage') {
            f.manager.db.prepare('UPDATE hr_games SET day_stage=? WHERE code=?').run(value, code);
          } else if (key === 'patientZero') {
            f.manager.db.prepare('UPDATE hr_games SET patient_zero=? WHERE code=?').run(value, code);
          } else if (key === 'lastTorturedTarget') {
            f.manager.db.prepare('UPDATE hr_games SET last_tortured_target=? WHERE code=?').run(value, code);
          } else if (key === 'lastTortureTier') {
            f.manager.db.prepare('UPDATE hr_games SET last_torture_tier=? WHERE code=?').run(value, code);
          }
        }
      },
      setUsage: (pc, ability, uses) => {
        f.manager.db.prepare(
          'INSERT INTO hr_usage(game_code,player_code,ability,uses) VALUES(?,?,?,?) ' +
          'ON CONFLICT(game_code,player_code,ability) DO UPDATE SET uses=excluded.uses'
        ).run(code, pc, String(ability), Math.max(0, Number(uses) || 0));
      },
    };

    // Apply the scenario to the board
    applyScenario(sandboxWrapper, scenario);

${traceAssertions}
  } finally {
    f.close();
  }
});
`;
}

/**
 * Build a minimal trace object from the current board state.
 * Used when no explicit trace is provided.
 *
 * @param {HeresyGameManager} manager
 * @param {string} code
 * @returns {Object} minimal trace
 */
function buildMinimalTrace(manager, code) {
  const players = manager.players(code);
  const game = manager.game(code);

  return {
    playerStates: players.map(p => ({
      playerCode: p.player_code,
      alive: Boolean(p.alive),
      drift: p.drift,
      crippleTier: p.cripple_tier,
      deathCause: p.death_cause || null,
    })),
    gamePhase: game.phase,
    gameRound: game.round,
  };
}

/**
 * Generate assertion code for trace validation.
 *
 * Player/game-state assertions are always built from `players`/`gameRow` —
 * the exact rows read from the live sandbox at export time — NOT from
 * `trace`. This matters because two very different shapes can arrive as
 * `trace`: the {playerStates,gamePhase,gameRound} shape buildMinimalTrace()
 * produces when the caller passes no trace, and the real Trace object
 * trace.js's captureResolution() returns (which has no `playerStates`,
 * `gamePhase` or `gameRound` field at all — it has `diff.players`, `deaths`,
 * `stations`, etc). Deriving the core assertions from `players`/`gameRow`
 * instead means both shapes produce identical, correct output rather than
 * the real-trace shape silently generating ZERO assertions (which is what
 * happened before this was keyed off `players`/`gameRow`).
 *
 * `trace.deaths` (only present on a real Trace) is used for a bonus
 * cause/attribution assertion when available — extra regression value with
 * no risk to the minimal-trace fallback, which simply doesn't have it.
 *
 * @param {Object} trace
 * @param {Array} players
 * @param {Object} gameRow
 * @returns {string} JavaScript assertion code
 */
function buildTraceAssertions(trace, players, gameRow) {
  const lines = [];

  lines.push('    // Verify outcomes match the exported board state');

  for (const p of players) {
    lines.push(`    {`);
    lines.push(`      const p = f.manager.player(code, ${escapeString(p.playerCode)});`);
    lines.push(`      assert.equal(p.alive, ${p.alive ? 1 : 0}, ${escapeString(`${p.playerCode} alive status`)});`);
    lines.push(`      assert.equal(p.drift, ${p.drift}, ${escapeString(`${p.playerCode} drift`)});`);
    lines.push(`      assert.equal(p.cripple_tier, ${p.crippleTier}, ${escapeString(`${p.playerCode} cripple tier`)});`);
    if (p.deathCause) {
      lines.push(`      assert.equal(p.death_cause, ${escapeString(p.deathCause)}, ${escapeString(`${p.playerCode} death cause`)});`);
    }
    lines.push(`    }`);
  }

  lines.push(`    {`);
  lines.push(`      const g = f.manager.game(code);`);
  lines.push(`      assert.equal(g.phase, ${escapeString(gameRow.phase)}, 'game phase');`);
  lines.push(`      assert.equal(g.round, ${gameRow.round}, 'game round');`);
  lines.push(`    }`);

  if (Array.isArray(trace?.deaths)) {
    for (const death of trace.deaths) {
      if (!death.attributedTo) continue;
      lines.push(`    assert.equal(f.manager.player(code, ${escapeString(death.playerCode)}).death_cause, ${escapeString(death.cause)}, ${escapeString(`${death.playerCode} death cause matches the captured trace`)});`);
    }
  }

  return lines.join('\n');
}
