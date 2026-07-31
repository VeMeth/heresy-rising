/**
 * Seedable PRNG (Linear Congruential Generator).
 * Same seed → same sequence of pseudo-random numbers.
 */
export function seedableRNG(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 4294967296);
  };
}

/**
 * Pick a random element from an array using the provided RNG function.
 */
export function pickRandom(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Shuffle an array in-place using Fisher-Yates with the provided RNG.
 */
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Format seconds into a human-readable duration.
 */
export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

/**
 * A non-skip vote when no other signal is available. Uses the seeded RNG
 * (via pickRandom's default param, which picks up runner.js's per-game
 * Math.random patch) so different agents land on different targets instead
 * of a shared deterministic pick — the old round-index rotation caused
 * same-seat-position blocs to vote in lockstep with zero faction awareness,
 * frequently lynching same-faction players by pure seat coincidence.
 * Weights toward atRiskTargets (players with a public torture history) as
 * a mild positive-suspicion signal when any are still legal targets.
 */
export function fallbackVoteTarget(voteOptions, atRiskTargets = [], rng = Math.random) {
  const targets = (voteOptions || []).filter(t => t !== 'skip');
  if (targets.length === 0) return 'skip';
  const suspects = targets.filter(t => (atRiskTargets || []).includes(t));
  return pickRandom(suspects.length > 0 ? suspects : targets, rng);
}
