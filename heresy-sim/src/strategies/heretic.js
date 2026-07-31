/**
 * Heretic heuristic strategies (H1–H5).
 * Each is a factory that returns an agent with nightAction() and dayVote().
 * Heretics share a factionState Map for coordination (simulating faction chat).
 * All decisions are deterministic from state (no Math.random()).
 */

import { fallbackVoteTarget } from '../util.js';

// ── Blood Ritual coordination ────────────────────────────────────────────
// Blood Ritual (blood-ritual.md v1.0.0) is a faction-wide night action: any
// living, uncrippled Heretic can submit it, but only one claim per night
// wins (engine: submitFactionAction rejects a second submission outright).
// Escalation to a kill is tracked by TARGET only, not by attacker — hitting
// the same target on the immediately following night escalates regardless
// of which Heretic did it — so a "second Heretic rotating the attack" is
// exactly what the engine already supports.
//
// Priority for who takes Blood Ritual duty on a given night (highest first):
// Conspirator (has no other night action — forge() is day-only, so this is
// pure upside), Heretic Priest (its sermons are the weakest standalone
// heretic tool), Saboteur (moderate value, only reached if the above are
// dead/crippled/absent), Murderer (last resort — only reachable from H1's
// own gated branch below, since Murderer always prefers its own kill).
// Recruiter is deliberately excluded: heretical-catalyst is a second,
// distinct win path (conversion) worth preserving undiluted.
const BLOOD_RITUAL_PRIORITY = ['conspirator', 'heretic-priest', 'saboteur', 'murderer'];

/**
 * Publish this agent's own role once, at creation time (before any round
 * runs), so every Heretic's priority computation below sees the full
 * roster immediately — approximates the faction already knowing each
 * other's roles via private chat, same as the existing `factionState`
 * coordination pattern (`lastKillTarget`, `consensusVoteTarget`, etc.).
 */
function registerHereticRole(factionState, id, roleId) {
  factionState?.set(`role:${id}`, roleId);
}

/**
 * Is `id` the highest-priority living, uncrippled Heretic eligible for
 * Blood Ritual duty this round? Every Heretic runs this same deterministic
 * computation independently and agrees on the same answer — no explicit
 * hand-off message needed, no collision risk.
 */
function isBloodRitualDuty(id, s, factionState) {
  if (!factionState) return false;
  const living = s.living || [];
  const candidates = living
    .filter(p => p.faction === 'heretic' && (p.crippleTier || 0) === 0)
    .map(p => ({ id: p.playerCode, role: factionState.get(`role:${p.playerCode}`) }))
    .filter(c => BLOOD_RITUAL_PRIORITY.includes(c.role));
  if (candidates.length === 0) return false;
  candidates.sort((a, b) => BLOOD_RITUAL_PRIORITY.indexOf(a.role) - BLOOD_RITUAL_PRIORITY.indexOf(b.role));
  return candidates[0].id === id;
}

/**
 * Build the Blood Ritual action for whoever has duty this round. Locks onto
 * the same target across nights (via factionState) to trigger the engine's
 * escalation-to-kill on a repeat hit; picks a fresh target once the locked
 * one is no longer legal (dead, or a Heretic — e.g. after a catalyst
 * conversion changed their faction).
 */
function bloodRitualNightAction(s, factionState) {
  if (!s.legalTargets || s.legalTargets.length === 0) return null;
  const hereticCodes = new Set(
    (s.living || []).filter(p => p.faction === 'heretic').map(p => p.playerCode)
  );
  const locked = factionState?.get('bloodRitualTarget');
  if (locked && s.legalTargets.includes(locked) && !hereticCodes.has(locked)) {
    return { targetCode: locked, factionAction: true };
  }
  const fresh = s.legalTargets.filter(t => !hereticCodes.has(t));
  if (fresh.length === 0) return null;
  const target = fresh[0];
  factionState?.set('bloodRitualTarget', target);
  return { targetCode: target, factionAction: true };
}

// ── H1 — Murderer ──────────────────────────────────────────────────────────

