/**
 * Loyalist heuristic strategies (L1–L7).
 * Each is a factory that returns an agent with nightAction() and dayVote().
 * All decisions are deterministic from state (no Math.random()) so same seed → same outcome.
 */

import { pickRandom } from '../util.js';

// ── L1 — Imperial Citizen ──────────────────────────────────────────────────

export function createL1Citizen(id) {
  return {
    id,
    label: `l1-citizen-${id}`,
    nightAction() { return null; }, // Sleep
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Deterministic "indecision": skip on even rounds
      if (s.round % 3 === 0) return 'skip';
      // Vote for the player who voted skip last round (suspicious)
      const lastSkip = s.voteTally?.find(v => v.choice === 'skip');
      if (lastSkip && s.voteOptions.includes(lastSkip.voterCode)) {
        return lastSkip.voterCode;
      }
      // Follow the crowd: vote for the player with most votes already
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      // Fallback: vote skip
      return 'skip';
    },
    respondTorture() { return 'resist'; }
  };
}

// ── L2 — Interrogator ──────────────────────────────────────────────────────

export function createL2Interrogator(id) {
  return {
    id,
    label: `l2-interrogator-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Target the player who received the most votes last day but wasn't killed
      const target = getMostVoted(s) || pickRandom(s.legalTargets);
      // Choose intensity based on drift
      const myDrift = s.me?.drift || 0;
      let variant = 'T2';
      if (myDrift >= 10) variant = 'T1'; // Conserving drift
      else if (myDrift >= 5 && s.maxDrift >= 12) variant = 'T3';
      return { targetCode: target, variant };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Vote for a different high-vote target
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondTorture() { return 'resist'; }
  };
}

// ── L3 — Chirurgeon ────────────────────────────────────────────────────────

export function createL3Chirurgeon(id) {
  let lastProtectedTarget = null;
  return {
    id,
    label: `l3-chirurgeon-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      const myDrift = s.me?.drift || 0;
      // Self-protect if own drift is high
      if (myDrift >= 5) {
        lastProtectedTarget = s.me?.playerCode;
        return { targetCode: s.me?.playerCode };
      }
      // Protect someone different from last
      const candidates = s.legalTargets.filter(t => t !== lastProtectedTarget);
      if (candidates.length === 0) return { targetCode: pickRandom(s.legalTargets) };
      const target = candidates[0];
      lastProtectedTarget = target;
      return { targetCode: target };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondTorture() { return 'resist'; }
  };
}

// ── L4 — Novice-Psychic ────────────────────────────────────────────────────

export function createL4NovicePsychic(id) {
  return {
    id,
    label: `l4-novice-psychic-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Scan the player who was most recently tortured
      if (s.lastTorturedTarget && s.legalTargets.includes(s.lastTorturedTarget)) {
        return { targetCode: s.lastTorturedTarget };
      }
      // Scan the first player who voted differently from majority
      const votes = s.voteTally || [];
      const majorityChoice = getMostVoted(s);
      const minorityVoter = votes.find(v =>
        v.choice !== majorityChoice && v.choice !== 'skip' &&
        s.legalTargets.includes(v.voterCode)
      );
      if (minorityVoter) return { targetCode: minorityVoter.voterCode };
      return { targetCode: s.legalTargets[0] };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondTorture() { return 'resist'; }
  };
}

// ── L5 — Arbitrator ────────────────────────────────────────────────────────

export function createL5Arbitrator(id) {
  return {
    id,
    label: `l5-arbitrator-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Proxy the most voted player (likely target)
      const target = getMostVoted(s);
      if (target && s.legalTargets.includes(target)) return { targetCode: target };
      return { targetCode: s.legalTargets[0] };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondTorture() { return 'resist'; }
  };
}

// ── L6 — Priest ────────────────────────────────────────────────────────────

export function createL6Priest(id) {
  let sermonRound = 0;
  return {
    id,
    label: `l6-priest-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      sermonRound++;
      const target = getMostVoted(s) || s.legalTargets[0];
      // Rotate sermon types
      let variant = 'whisper';
      if (sermonRound % 3 === 0) variant = 'hymn';
      if (sermonRound % 5 === 0) variant = 'litany';
      return { targetCode: target, variant };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondTorture() { return 'resist'; }
  };
}

// ── L7 — Sanctioned Psyker ────────────────────────────────────────────────

export function createL7SanctionedPsyker(id) {
  let hasKilled = false;
  return {
    id,
    label: `l7-sanctioned-psyker-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0 || hasKilled) return null;
      // Fire when late game (round >= 4) or if heretic count is close to parity
      const hereticCount = s.living?.filter(p => p.faction === 'heretic').length || 0;
      const loyalistCount = s.living?.filter(p => p.faction !== 'heretic').length || 0;
      const shouldFire = hereticCount >= loyalistCount - 1 || (s.round || 0) >= 4;
      if (shouldFire) {
        const target = getMostVoted(s) || s.legalTargets[0];
        if (s.legalTargets.includes(target)) {
          hasKilled = true;
          return { targetCode: target };
        }
      }
      return null; // Sleep (recover drift)
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return s.voteOptions[0];
    },
    respondTorture() { return 'resist'; }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getMostVoted(s) {
  const counts = new Map();
  for (const v of (s.voteTally || [])) {
    if (v.choice !== 'skip') {
      counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let maxTarget = null, maxCount = 0;
  for (const [t, c] of counts) {
    if (c > maxCount) {
      maxCount = c;
      maxTarget = t;
    }
  }
  return maxTarget;
}
