/**
 * Random agent — picks uniform-random legal actions.
 * Used as a fallback and baseline.
 */

import { pickRandom } from '../util.js';

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {string} label
 * @property {(state: import('../agent.js').AgentState) => ({targetCode: string, variant?: string, factionAction?: boolean}|null)} nightAction
 * @property {(state: import('../agent.js').AgentState) => string} dayVote
 */

/**
 * Create a random agent.
 * @param {string} id - Unique agent identifier
 */
export function createRandomAgent(id) {
  return {
    id,
    label: `random-${id}`,
    /**
     * @param {import('../agent.js').AgentState} state
     * @returns {{ targetCode: string } | null}
     */
    nightAction(state) {
      if (!state.legalTargets || state.legalTargets.length === 0) return null;
      const targetCode = pickRandom(state.legalTargets);
      return { targetCode };
    },
    /**
     * @param {import('../agent.js').AgentState} state
     * @returns {string} - player code or 'skip'
     */
    dayVote(state) {
      if (!state.voteOptions || state.voteOptions.length === 0) return 'skip';
      return pickRandom(state.voteOptions);
    }
  };
}