export function createH1Murderer(id, factionState) {
  registerHereticRole(factionState, id, 'murderer');
  /** @type {string[]} recent kill targets (for rotation) */
  const recentTargets = [];
  return {
    id,
    label: `h1-murderer-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      // Kill costs a flat +15 self-drift and is gated once drift+15 exceeds
      // maxDrift (engine: heresyGameManager.js resolveNight's murderer gate
      // check) — a single kill attempt (successful or blocked, cost applies
      // either way) already lands at ~15-17, so every later attempt would be
      // gated. Sleeping instead of attacking earns the passive -1/night
      // recovery, the only way back under the gate to ever kill again.
      // Mirrors the drift-awareness L3 Chirurgeon and L7 Sanctioned Psyker
      // already have — without this, the Murderer effectively gets exactly
      // one kill for the entire game, every game, regardless of targeting.
      const myDrift = s.me?.drift || 0;
      if (myDrift + 15 > (s.maxDrift || 20)) {
        // Gated — fall back to Blood Ritual only if no other living Heretic
        // is available to carry it instead (last resort in the priority
        // order; a solo Heretic, e.g. 5p, always reaches this branch).
        if (isBloodRitualDuty(id, s, factionState)) return bloodRitualNightAction(s, factionState);
        return null;
      }
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
        return { targetCode: target };
      }

      // Filter out heretics
      const loyalCandidates = candidates.filter(t => !hereticCodes.has(t));
      if (loyalCandidates.length > 0) candidates = loyalCandidates;

      const target = candidates[0];
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
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    },
    respondTorture(s) { return heresyRespondTorture(s); },
    onNightActionCommitted(action) {
      if (action.factionAction) return; // blood-ritual path handles its own bookkeeping separately
      recentTargets.push(action.targetCode);
      if (recentTargets.length > 3) recentTargets.shift();
      factionState?.set('lastKillTarget', action.targetCode);
    }
  };
}

// ── H2 — Heretic Priest ────────────────────────────────────────────────────

export function createH2HereticPriest(id, factionState) {
  registerHereticRole(factionState, id, 'heretic-priest');
  let sermonRound = 0;
  return {
    id,
    label: `h2-heretic-priest-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      if (isBloodRitualDuty(id, s, factionState)) return bloodRitualNightAction(s, factionState);
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
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    },
    respondTorture(s) { return heresyRespondTorture(s); }
  };
}

// ── H3 — Conspirator ──────────────────────────────────────────────────────

export function createH3Conspirator(id, factionState) {
  registerHereticRole(factionState, id, 'conspirator');
  return {
    id,
    label: `h3-conspirator-${id}`,
    // Conspirator's own kit (forge()) is day-only — no role night action to
    // give up, so it's top priority for Blood Ritual duty whenever alive.
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      if (isBloodRitualDuty(id, s, factionState)) return bloodRitualNightAction(s, factionState);
      return null;
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Re-evaluate the suspected Interrogator every round (most active voter),
      // requiring 2 consecutive rounds of the same top-voter before publishing
      // it as the faction's consensus target — avoids both permanently locking
      // onto a bad first guess and thrashing on every single round's noise.
      const voterCount = new Map();
      for (const v of (s.voteTally || [])) {
        if (v.choice !== 'skip') {
          voterCount.set(v.voterCode, (voterCount.get(v.voterCode) || 0) + 1);
        }
      }
      let maxVoter = null, maxCount = 0;
      for (const [vc, c] of voterCount) {
        if (c > maxCount) { maxCount = c; maxVoter = vc; }
      }
      const stillLiving = maxVoter && (s.living || []).some(p => p.playerCode === maxVoter);
      if (stillLiving) {
        const prevCandidate = factionState?.get('candidateInterrogator');
        const streak = maxVoter === prevCandidate ? (factionState?.get('candidateStreak') || 0) + 1 : 1;
        factionState?.set('candidateInterrogator', maxVoter);
        factionState?.set('candidateStreak', streak);
        if (streak >= 2) {
          factionState?.set('knownInterrogator', maxVoter);
          factionState?.set('consensusVoteTarget', maxVoter);
        }
      }
      // Clear a stale consensus target if it died
      const consensus = factionState?.get('consensusVoteTarget');
      if (consensus && !(s.living || []).some(p => p.playerCode === consensus)) {
        factionState?.delete('consensusVoteTarget');
      }
      const target = factionState?.get('consensusVoteTarget');
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    },
    respondTorture(s) { return heresyRespondTorture(s); }
  };
}

// ── H4 — Saboteur ──────────────────────────────────────────────────────────

