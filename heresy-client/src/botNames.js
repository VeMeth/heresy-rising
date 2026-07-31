// Loaded from game_data/notableNames.json (single source of truth, mirrored from
// server). See heresy-server/src/notableNames.js for the server-side loader.
import notableNamesData from '@game_data/notableNames.json';

const BOT_NAMES = notableNamesData.names;

function pickBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

export { BOT_NAMES, pickBotName };