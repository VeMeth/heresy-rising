/**
 * Agent registry, state builder, and action dispatch.
 */

import { createRandomAgent } from './strategies/random.js';
import { createL1Citizen, createL2Interrogator, createL3Chirurgeon,
  createL4NovicePsychic, createL5Arbitrator, createL6Priest,
  createL7SanctionedPsyker } from './strategies/loyalist.js';
import { getHereticHeuristic } from './strategies/heretic.js';

/** @typedef {import('./strategies/random.js').Agent} Agent */

/**
 * @typedef {Object} AgentState
 * @property {Object} me - Viewer's own player summary (includes role, faction if viewer)
 * @property {Array} living - Living players (roles hidden except faction-mates)
 * @property {Array} dead - Dead players
 * @property {number} round - Current round number
 * @property {string} phase - 'day' | 'night'
 * @property {string|null} dayStage - Day sub-stage ('vote' | 'response'), null at night
 * @property {string[]} legalTargets - Available night targets (alive players except self)
 * @property {string[]} voteOptions - Legal vote targets + 'skip'
 * @property {Array} voteTally - Current vote tally
 * @property {Object|null} myAction - Already-submitted action this phase
 * @property {Object|null} pendingInterrogation - Pending interrogation info
 * @property {number} maxDrift - Maximum drift for this game
 * @property {string|null} lastInterrogatedTarget - Last day's interrogated target
 * @property {string[]} availableVariants - Legal night-action variants for the viewer's role (e.g. T1/T2/T3)
 */

// ── Loyalist role-to-heuristic map ─────────────────────────────────────────

const LOYALIST_ROLE_MAP = {
  'imperial-citizen': createL1Citizen,
  'interrogator': createL2Interrogator,
  'chirurgeon': createL3Chirurgeon,
  'novice-psychic': createL4NovicePsychic,
  'arbitrator': createL5Arbitrator,
  'priest': createL6Priest,
  'sanctioned-psyker': createL7SanctionedPsyker,
};

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a heuristic agent for a given role.
 * Falls back to random if no heuristic exists.
 * @param {string} roleId
 * @param {string} id
 * @param {Map} [factionState] - Shared state for heretic coordination
 * @returns {Agent}
 */
export function createHeuristicAgent(roleId, id, factionState) {
  const loyalistFactory = LOYALIST_ROLE_MAP[roleId];
  if (loyalistFactory) {
    return loyalistFactory(id);
  }
  const hereticFactory = getHereticHeuristic(roleId);
  if (hereticFactory) {
    return hereticFactory(id, factionState);
  }
  // Fallback: random agent
  return createRandomAgent(id);
}

// ── State builder ──────────────────────────────────────────────────────────

/**
 * Build the AgentState view for a given player from the game manager.
 * @param {import('../../heresy-server/src/heresyGameManager.js').HeresyGameManager} manager
 * @param {string} code - Game code
 * @param {string} playerCode - Player's code
 * @returns {AgentState}
 */
export function buildAgentState(manager, code, playerCode) {
  const game = manager.game(code);
  const rawPlayers = manager.players(code);
  const state = manager.state(code, playerCode);

  // Get the player's own full info (includes role, faction)
  const me = rawPlayers.find(p => p.player_code === playerCode);

  const alive = rawPlayers.filter(p => p.alive);
  const dead = rawPlayers.filter(p => !p.alive);

  // Legal targets: alive players except self (for night actions)
  const legalTargets = alive
    .filter(p => p.player_code !== playerCode)
    .map(p => p.player_code);

  // Vote options: all alive players except self + 'skip'
  const voteOptions = ['skip', ...legalTargets];

  // Votes from state
  const voteTally = state.votes || [];

  // Available variants from role definition
  const roleData = me?.role_id ? manager.role(me.role_id) : null;
  const nightAction = roleData?.actions?.night;
  const availableVariants = nightAction?.variants || [];

  return {
    me: {
      playerCode,
      name: me?.name || '?',
      role: roleData ? { id: roleData.id, displayName: roleData.displayName } : null,
      faction: me?.faction || null,
      drift: me?.drift || 0,
      alive: !!me?.alive,
      crippleTier: me?.cripple_tier || 0,
      confessed: !!me?.confessed,
    },
    living: alive.map(p => ({
      playerCode: p.player_code,
      name: p.name,
      alive: !!p.alive,
      role: state.players.find(sp => sp.playerCode === p.player_code)?.role || null,
      faction: state.players.find(sp => sp.playerCode === p.player_code)?.faction || null,
      crippleTier: p.cripple_tier || 0,
    })),
    dead: dead.map(p => ({
      playerCode: p.player_code,
      name: p.name,
      role: state.players.find(sp => sp.playerCode === p.player_code)?.role || null,
      faction: state.players.find(sp => sp.playerCode === p.player_code)?.faction || null,
    })),
    round: game.round,
    phase: game.phase,
    dayStage: game.day_stage || null,
    legalTargets,
    voteOptions,
    voteTally,
    myAction: state.myAction,
    pendingInterrogation: state.pendingInterrogation || null,
    maxDrift: game.max_drift,
    lastInterrogatedTarget: game.last_interrogated_target || null,
    availableVariants,
  };
}