export function createH4Saboteur(id, factionState) {
  registerHereticRole(factionState, id, 'saboteur');
  return {
    id,
    label: `h4-saboteur-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      if (isBloodRitualDuty(id, s, factionState)) return bloodRitualNightAction(s, factionState);
      // Trap the most voted player (likely Interrogator target)
      const hereticCodes = new Set(
        s.living?.filter(p => p.faction === 'heretic').map(p => p.playerCode) || []
      );
      const candidates = s.legalTargets.filter(t => !hereticCodes.has(t));
      if (candidates.length === 0) return null;
      const counts = new Map();
      for (const v of (s.voteTally || [])) {
        if (v.choice !== 'skip') counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
      }
      if (counts.size > 0) {
        let maxTarget = null, maxCount = 0;
        for (const [t, c] of counts) {
          if (c > maxCount && candidates.includes(t)) { maxCount = c; maxTarget = t; }
        }
        if (maxTarget) return { targetCode: maxTarget };
      }
      return { targetCode: candidates[0] };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const consensus = factionState?.get('consensusVoteTarget');
      if (consensus && s.voteOptions.includes(consensus)) return consensus;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    },
    respondTorture(s) { return heresyRespondTorture(s); }
  };
}

// ── H5 — Recruiter ─────────────────────────────────────────────────────────
// Deliberately never takes Blood Ritual duty (see BLOOD_RITUAL_PRIORITY
// comment above) — keeps the conversion win path undiluted.

export function createH5Recruiter(id, factionState) {
  /** @type {string[]} recent recruitment targets (for rotation) */
  const recentTargets = [];
  return {
    id,
    label: `h5-recruiter-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0) return null;
      const hereticCodes = new Set(
        s.living?.filter(p => p.faction === 'heretic').map(p => p.playerCode) || []
      );
      const nonHereticTargets = s.legalTargets.filter(t => !hereticCodes.has(t));
      if (nonHereticTargets.length === 0) return null;
      const target = getMostVotedFromTally(s);
      const candidates = nonHereticTargets.filter(t => !recentTargets.includes(t));
      const chosen = (target && nonHereticTargets.includes(target) && !recentTargets.includes(target))
        ? target
        : (candidates[0] || nonHereticTargets[0]);
      return { targetCode: chosen };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      // Vote for most voted target (push to Black)
      const target = getMostVotedFromTally(s);
      if (target && s.voteOptions.includes(target)) return target;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    },
    respondTorture(s) { return heresyRespondTorture(s); },
    onNightActionCommitted(action) {
      recentTargets.push(action.targetCode);
      if (recentTargets.length > 3) recentTargets.shift();
    }
  };
}

// ── H6 — Animus ────────────────────────────────────────────────────────────
// Deliberately never takes Blood Ritual duty — possession is a distinct win
// path that doesn't require faction coordination, so keeping its priority
// undiluted preserves this solo-viable secondary objective.

export function createH6Animus(id, factionState) {
  let hasPossessed = false;
  return {
    id,
    label: `h6-animus-${id}`,
    nightAction(s) {
      if (!s.legalTargets || s.legalTargets.length === 0 || hasPossessed) return null;
      const hereticCodes = new Set(
        s.living?.filter(p => p.faction === 'heretic').map(p => p.playerCode) || []
      );
      const loyalCandidates = s.legalTargets.filter(t => !hereticCodes.has(t));
      if (loyalCandidates.length === 0) return null;
      // Prefer a publicly-tortured target (proxy for elevated drift), else the most-voted target, else the first legal candidate.
      const tortured = (s.atRiskTargets || []).find(t => loyalCandidates.includes(t));
      if (tortured) return { targetCode: tortured };
      const voted = getMostVotedFromTally(s);
      if (voted && loyalCandidates.includes(voted)) return { targetCode: voted };
      return { targetCode: loyalCandidates[0] };
    },
    dayVote(s) {
      if (!s.voteOptions || s.voteOptions.length === 0) return 'skip';
      const consensus = factionState?.get('consensusVoteTarget');
      if (consensus && s.voteOptions.includes(consensus)) return consensus;
      return fallbackVoteTarget(s.voteOptions, s.atRiskTargets);
    },
    respondTorture(s) { return heresyRespondTorture(s); },
    onNightActionCommitted() { hasPossessed = true; }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Heretics always resist — confessing reveals their faction (fatal), refuse-break is strictly worse than resist with no upside. */
function heresyRespondTorture() {
  return 'resist';
}

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
  'animus': createH6Animus,
};

export function getHereticHeuristic(roleId) {
  return HERETIC_ROLE_MAP[roleId] || null;
}

export { HERETIC_ROLE_MAP };
