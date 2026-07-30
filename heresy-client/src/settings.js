// Player preferences (operative seal style, sound mute).
//
// Two tiers, deliberately: a localStorage cache keyed by playerCode (instant,
// works offline, survives a refresh with zero round trip), and the server —
// the actual source of truth — keyed the same way. The cache alone isn't
// enough: localStorage is per BROWSER, not per identity, so a player who
// restores their playerCode on a second device starts with empty storage
// there and had nothing to inherit. Syncing through the server (see
// player:prefs:get/set in heresy-server) is what makes the preference follow
// the identity rather than the device.
import { reactive } from 'vue';
import { ensureConnected, emitWithAck, getPlayerCode } from './socket.js';
import { DEFAULT_SEAL_STYLE, SEAL_STYLES } from './seals.js';

const STORAGE_KEY = 'heresy-rising:settings';

export const settings = reactive({ sealStyle: DEFAULT_SEAL_STYLE, muted: false });

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
    // private mode / quota exceeded — preference just won't persist locally;
    // the server round trip (if it succeeds) still carries it.
  }
}

function loadLocal() {
  const code = getPlayerCode();
  const all = readAll();
  const mine = (code && all[code]) || {};
  settings.sealStyle = isKnownSealStyle(mine.sealStyle) ? mine.sealStyle : DEFAULT_SEAL_STYLE;
  settings.muted = mine.muted === true;
}

function saveLocal(patch) {
  const code = getPlayerCode();
  if (!code) return;
  const all = readAll();
  all[code] = { ...(all[code] || {}), ...patch };
  writeAll(all);
}

/** Re-read settings for the CURRENT playerCode. Call on boot and again after
 *  an identity change (recovery, new profile) since the identity to load for
 *  changes with it.
 *
 *  Applies the local cache first — synchronous, so there's no flash of the
 *  default while a round trip is in flight — then reconciles with the
 *  server, which wins when it has an answer (it's the one place a second
 *  device can actually learn what a first device already chose). Failures
 *  (offline, server unreachable) are swallowed; the local cache already
 *  applied stands as the fallback. */
export async function loadSettings() {
  loadLocal();
  const code = getPlayerCode();
  if (!code) return;
  try {
    await ensureConnected();
    const res = await emitWithAck('player:prefs:get', { playerCode: code });
    const prefs = res?.prefs || {};
    const pushUp = {};
    const remoteStyle = prefs.sealStyle;
    if (isKnownSealStyle(remoteStyle)) {
      settings.sealStyle = remoteStyle;
      saveLocal({ sealStyle: remoteStyle }); // cache it so the next load on THIS device is instant too
    } else if (settings.sealStyle !== DEFAULT_SEAL_STYLE) {
      // Nothing saved server-side yet, but this device already has a local
      // preference — push it up so a different device restoring this same
      // identity later has something to pull down instead of the default.
      pushUp.sealStyle = settings.sealStyle;
    }
    if (typeof prefs.muted === 'boolean') {
      settings.muted = prefs.muted;
      saveLocal({ muted: prefs.muted });
    } else if (settings.muted) {
      pushUp.muted = settings.muted;
    }
    if (Object.keys(pushUp).length) {
      emitWithAck('player:prefs:set', { playerCode: code, prefs: pushUp }).catch(() => {});
    }
  } catch {
    // Offline / server unreachable — local cache from loadLocal() stands.
  }
}

export function setSealStyle(id) {
  if (!isKnownSealStyle(id)) return;
  settings.sealStyle = id;
  saveLocal({ sealStyle: id });
  const code = getPlayerCode();
  if (!code) return;
  emitWithAck('player:prefs:set', { playerCode: code, prefs: { sealStyle: id } }).catch(() => {
    // Offline — the local cache above already has it; next successful
    // loadSettings() (or another setSealStyle) will retry the push.
  });
}

export function setMuted(muted) {
  settings.muted = !!muted;
  saveLocal({ muted: settings.muted });
  const code = getPlayerCode();
  if (!code) return;
  emitWithAck('player:prefs:set', { playerCode: code, prefs: { muted: settings.muted } }).catch(() => {
    // Offline — the local cache above already has it; next successful
    // loadSettings() (or another setMuted) will retry the push.
  });
}
