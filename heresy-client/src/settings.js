// Player-local preferences (currently just the operative seal style),
// keyed by playerCode so restoring a different identity on the same browser
// gets that identity's own preference rather than inheriting whoever was
// last signed in.
import { reactive } from 'vue';
import { getPlayerCode } from './socket.js';
import { DEFAULT_SEAL_STYLE, SEAL_STYLES } from './seals.js';

const STORAGE_KEY = 'heresy-rising:settings';

export const settings = reactive({ sealStyle: DEFAULT_SEAL_STYLE });

function isKnownSealStyle(id) {
  return SEAL_STYLES.some(s => s.id === id);
}

// Mirrors the defensive readJson in App.vue — localStorage throws in private
// mode / with storage disabled, and a corrupt or hand-edited value should
// degrade to the default rather than break the app.
function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // private mode / quota exceeded — preference just won't persist.
  }
}

/** Re-read settings for the CURRENT playerCode. Call on boot and again after
 *  an identity change (recovery, new profile) since the storage key to read
 *  from changes with it. */
export function loadSettings() {
  const code = getPlayerCode();
  const all = readAll();
  const mine = (code && all[code]) || {};
  settings.sealStyle = isKnownSealStyle(mine.sealStyle) ? mine.sealStyle : DEFAULT_SEAL_STYLE;
}

export function setSealStyle(id) {
  if (!isKnownSealStyle(id)) return;
  settings.sealStyle = id;
  const code = getPlayerCode();
  if (!code) return;
  const all = readAll();
  all[code] = { ...(all[code] || {}), sealStyle: id };
  writeAll(all);
}
