import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createH1Murderer } from '../src/strategies/heretic.js';
import { HeresyGameManager } from '../../heresy-server/src/heresyGameManager.js';
import { seedableRNG } from '../src/util.js';
import { createHeuristicAgent, collectNightActions, collectDayVotes, collectInterrogationResponses } from '../src/agent.js';

// ── H1 Murderer: drift-gate awareness ───────────────────────────────────────
// Regression guard for the bug where the Murderer heuristic always attempted
// a kill regardless of its own drift. Kill costs a flat +15 and is gated once
// drift+15 exceeds maxDrift, so a single unblocked attempt already lands the
// Murderer at ~15-17 drift — every later attempt is gated. Because the old
// heuristic kept submitting an action every night anyway, it never qualified
// for the passive -1/night sleep recovery and was permanently frozen after
// its first attempt, for the rest of every game. See L3 Chirurgeon (self-
// protects when own drift >= 5) and L7 Sanctioned Psyker (explicitly sleeps
// to recover) for the pre-existing drift-aware pattern this now matches.

test('H1 Murderer: sleeps (returns null) instead of attacking once gated', () => {
  const agent = createH1Murderer('sim-p1', new Map());
  const state = {
    me: { playerCode: 'sim-p1', drift: 16 },
    maxDrift: 20,
    legalTargets: ['sim-p2', 'sim-p3'],
    living: [],
    voteTally: [],
  };
  assert.equal(agent.nightAction(state), null);
});

test('H1 Murderer: still attacks when a kill would not be gated', () => {
  const agent = createH1Murderer('sim-p1', new Map());
  const state = {
    me: { playerCode: 'sim-p1', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p2', 'sim-p3'],
    living: [],
    voteTally: [],
  };
  const action = agent.nightAction(state);
  assert.ok(action);
  assert.ok(state.legalTargets.includes(action.targetCode));
});

test('H1 Murderer: attacks exactly at the gate boundary (drift+15 == maxDrift is not gated)', () => {
  const agent = createH1Murderer('sim-p1', new Map());
  const state = {
    me: { playerCode: 'sim-p1', drift: 5 },
    maxDrift: 20,
    legalTargets: ['sim-p2'],
    living: [],
    voteTally: [],
  };
  assert.ok(agent.nightAction(state));
});

test('H1 Murderer: gated one drift point past the boundary', () => {
  const agent = createH1Murderer('sim-p1', new Map());
  const state = {
    me: { playerCode: 'sim-p1', drift: 6 },
    maxDrift: 20,
    legalTargets: ['sim-p2'],
    living: [],
    voteTally: [],
  };
  assert.equal(agent.nightAction(state), null);
});

// ── Integration guard ────────────────────────────────────────────────────
// Runs the real engine end-to-end (mirrors runSingleGame's loop, but keeps
// the manager open afterward so the test can inspect hr_events directly)
// and confirms a drift-aware Murderer can recover and pay the kill-cost
// drift charge more than once in a single long game. Each *unblocked* kill
// attempt (landed or Chirurgeon-blocked — cost applies either way) logs
// exactly one hr_events row of type='drift'/reason='night-action' for the
// Murderer; every *gated* attempt logs none. Under the old always-attack
// heuristic this count could never exceed 1 for the whole game, since the
// first attempt already lands drift ~15-17 and gates every attempt after —
// so seeing 2+ here is only possible with the sleep-to-recover fix.
function runSeededGame(playerCount, seed, maxRounds = 50) {
  const rng = seedableRNG(seed);
  const clock = 1_000_000;
  const origMathRandom = Math.random;
  Math.random = rng;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-sim-test-'));
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => clock, random: rng });
  try {
    const hostCode = 'sim-host';
    const { code } = manager.create({ playerCode: hostCode, name: 'Simulator' });
    const agents = new Map();
    const playerCodes = [hostCode];
    const factionState = new Map();
    for (let i = 1; i < playerCount; i++) {
      const playerCode = `sim-p${i}`;
      playerCodes.push(playerCode);
      manager.join({ code, playerCode, name: `P${i}` });
      manager.ready(code, playerCode, true);
    }
    manager.start(code, hostCode);
    for (const p of manager.players(code)) agents.set(p.player_code, createHeuristicAgent(p.role_id, p.player_code, factionState));

    let game = manager.game(code), rounds = 0;
    while (game.status === 'active' && rounds < maxRounds) {
      rounds++;
      if (game.phase === 'night') {
        collectNightActions(manager, code, agents, false);
        manager.resolve(code, true);
      } else if (game.phase === 'day') {
        if (game.round === 1) {
          manager.advance(code, hostCode);
        } else if (game.day_stage === 'response') {
          collectInterrogationResponses(manager, code, agents, false);
          manager.advance(code, hostCode);
        } else {
          collectDayVotes(manager, code, agents, false);
          manager.advance(code, hostCode);
        }
      } else {
        break;
      }
      game = manager.game(code);
    }

    const murderer = manager.players(code).find(p => p.role_id === 'murderer');
    const killChargeCount = murderer
      ? manager.db.prepare("SELECT COUNT(*) AS n FROM hr_events WHERE game_code=? AND type='drift' AND json_extract(payload,'$.playerCode')=? AND json_extract(payload,'$.reason')='night-action'").get(code, murderer.player_code).n
      : 0;
    return { killChargeCount };
  } finally {
    manager.close();
    Math.random = origMathRandom;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test('engine integration: a drift-aware Murderer pays the kill-cost charge more than once across a batch of long games (8p)', () => {
  const maxCharges = Math.max(...Array.from({ length: 25 }, (_, i) => runSeededGame(8, 9000 + i, 50).killChargeCount));
  assert.ok(maxCharges >= 2, `expected at least one game with 2+ kill-cost charges (recovered and attacked again); got max ${maxCharges}`);
});
