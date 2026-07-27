import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAbility } from './mechanics/abilityText.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configRoot = process.env.GAME_CONFIG_DIR || path.join(root, 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(configRoot, name), 'utf8'));

export function loadGameConfig() {
  // Loaded before roleList so ability text can be rendered from it below —
  // drift costs live here (driftWeight is per-role, but MAX_DRIFT/zone
  // boundaries/TRAP_DRIFT/etc. are shared config every role's copy may
  // reference).
  const drift = read('drift.json');
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
    // Ability copy is rendered ONCE, here, from abilityTemplate + the role's
    // own driftWeight/sermonTiers + this shared drift config — never a
    // hand-typed string with the numbers baked in. Every consumer downstream
    // (role(), adminRole(), state()'s role exposure, the client dossier)
    // keeps reading a plain `ability` string exactly as before; nothing
    // downstream needs to know rendering happens at all. When drift costs
    // stop being fixed, only the INPUTS here change (driftWeight/sermonTiers
    // would need to come from a per-game computation instead of this static
    // JSON) — this render step and every consumer stay the same.
    const ability = renderAbility(role, drift);
    return { ...role, ability, actions: { ...role.actions, night } };
  });
  const compositionData = read('composition.json');
  return {
    roles: new Map(roleList.map(role => [role.id, role])),
    roleList,
    composition: {
      ...compositionData.compositions,
      fallbackPriority: ['sanctioned-psyker','priest','interrogator','chirurgeon','novice-psychic','arbitrator','murderer','heretic-priest','saboteur','recruiter','conspirator']
    },
    hardRules: compositionData.hardRules,
    drift,
    hintProfiles: { default: read('scenarios/default/hints.json') },
    deathFlavor: read('deathFlavor.json')
  };
}
