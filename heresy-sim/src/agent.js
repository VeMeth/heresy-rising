/**
 * Agent registry, state builder, and action dispatch.
 */

import { createRandomAgent } from './strategies/random.js';
import { createL1Citizen, createL2Interrogator, createL3Chirurgeon,
  createL4NovicePsychic, createL5Arbitrator, createL6Priest,
  createL7SanctionedPsyker, createL8Astropath } from './strategies/loyalist.js';
import { getHereticHeuristic } from './strategies/heretic.js';
import { resolveScaledCost } from '../../heresy-server/src/mechanics/scaledCosts.js';

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
 * @property {number} maxDrift - Maximum drift for this game
 * @property {string|null} lastTorturedTarget - Last day's tortured target
 * @property {Object|null} scaledCosts - Scaled costs for viewer's role (e.g. {T1: 6, T2: 8, T3: 10}), null if role has no scaled-cost actions
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
  'astropath': createL8Astropath,
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
 * @param {Array} [lastDayVoteTally=[]] - Vote tally from the last day phase
 * @returns {AgentState}
 */
export function buildAgentState(manager, code, playerCode, lastDayVoteTally = []) {
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

  // Votes from state. The live tally (state.votes) is only non-empty once
  // votes have actually been submitted this round — during night phases,
  // and during the day-vote collection pass (which builds every agent's
  // state before anyone has voted, to avoid a same-round bandwagon), it's
  // always empty. Fall back to the last completed day's tally so heuristics
  // still have a "who got suspected last time" signal instead of always
  // seeing nothing and defaulting to skip.
  const voteTally = (state.votes && state.votes.length > 0) ? state.votes : lastDayVoteTally;

  // Fetch role data for other state fields
  const roleData = me?.role_id ? manager.role(me.role_id) : null;

  // Scaled costs for the viewer's own role (if it has a scaled-cost-based night action)
  const totalPlayers = rawPlayers.length;
  let scaledCosts = null;
  if (roleData?.scaledCostKey) {
    scaledCosts = {};
    for (const tier of ['T1', 'T2', 'T3']) {
      try {
        scaledCosts[tier] = resolveScaledCost(manager.config.drift.scaledCosts, roleData.scaledCostKey, tier, totalPlayers);
      } catch { /* tier not defined for this role, skip */ }
    }
  }

  return {
    me: {
      playerCode,
      name: me?.name || '?',
      role: roleData ? { id: roleData.id, displayName: roleData.displayName } : null,
      faction: me?.faction || null,
      drift: me?.drift || 0,
      alive: !!me?.alive,
      crippleTier: me?.cripple_tier || 0,
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
    privateMessages: state.privateMessages,
    atRiskTargets: state.atRiskTargets || [],
    maxDrift: game.max_drift,
    lastTorturedTarget: game.last_tortured_target || null,
    scaledCosts,
  };
}

// ── Action collection ──────────────────────────────────────────────────────

/**
 * Collect night actions from all alive agents and submit them to the engine.
 * @param {import('../../heresy-server/src/heresyGameManager.js').HeresyGameManager} manager
 * @param {string} code
 * @param {Map<string, Agent>} agents - Map of playerCode -> agent
 * @param {boolean} [verbose=false]
 * @param {Array} [lastDayVoteTally=[]] - Vote tally from the last day phase
 * @returns {Array} Submitted actions
 */
export function collectNightActions(manager, code, agents, verbose = false, lastDayVoteTally = []) {
  const rawPlayers = manager.players(code).filter(p => p.alive);
  const submitted = [];

  for (const player of rawPlayers) {
    const agent = agents.get(player.player_code);
    if (!agent) continue;

    const agentState = buildAgentState(manager, code, player.player_code, lastDayVoteTally);

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
      agent.onNightActionCommitted?.(action, result);
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
 * @param {Array} [lastDayVoteTally=[]] - Tally from the last completed day vote
 * @returns {Array} Submitted votes
 */
export function collectDayVotes(manager, code, agents, verbose = false, lastDayVoteTally = []) {
  const game = manager.game(code);
  if (game.round === 1) return []; // Day 1 has no vote (Q28)

  const rawPlayers = manager.players(code).filter(p => p.alive);
  const submitted = [];
  const collected = [];

  // Pass 1: Collect votes from all players without submitting
  for (const player of rawPlayers) {
    const agent = agents.get(player.player_code);
    if (!agent) continue;

    const agentState = buildAgentState(manager, code, player.player_code, lastDayVoteTally);

    try {
      const choice = agent.dayVote(agentState);
      if (!choice) continue;

      collected.push({ player, choice });
    } catch (err) {
      if (verbose) {
        console.log(`  Vote: ${player.name} (${player.role_id}) — vote failed: ${err.message}`);
      }
    }
  }

  // Pass 2: Submit all collected votes
  for (const { player, choice } of collected) {
    try {
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

