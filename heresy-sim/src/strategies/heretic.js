/**
 * Heretic heuristic strategies (H1–H5).
 * Each is a factory that returns an agent with nightAction() and dayVote().
 * Heretics share a factionState Map for coordination (simulating faction chat).
 * All decisions are deterministic from state (no Math.random()).
 */

import { pickRandom } from '../util.js';

// ── H1 — Murderer ──────────────────────────────────────────────────────────

export function createH1Murderer(id, factionState) {
  /** @type {string[]} recent kill targets (for rotation) */
  const recentTargets = [];
  return {
    id,
    label: `h1-murderer-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Target a Loyalist not killed recently
      let candidates = s.legalTargets.filter(t => !recentTargets.includes(t));
      if (candidates.length === 0) candidates = [...s.legalTargets];

      const hereticCodes = new Set(
        s.living?.filter(p => p.faction === 'heretic').map(p => p.playerCode) || []
      );
      // Prefer players who voted against a Heretic
      const antiHereticVoters = (s.voteTally || [])
        .filter(v => hereticCodes.has(v.choice))
        .map(v => v.voterCode)
        .filter(vc => candidates.includes(vc));
      if (antiHereticVoters.length > 0) {
        const target = antiHereticVoters[0];
        recentTargets.push(target);
        if (recentTargets.length > 3) recentTargets.shift();
        factionState?.set('lastKillTarget', target);
        return { targetCode: target };
      }

      // Filter out heretics
      const loyalCandidates = candidates.filter(t => !hereticCodes.has(t));
      if (loyalCandidates.length > 0) candidates = loyalCandidates;

      const target = candidates[0];
      recentTargets.push(target);
      if (recentTargets.length > 3) recentTargets.shift();
      factionState?.set('lastKillTarget', target);
      return { targetCode: target };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Coordinate with faction
      const consensusTarget = factionState?.get('consensusVoteTarget');
      if (consensusTarget && s.voteOptions.includes(consensusTarget)) return consensusTarget;
      // Vote for lowest-voted player (proxy for low drift)
      const counts = new Map();
      for (const v of (s.voteTally || [])) {
        if (v.choice !== 'skip') counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
      }
      const cleanTargets = s.voteOptions.filter(t => !counts.has(t));
      if (cleanTargets.length > 0) return cleanTargets[0];
      return s.voteOptions[0];
    },
    respondInterrogation() { return 'resist'; }
  };
}

// ── H2 — Heretic Priest ────────────────────────────────────────────────────

export function createH2HereticPriest(id, factionState) {
  let sermonRound = 0;
  return {
    id,
    label: `h2-heretic-priest-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      sermonRound++;
      const hereticCodes = new Set(
        s.living?.filter(p => p.faction === 'heretic').map(p => p.playerCode) || []
      );
      const loyalCandidates = s.legalTargets.filter(t => !hereticCodes.has(t));
      if (loyalCandidates.length === 0) return null;
      const target = loyalCandidates[0];
      // Rotate sermon variants
      let variant = 'false-comfort';
      if (sermonRound % 3 === 0) variant = 'twisted-hymn';
      if (sermonRound % 5 === 0) variant = 'warp-litany';
      return { targetCode: target, variant };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const lastKill = factionState?.get('lastKillTarget');
      if (lastKill && s.voteOptions.includes(lastKill)) return lastKill;
      const consensus = factionState?.get('consensusVoteTarget');
      if (consensus && s.voteOptions.includes(consensus)) return consensus;
      return s.voteOptions[0];
    },
    respondInterrogation() { return 'resist'; }
  };
}

// ── H3 — Conspirator ──────────────────────────────────────────────────────

export function createH3Conspirator(id, factionState) {
  let knownInterrogator = null;
  return {
    id,
    label: `h3-conspirator-${id}`,
    nightAction() { return null; }, // No night action
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      if (!knownInterrogator) {
        // Track the most active voter as the suspected Interrogator
        const voterCount = new Map();
        for (const v of (s.voteTally || [])) {
          if (v.choice !== 'skip') {
            voterCount.set(v.voterCode, (voterCount.get(v.voterCode) || 0) + 1);
          }
        }
        if (voterCount.size > 0) {
          let maxVoter = null, maxCount = 0;
          for (const [vc, c] of voterCount) {
            if (c > maxCount) { maxCount = c; maxVoter = vc; }
          }
          if (maxVoter) {
            knownInterrogator = maxVoter;
            factionState?.set('knownInterrogator', maxVoter);
          }
        }
      }
      const consensus = factionState?.get('consensusVoteTarget');
      if (consensus && s.voteOptions.includes(consensus)) return consensus;
      return s.voteOptions[0];
    },
    respondInterrogation() { return 'resist'; }
  };
}

// ── H4 — Saboteur ──────────────────────────────────────────────────────────

export function createH4Saboteur(id, factionState) {
  return {
    id,
    label: `h4-saboteur-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Trap the most voted player (likely Interrogator target)
      const counts = new Map();
      for (const v of (s.voteTally || [])) {
        if (v.choice !== 'skip') counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
      }
      if (counts.size > 0) {
        let maxTarget = null, maxCount = 0;
        for (const [t, c] of counts) {
          if (c > maxCount && s.legalTargets.includes(t)) { maxCount = c; maxTarget = t; }
        }
        if (maxTarget) return { targetCode: maxTarget };
      }
      return { targetCode: s.legalTargets[0] };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const consensus = factionState?.get('consensusVoteTarget');
      if (consensus && s.voteOptions.includes(consensus)) return consensus;
      return s.voteOptions[0];
    },
    respondInterrogation() { return 'resist'; }
  };
}

// ── H5 — Recruiter ─────────────────────────────────────────────────────────

export function createH5Recruiter(id, factionState) {
  return {
    id,
    label: `h5-recruiter-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Target the most voted player (proxy for Black zone)
      const target = getMostVotedFromTally(s);
      if (target && s.legalTargets.includes(target)) return { targetCode: target };
      return { targetCode: s.legalTargets[0] };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Vote for most voted target (push to Black)
      const target = getMostVotedFromTally(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondInterrogation() { return 'resist'; }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getMostVotedFromTally(s) {
  const counts = new Map();
  for (const v of (s.voteTally || [])) {
    if (v.choice !== 'skip') {
      counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let maxTarget = null, maxCount = 0;
  for (const [t, c] of counts) {
    if (c > maxCount) { maxCount = c; maxTarget = t; }
  }
  return maxTarget;
}

// ── Role-to-heuristic map ──────────────────────────────────────────────────

const HERETIC_ROLE_MAP = {
  'murderer': createH1Murderer,
  'heretic-priest': createH2HereticPriest,
  'conspirator': createH3Conspirator,
  'saboteur': createH4Saboteur,
  'recruiter': createH5Recruiter,
};

export function getHereticHeuristic(roleId) {
  return HERETIC_ROLE_MAP[roleId] || null;
}

export { HERETIC_ROLE_MAP };
