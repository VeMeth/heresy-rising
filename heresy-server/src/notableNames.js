import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded from game_data/notableNames.json (single source of truth, mirrored to
// client via Vite alias). Used server-side to assign per-game codenames when
// a lobby's "Anonymized mode" operational parameter is on (see
// HeresyGameManager#start / #displayName).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configRoot = process.env.GAME_CONFIG_DIR || path.join(root, 'game_data');
const data = JSON.parse(fs.readFileSync(path.join(configRoot, 'notableNames.json'), 'utf8'));

export const NOTABLE_NAMES = data.names;
