import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configRoot = process.env.GAME_CONFIG_DIR || path.join(root, 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(configRoot, name), 'utf8'));

export function loadGameConfig() {
  // TODO(heresy-spec): Priest is the non-canonical L6 slot, yielding the 11-role roster used by Phase 1.
  const roleList = read('roles-40k.json').roles.map(source => {
    const role = { ...source };
    const night = role.actions?.night ? { ...role.actions.night } : null;
    if (night?.kind === 'watch') night.kind = 'drift-hint';
    if (night?.kind === 'shield') night.kind = 'bodyguard';
    if (night?.kind === 'booby-trap') night.kind = 'boobytrap';
    if (night?.kind === 'sermon') {
      night.kind = role.faction === 'heretic' ? 'corrupt-sermon' : 'sermon';
      night.variants = Object.keys(role.sermonTiers || {}).map(id => id.replaceAll('_', '-'));
    }
    if (night?.kind === 'investigate') night.variants = ['T1', 'T2', 'T3'];
    return { ...role, actions: { ...role.actions, night } };
  });
  const compositionData = read('composition.json');
  return {
    roles: new Map(roleList.map(role => [role.id, role])),
    roleList,
    composition: {
      ...compositionData.compositions,
      fallbackPriority: ['priest','interrogator','chirurgeon','novice-psychic','arbitrator','murderer','heretic-priest','saboteur','recruiter','conspirator']
    },
    hardRules: compositionData.hardRules,
    drift: read('drift.json'),
    hintProfiles: { default: read('scenarios/default/hints.json') }
  };
}
