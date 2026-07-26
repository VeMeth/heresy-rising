import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createH1Murderer, createH2HereticPriest, createH3Conspirator, createH4Saboteur } from '../src/strategies/heretic.js';
import { HeresyGameManager } from '../../heresy-server/src/heresyGameManager.js';
import { seedableRNG } from '../src/util.js';
import { createHeuristicAgent, collectNightActions, collectDayVotes, collectTortureResponses } from '../src/agent.js';

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

// ── Blood Ritual coordination ────────────────────────────────────────────
// Blood Ritual is a faction-wide night action (any living, uncrippled
// Heretic can submit it — engine: submitFactionAction), and escalation to a
// kill is tracked by TARGET only, not by attacker, so a second Heretic can
// legitimately rotate the attack. These strategies previously had zero
// awareness the mechanic existed at all. Priority order (see heretic.js's
// BLOOD_RITUAL_PRIORITY comment): Conspirator > Heretic Priest > Saboteur >
// Murderer (Murderer only as a gated fallback, checked from its own branch).

test('H3 Conspirator: takes Blood Ritual duty as the sole registered Heretic (no other night action to give up)', () => {
  const factionState = new Map();
  const conspirator = createH3Conspirator('sim-p1', factionState);
  const state = {
    me: { playerCode: 'sim-p1', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p2', 'sim-p3'],
    living: [
      { playerCode: 'sim-p1', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p2', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const action = conspirator.nightAction(state);
  assert.ok(action);
  assert.equal(action.factionAction, true);
});

test('H2 Heretic Priest: defers Blood Ritual duty to a living Conspirator (falls back to its own sermon)', () => {
  const factionState = new Map();
  createH3Conspirator('sim-p1', factionState); // registers 'conspirator' at sim-p1
  const priest = createH2HereticPriest('sim-p2', factionState); // registers 'heretic-priest' at sim-p2
  const state = {
    me: { playerCode: 'sim-p2', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p3', 'sim-p4'],
    living: [
      { playerCode: 'sim-p1', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const action = priest.nightAction(state);
  assert.ok(action);
  assert.equal(action.factionAction, undefined, 'sermon action, not a faction action');
  assert.ok(action.variant, 'sermon actions always carry a variant');
});

test('H2 Heretic Priest: takes Blood Ritual duty when no higher-priority Heretic is alive', () => {
  const factionState = new Map();
  const priest = createH2HereticPriest('sim-p2', factionState);
  const state = {
    me: { playerCode: 'sim-p2', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p3'],
    living: [
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const action = priest.nightAction(state);
  assert.ok(action);
  assert.equal(action.factionAction, true);
});

test('H2 Heretic Priest: a crippled higher-priority Heretic is skipped in the priority computation', () => {
  const factionState = new Map();
  createH3Conspirator('sim-p1', factionState);
  const priest = createH2HereticPriest('sim-p2', factionState);
  const state = {
    me: { playerCode: 'sim-p2', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p3'],
    living: [
      { playerCode: 'sim-p1', faction: 'heretic', crippleTier: 2 }, // Conspirator crippled — can't act
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const action = priest.nightAction(state);
  assert.equal(action.factionAction, true, 'priest picks up duty since the Conspirator cannot act this round');
});

test('H4 Saboteur: falls back to its own trap when a higher-priority Heretic has duty', () => {
  const factionState = new Map();
  createH2HereticPriest('sim-p2', factionState);
  const saboteur = createH4Saboteur('sim-p3', factionState);
  const state = {
    me: { playerCode: 'sim-p3', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p4'],
    living: [
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p4', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const action = saboteur.nightAction(state);
  assert.equal(action.factionAction, undefined, 'trap action, not a faction action');
});

test('H1 Murderer: gated with a living Heretic Priest available sleeps, leaving Blood Ritual to them', () => {
  const factionState = new Map();
  const murderer = createH1Murderer('sim-p1', factionState);
  createH2HereticPriest('sim-p2', factionState);
  const state = {
    me: { playerCode: 'sim-p1', drift: 16 },
    maxDrift: 20,
    legalTargets: ['sim-p3'],
    living: [
      { playerCode: 'sim-p1', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  assert.equal(murderer.nightAction(state), null, 'defers to the Heretic Priest, who has strictly higher Blood Ritual priority');
});

test('H1 Murderer: gated with no other living Heretic falls back to Blood Ritual itself', () => {
  const factionState = new Map();
  const murderer = createH1Murderer('sim-p1', factionState);
  const state = {
    me: { playerCode: 'sim-p1', drift: 16 },
    maxDrift: 20,
    legalTargets: ['sim-p3'],
    living: [
      { playerCode: 'sim-p1', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const action = murderer.nightAction(state);
  assert.ok(action, 'a solo gated Murderer (e.g. 5p) still has an offensive option');
  assert.equal(action.factionAction, true);
});

test('Blood Ritual target locks across consecutive nights (drives the engine\'s same-target escalation to a kill)', () => {
  const factionState = new Map();
  const priest = createH2HereticPriest('sim-p2', factionState);
  const state = {
    me: { playerCode: 'sim-p2', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p3', 'sim-p4'],
    living: [
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
      { playerCode: 'sim-p4', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const first = priest.nightAction(state);
  const second = priest.nightAction(state);
  assert.equal(first.targetCode, second.targetCode, 'same target locked in across both calls');
});

test('Blood Ritual picks a fresh target once the locked one is no longer legal (dead)', () => {
  const factionState = new Map();
  const priest = createH2HereticPriest('sim-p2', factionState);
  const round1 = {
    me: { playerCode: 'sim-p2', drift: 0 },
    maxDrift: 20,
    legalTargets: ['sim-p3', 'sim-p4'],
    living: [
      { playerCode: 'sim-p2', faction: 'heretic', crippleTier: 0 },
      { playerCode: 'sim-p3', faction: null, crippleTier: 0 },
      { playerCode: 'sim-p4', faction: null, crippleTier: 0 },
    ],
    voteTally: [],
  };
  const locked = priest.nightAction(round1).targetCode;
  // Locked target died — no longer a legal night target.
  const round2 = { ...round1, legalTargets: round1.legalTargets.filter(t => t !== locked) };
  const next = priest.nightAction(round2);
  assert.notEqual(next.targetCode, locked);
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
          collectTortureResponses(manager, code, agents, false);
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
    const bloodRitualEventCount = manager.db.prepare("SELECT COUNT(*) AS n FROM hr_events WHERE game_code=? AND type='blood-ritual'").get(code).n;
    return { killChargeCount, bloodRitualEventCount };
  } finally {
    manager.close();
    Math.random = origMathRandom;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test('engine integration: a drift-aware Murderer pays the kill-cost charge more than once across a batch of long games (5p, solo Heretic)', () => {
  // 5p specifically: no Heretic Priest/Conspirator/Saboteur to also pick up
  // Blood Ritual duty, so this isolates the Murderer's own recovery
  // behavior from the separate Blood Ritual coordination tested below (at
  // 8p+, extra Heretic offense ends games faster, shrinking the sample of
  // games long enough for the Murderer to personally get a 2nd kill window).
  const maxCharges = Math.max(...Array.from({ length: 25 }, (_, i) => runSeededGame(5, 20000 + i, 50).killChargeCount));
  assert.ok(maxCharges >= 2, `expected at least one game with 2+ kill-cost charges (recovered and attacked again); got max ${maxCharges}`);
});

test('engine integration: Blood Ritual actually fires across a batch of multi-Heretic games (8p — Murderer + Heretic Priest)', () => {
  const totalBloodRituals = Array.from({ length: 20 }, (_, i) => runSeededGame(8, 11000 + i, 50).bloodRitualEventCount)
    .reduce((sum, n) => sum + n, 0);
  assert.ok(totalBloodRituals > 0, 'expected at least one Blood Ritual event across 20 8p games');
});

test('engine integration: a solo Heretic (5p, no Heretic Priest) still uses Blood Ritual as a gated-Murderer fallback', () => {
  const totalBloodRituals = Array.from({ length: 20 }, (_, i) => runSeededGame(5, 12000 + i, 50).bloodRitualEventCount)
    .reduce((sum, n) => sum + n, 0);
  assert.ok(totalBloodRituals > 0, 'expected at least one Blood Ritual event across 20 5p games from the solo-Murderer fallback');
});
