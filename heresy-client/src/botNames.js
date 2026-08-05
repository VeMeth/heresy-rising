// Loaded from game_data/notableNames.json (single source of truth, mirrored from
// server). See heresy-server/src/notableNames.js for the server-side loader.
import notableNamesData from '@game_data/notableNames.json';

const BOT_NAMES = notableNamesData.names;

// Pick a random bot name, excluding any already in use in the target conclave
// so two bots never share a name. `exclude` is anything iterable of strings
// (Set, Array); a name is considered taken on case-insensitive match. If
// every name is excluded (small notables list, large conclave), we fall back
// to a fully random pick rather than loop forever — the operator can still
// type a custom name in the form.
function pickBotName(exclude) {
  const used = exclude instanceof Set ? exclude : new Set(
    Array.isArray(exclude) ? exclude
      : (exclude && typeof exclude[Symbol.iterator] === 'function' ? Array.from(exclude) : [])
  );
  const lower = new Set(Array.from(used, (n) => String(n || '').toLowerCase()));
  const free = BOT_NAMES.filter((n) => !lower.has(String(n).toLowerCase()));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export { BOT_NAMES, pickBotName };