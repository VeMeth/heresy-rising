// Chat glossary — the terms that get an underline and a hover definition
// when they appear in a transmission.
//
// Data source: game_data/glossary.json
// - roleAliases and roleGlossOverrides are in the JSON
// - Role ability text reused from compositionData.js (same as lobby display)
// - Mechanics written in JSON with support for template variables
//
// EVERYTHING HERE IS PUBLIC KNOWLEDGE. These entries are static text keyed off
// a word in the message — never off game state — so a tooltip cannot leak a
// role, a drift score, or anything else hidden. Do not make an entry that
// reads from the live game.

import { validRoles } from './compositionData.js';
import { DRIFT, ROLE_DRIFT_WEIGHT, formatSigned, renderTemplate } from './driftCosts.js';
import rules from '@game_data/rules.json';
import glossaryConfig from '@game_data/glossary.json';

const ROLE_DOC = id => '/docs/roles/' + id;

// Build role override object with drift weight interpolation
const ROLE_GLOSS_OVERRIDE = Object.fromEntries(
  Object.entries(glossaryConfig.roleGlossOverrides).map(([id, template]) =>
    [id, renderTemplate(template, { driftWeight: formatSigned(ROLE_DRIFT_WEIGHT[id] ?? 0) })])
);

// Build role terms from composition data + glossary aliases and overrides
const roleTerms = [...validRoles.values()].map(role => ({
  id: role.id,
  label: role.displayName,
  kind: role.faction === 'heretic' ? 'Heretic role' : 'Loyalist role',
  faction: role.faction,
  gloss: ROLE_GLOSS_OVERRIDE[role.id] || role.ability,
  doc: ROLE_DOC(role.id),
  aliases: glossaryConfig.roleAliases[role.id] || [role.displayName.toLowerCase()],
}));

// Build mechanic terms and render templates
const MECHANIC_COST_CONTEXT = {
  maxDrift: DRIFT.MAX,
  sleepRecovery: formatSigned(DRIFT.SLEEP_RECOVERY),
  greenMin: DRIFT.ZONES.green[0], greenMax: DRIFT.ZONES.green[1],
  yellowMin: DRIFT.ZONES.yellow[0], yellowMax: DRIFT.ZONES.yellow[1],
  orangeMin: DRIFT.ZONES.orange[0], orangeMax: DRIFT.ZONES.orange[1],
  redMin: DRIFT.ZONES.red[0], redMax: DRIFT.ZONES.red[1],
  blackMin: DRIFT.ZONES.black[0],
  executionPercentage: Math.round(rules.day.EXECUTION_THRESHOLD * 100),
};

const mechanicTerms = glossaryConfig.mechanics.map(term => {
  const rendered = { ...term };
  if (term.glossTemplate) {
    rendered.gloss = renderTemplate(term.glossTemplate, MECHANIC_COST_CONTEXT);
    delete rendered.glossTemplate;
  }
  return rendered;
});

const GLOSSARY_TERMS = [...roleTerms, ...mechanicTerms];

// alias (lowercased) -> term
const ALIAS_MAP = new Map();
for (const term of GLOSSARY_TERMS) {
  for (const alias of term.aliases) ALIAS_MAP.set(alias.toLowerCase(), term);
}

export function lookupTerm(text) {
  return ALIAS_MAP.get(String(text || '').toLowerCase()) || null;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Longest alias first: regex alternation takes the first branch that matches at
// a position, so "heretic priest" must be offered before "heretic", and
// "drift zone" before "drift".
const ALIASES_BY_LENGTH = [...ALIAS_MAP.keys()].sort((a, b) => b.length - a.length);

// Built once — the term list is static.
export const TERM_PATTERN = new RegExp('\\b(' + ALIASES_BY_LENGTH.map(escapeRegExp).join('|') + ')\\b', 'gi');