// ── Action collection ──────────────────────────────────────────────────────

/**
 * Collect night actions from all alive agents and submit them to the engine.
 * @param {import('../../heresy-server/src/heresyGameManager.js').HeresyGameManager} manager
 * @param {string} code
 * @param {Map<string, Agent>} agents - Map of playerCode -> agent
 * @param {boolean} [verbose=false]
 * @returns {Array} Submitted actions
 */
export function collectNightActions(manager, code, agents, verbose = false) {
  const rawPlayers = manager.players(code).filter(p => p.alive);
  const submitted = [];

  for (const player of rawPlayers) {
    const agent = agents.get(player.player_code);
    if (!agent) continue;

    const agentState = buildAgentState(manager, code, player.player_code);

    // Skip roles with an explicit sleep action (imperial-citizen). A role
    // with NO night action at all (Conspirator — its own action is day-only
    // forge()) still gets a turn: Blood Ritual is a faction-wide action any
    // living Heretic can submit, independent of their own role's kit, so an
    // otherwise-idle-at-night Heretic can still pick it up.
    const roleData = player.role_id ? manager.role(player.role_id) : null;
    const nightActionDef = roleData?.actions?.night;
    if (nightActionDef?.kind === 'sleep') continue;

    try {
      const action = agent.nightAction(agentState);
      if (!action) continue;
      if (!action.targetCode) continue;

      const result = action.factionAction
        ? manager.submitFactionAction(code, player.player_code, { targetCode: action.targetCode })
        : manager.submitAction(code, player.player_code, { targetCode: action.targetCode, variant: action.variant });
      submitted.push({ playerCode: player.player_code, action, result });
      if (verbose) {
        const targetName = manager.player(code, action.targetCode)?.name || '?';
        const label = action.factionAction ? 'blood-ritual' : action.variant;
        console.log(`  Night: ${player.name} (${player.role_id}) → ${targetName}${label ? ` [${label}]` : ''}`);
      }
    } catch (err) {
      // Agent made an illegal choice — skip silently
      if (verbose) {
        console.log(`  Night: ${player.name} (${player.role_id}) — action failed: ${err.message}`);
      }
    }
  }

  return submitted;
}

/**
 * Collect day votes from all alive agents and submit them to the engine.
 * @param {import('../../heresy-server/src/heresyGameManager.js').HeresyGameManager} manager
 * @param {string} code
 * @param {Map<string, Agent>} agents - Map of playerCode -> agent
 * @param {boolean} [verbose=false]
 * @returns {Array} Submitted votes
 */
export function collectDayVotes(manager, code, agents, verbose = false) {
  const game = manager.game(code);
  if (game.round === 1) return []; // Day 1 has no vote (Q28)

  const rawPlayers = manager.players(code).filter(p => p.alive);
  const submitted = [];

  for (const player of rawPlayers) {
    const agent = agents.get(player.player_code);
    if (!agent) continue;

    const agentState = buildAgentState(manager, code, player.player_code);

    try {
      const choice = agent.dayVote(agentState);
      if (!choice) continue;

      const result = manager.vote(code, player.player_code, choice, '');
      submitted.push({ playerCode: player.player_code, choice, result });
      if (verbose) {
        const targetName = choice === 'skip' ? 'skip' : (manager.player(code, choice)?.name || '?');
        console.log(`  Vote: ${player.name} (${player.role_id}) → ${targetName}`);
      }
    } catch (err) {
      if (verbose) {
        console.log(`  Vote: ${player.name} (${player.role_id}) — vote failed: ${err.message}`);
      }
    }
  }

  return submitted;
}

/**
 * Handle interrogation response flow.
 * @param {import('../../heresy-server/src/heresyGameManager.js').HeresyGameManager} manager
 * @param {string} code
 * @param {Map<string, Agent>} agents
 * @param {boolean} [verbose=false]
 */
export function collectInterrogationResponses(manager, code, agents, verbose = false) {
  const game = manager.game(code);
  if (game.day_stage !== 'response') return;

  const targetCode = game.last_interrogated_target;
  if (!targetCode) return;

  const agent = agents.get(targetCode);
  if (!agent) return;

  const agentState = buildAgentState(manager, code, targetCode);

  try {
    const response = agent.respondInterrogation(agentState);
    manager.respondInterrogation(code, targetCode, response);
    if (verbose) {
      const player = manager.player(code, targetCode);
      console.log(`  Interrogation: ${player?.name} responds: ${response}`);
    }
  } catch (err) {
    if (verbose) {
      console.log(`  Interrogation response failed: ${err.message}`);
    }
  }
}
