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
