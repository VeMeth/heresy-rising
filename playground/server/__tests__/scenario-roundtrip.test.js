// Save a board, build a completely independent fresh sandbox, apply the
// saved scenario, and check the two boards match field-for-field —
// including hr_usage counters, which are easy to forget and, if dropped,
// silently break the once-per-game gates (Sanctioned Psyker kill, Animus
// possess, Poxwalker infect) on reload.
//
// applyScenario() cannot rely on literal player-code equality between the
// two sandboxes: createSandbox() (sandbox.js) stamps every player code with
// a fresh session UUID on every call, so two independently built sandboxes
// NEVER share a player code, even built from the same players/roster. The
// scenario doc is translated onto the fresh sandbox by SEAT instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../sandbox.js';
import { saveScenario, loadScenario, applyScenario, listScenarios } from '../scenarios.js';
import { KILL_CHAIN_ROSTER, mkPlayers } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, '..', '..', 'scenarios');

/** Deletes a scenario file if it exists, ignoring "already gone". */
function cleanupScenario(name) {
  try { fs.unlinkSync(path.join(SCENARIOS_DIR, `${name}.json`)); } catch { /* already gone */ }
}

function comparablePlayerFields(row) {
  // display_order is a cosmetic, RNG-shuffled seating value assigned at
  // start() time (not part of ScenarioDoc — scenarios.js never claims to
  // capture it), so it's excluded here rather than asserted to match.
  const { player_code, game_code, name, display_order, ...rest } = row;
  return rest;
}

test('scenario round-trip: save -> fresh sandbox -> apply -> matches field-for-field, including usage counters', () => {
  const scenarioName = 'roundtrip_test_scn_1';
  cleanupScenario(scenarioName);
  const players = mkPlayers(KILL_CHAIN_ROSTER.length);

  const original = createSandbox({ players, roster: KILL_CHAIN_ROSTER, seed: 11, options: { maxDrift: 20 } });
  try {
    const [psyker, chir, arb, sab, murd, c1, c2, c3] = original.listPlayerCodes().map(p => p.playerCode);
    original.forcePhase('night', 1, null);
    original.manager.submitAction(original.code, sab, { targetCode: c1 });
    original.manager.submitAction(original.code, psyker, { targetCode: c1 });
    original.manager.submitAction(original.code, chir, { targetCode: c2 });
    original.updatePlayer(murd, { drift: 6 });
    original.setPlayerRaw(c3, { markPublic: true, plagueCarrier: true });
    // Simulate the Sanctioned Psyker's kill already having been used —
    // exactly the kind of state that silently breaks on reload without
    // hr_usage capture.
    original.setUsage(psyker, 'kill', 1);

    const saved = saveScenario(scenarioName, original, { description: 'round-trip fixture' });
    assert.equal(saved.name, scenarioName);
    assert.ok(listScenarios().some(s => s.name === scenarioName), 'shows up in listScenarios()');

    const doc = loadScenario(scenarioName);
    assert.equal(doc.usage.length, 1, 'the kill-usage row was captured');
    assert.equal(doc.actions.length, 3, 'all three submitted actions were captured');

    // A totally independent fresh sandbox — different seed, so its own
    // random draws (and therefore its own player codes) share nothing with
    // `original`.
    const fresh = createSandbox({ players, roster: KILL_CHAIN_ROSTER, seed: 999999, options: { maxDrift: 20 } });
    try {
      applyScenario(fresh, doc);

      const originalPlayers = original.manager.players(original.code).sort((a, b) => a.seat - b.seat);
      const freshPlayers = fresh.manager.players(fresh.code).sort((a, b) => a.seat - b.seat);
      assert.equal(freshPlayers.length, originalPlayers.length);
      for (let i = 0; i < originalPlayers.length; i++) {
        assert.deepStrictEqual(
          comparablePlayerFields(freshPlayers[i]),
          comparablePlayerFields(originalPlayers[i]),
          `seat ${i} matches field-for-field`
        );
      }

      const og = original.manager.game(original.code);
      const fg = fresh.manager.game(fresh.code);
      for (const key of ['phase', 'round', 'day_stage', 'max_drift', 'death_reveal', 'anonymized', 'warp_taint_visible', 'patient_zero', 'last_tortured_target', 'last_torture_tier']) {
        assert.equal(fg[key], og[key], `game.${key} matches`);
      }

      // Usage counters, keyed by SEAT (codes differ between sandboxes) since
      // that's what applyScenario translates through.
      const freshHost = fresh.listPlayerCodes().find(p => p.seat === 0).playerCode;
      const usage = fresh.manager.usage(fresh.code, freshHost, 'kill');
      assert.equal(usage, 1, 'kill usage counter round-tripped');

      // Actions/votes translated onto the fresh sandbox's own codes, not left
      // pointing at the original sandbox's (now-foreign) codes.
      const freshActions = fresh.manager.db
        .prepare('SELECT actor_code, kind, target_code FROM hr_actions WHERE game_code=? AND round=1 ORDER BY kind')
        .all(fresh.code);
      assert.equal(freshActions.length, 3);
      for (const row of freshActions) {
        assert.ok(row.actor_code.startsWith(fresh.hostCode.split('-p')[0]), 'actor code belongs to the fresh sandbox, not the original');
      }
    } finally {
      fresh.close();
    }
  } finally {
    original.close();
    cleanupScenario(scenarioName);
  }
});

test('scenario name sanitization rejects path traversal and absolute paths', () => {
  const dummy = createSandbox({ players: mkPlayers(5), roster: ['murderer', 'imperial-citizen', 'imperial-citizen', 'imperial-citizen', 'imperial-citizen'], seed: 1 });
  try {
    const attempts = ['../evil', '../../etc/passwd', '/etc/passwd', 'a/b', 'a\\b', '..', '', '   '];
    for (const bad of attempts) {
      assert.throws(() => saveScenario(bad, dummy, {}), `saveScenario rejects ${JSON.stringify(bad)}`);
      assert.throws(() => loadScenario(bad), `loadScenario rejects ${JSON.stringify(bad)}`);
    }
    // Confirm no file escaped playground/scenarios/ as a side effect of any
    // of the above.
    assert.ok(!fs.existsSync(path.join(SCENARIOS_DIR, '..', 'evil.json')));
    assert.ok(!fs.existsSync('/etc/passwd.json'));
  } finally {
    dummy.close();
  }
});

test('a scenario name is normalized to [a-zA-Z0-9_-] rather than silently colliding with an unrelated file', () => {
  const dummy = createSandbox({ players: mkPlayers(5), roster: ['murderer', 'imperial-citizen', 'imperial-citizen', 'imperial-citizen', 'imperial-citizen'], seed: 2 });
  try {
    const saved = saveScenario('weird name! @@ 123', dummy, {});
    try {
      assert.equal(saved.name, 'weirdname123');
      assert.match(path.basename(saved.path), /^[a-zA-Z0-9_-]+\.json$/);
      const doc = loadScenario('weird name! @@ 123'); // sanitizes the same way on load
      assert.equal(doc.name, 'weirdname123');
    } finally {
      cleanupScenario('weirdname123');
    }
  } finally {
    dummy.close();
  }
});
