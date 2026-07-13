const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SAFE_NAME_REGEX = /[^A-Za-z0-9 _-]/g;
const SAFE_PLAYER_CODE_REGEX = /[^A-Za-z0-9_-]/g;
const MAX_NAME_LENGTH = 20;
const MAX_ROOM_CODE_LENGTH = 8;
const MAX_PLAYER_CODE_LENGTH = 64;

export function generateRoomCode(existingCodes = new Set(), length = 4) {
  let code;
  do {
    code = Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (existingCodes.has(code));
  return code;
}

export function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function selectRandomItems(source, count) {
  if (count >= source.length) {
    return shuffle(source).slice(0, count);
  }
  const selection = [];
  const taken = new Set();
  while (selection.length < count) {
    const index = Math.floor(Math.random() * source.length);
    if (!taken.has(index)) {
      taken.add(index);
      selection.push(source[index]);
    }
  }
  return selection;
}

export function sanitizePlayerName(raw, fallback = 'Player') {
  if (!raw) return fallback;
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  const cleaned = trimmed.replace(SAFE_NAME_REGEX, '');
  return cleaned || fallback;
}

export function normalizePlayerCode(raw) {
  return String(raw || '')
    .trim()
    .replace(SAFE_PLAYER_CODE_REGEX, '')
    .slice(0, MAX_PLAYER_CODE_LENGTH);
}

export function requirePlayerCode(raw) {
  const code = normalizePlayerCode(raw);
  if (code.length < 8) {
    throw new Error('Valid playerCode is required');
  }
  return code;
}

export function normalizeRoomCode(raw) {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, MAX_ROOM_CODE_LENGTH);
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}
