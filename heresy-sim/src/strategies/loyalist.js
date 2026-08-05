/**
 * Loyalist heuristic strategies (L1–L7).
 * Each is a factory that returns an agent with nightAction() and dayVote().
 * All decisions are deterministic from state (no Math.random()) so same seed → same outcome.
 */

import { pickRandom, fallbackVoteTarget } from '../util.js';

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
      // Fallback: deterministic rotation
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
  };
}

// ── L2 — Interrogator ──────────────────────────────────────────────────────

export function createL2Interrogator(id) {
  return {
    id,
    label: `l2-interrogator-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Prefer scanning targets not yet interrogated (independent detection)
      const tested = new Set(
        (s.privateMessages || [])
          .filter(m => m.meta?.intelKind === 'interrogate' && m.meta.target)
          .map(m => m.meta.target)
      );
      const untested = s.legalTargets.filter(t => !tested.has(t));
      const target = pickRandom(untested.length > 0 ? untested : s.legalTargets)
        || getMostVoted(s)
        || s.legalTargets[0];
      // Choose intensity based on scaled costs: prefer highest tier it can afford
      // without spending more than roughly a third of maxDrift in one shot
      const myDrift = s.me?.drift || 0;
      let variant = 'T2'; // Default fallback
      if (s.scaledCosts) {
        if (s.scaledCosts.T3 != null && myDrift + s.scaledCosts.T3 <= s.maxDrift / 3) {
          variant = 'T3';
        } else if (s.scaledCosts.T2 != null && myDrift + s.scaledCosts.T2 <= s.maxDrift / 2) {
          variant = 'T2';
        } else if (s.scaledCosts.T1 != null) {
          variant = 'T1';
        }
      }
      return { targetCode: target, variant };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Check own intel from interrogations
      if (s.privateMessages && Array.isArray(s.privateMessages)) {
        // Find most recent interrogation result (iterate from end)
        for (let i = s.privateMessages.length - 1; i >= 0; i--) {
          const msg = s.privateMessages[i];
          if (msg.meta?.intelKind === 'interrogate') {
            // Confirmed hit: faction is ground truth
            if (msg.meta.faction === 'heretic' && msg.meta.target && s.voteOptions.includes(msg.meta.target)) {
              return msg.meta.target;
            }
            // Noisy hit: factionHint is weaker signal
            if (msg.meta.factionHint === 'heretic' && msg.meta.target && s.voteOptions.includes(msg.meta.target)) {
              return msg.meta.target;
            }
          }
        }
      }
      // Vote for a different high-vote target
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
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
      // Self-protect if own drift is high and didn't self-protect last round
      if (myDrift >= 5 && lastProtectedTarget !== s.me?.playerCode) {
        lastProtectedTarget = s.me?.playerCode;
        return { targetCode: s.me?.playerCode };
      }
      // Protect someone different from last — prefer whoever the table is worried about
      const candidates = s.legalTargets.filter(t => t !== lastProtectedTarget);
      if (candidates.length === 0) return { targetCode: pickRandom(s.legalTargets) };
      const suspected = getMostVoted(s);
      const target = (suspected && candidates.includes(suspected)) ? suspected : candidates[0];
      lastProtectedTarget = target;
      return { targetCode: target };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
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
      // Prefer voting for publicly tortured targets (safe, always-available signal)
      const atRiskVote = s.atRiskTargets?.find(t => s.voteOptions.includes(t));
      if (atRiskVote) return atRiskVote;
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
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
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
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
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
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
          return { targetCode: target };
        }
      }
      return null; // Sleep (recover drift)
    },
    onNightActionCommitted() {
      hasKilled = true;
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
  };
}

// ── L8 — Astropath ────────────────────────────────────────────────────────

export function createL8Astropath(id) {
  return {
    id,
    label: `l8-astropath-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Prefer reading targets not yet read (independent detection)
      const read = new Set(
        (s.privateMessages || [])
          .filter(m => m.meta?.intelKind === 'warp-read' && m.meta.target)
          .map(m => m.meta.target)
      );
      const unread = s.legalTargets.filter(t => !read.has(t));
      const target = pickRandom(unread.length > 0 ? unread : s.legalTargets)
        || getMostVoted(s)
        || s.legalTargets[0];
      // Choose tier: prefer T1 most of the time (simple heuristic)
      // Only bump to T2/T3 for high-value targets or when drift is very low
      const myDrift = s.me?.drift || 0;
      let variant = 'T1'; // Default fallback
      if (s.scaledCosts) {
        // Use T2 if drift is very low and T2 is affordable
        if (myDrift <= 2 && s.scaledCosts.T2 != null && myDrift + s.scaledCosts.T2 <= s.maxDrift / 2) {
          variant = 'T2';
        } else if (s.scaledCosts.T1 != null) {
          variant = 'T1';
        }
      }
      return { targetCode: target, variant };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const target = getMostVoted(s);
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    }
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
