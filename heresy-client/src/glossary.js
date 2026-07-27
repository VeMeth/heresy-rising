// Chat glossary — the terms that get an underline and a hover definition
// when they appear in a transmission.
//
// Two sources, deliberately:
//
//   Roles      reuse the ability text already shipped in compositionData.js.
//              That text is public knowledge (it is the same copy the lobby
//              composition screen shows, and every role has an open manual
//              page), it is already written short, and keeping one copy means
//              a role edit can't leave the glossary saying something stale.
//
//   Mechanics  are written here. The manual has no short definition to borrow:
//              its frontmatter `description` is page metadata ("What drift is,
//              how it climbs, what the zones mean…") and the body runs to
//              tables. These are composed in the manual's own register, in the
//              spirit of the drift.md term table.
//
// EVERYTHING HERE IS PUBLIC KNOWLEDGE. These entries are static text keyed off
// a word in the message — never off game state — so a tooltip cannot leak a
// role, a drift score, or anything else hidden. Do not make an entry that
// reads from the live game.

import { validRoles } from './compositionData.js';
import { DRIFT, ROLE_DRIFT_WEIGHT, formatSigned, renderTemplate } from './driftCosts.js';

// Aliases per role. Longest match wins at scan time, so "Heretic Priest"
// resolves to the Heretic Priest and never to the Loyalist Priest.
const ROLE_ALIASES = {
  'imperial-citizen': ['imperial citizen', 'citizen', 'citizens'],
  'interrogator': ['interrogator', 'interrogators', 'interrogate', 'interrogates', 'interrogated', 'interrogation'],
  'chirurgeon': ['chirurgeon', 'chirurgeons'],
  'novice-psychic': ['novice-psychic', 'novice psychic', 'psychic'],
  'arbitrator': ['arbitrator', 'arbitrators'],
  'priest': ['priest', 'priests', 'sermon', 'hymn', 'litany'],
  'sanctioned-psyker': ['sanctioned psyker', 'psyker', 'psykers'],
  'murderer': ['murderer', 'murderers'],
  'heretic-priest': ['heretic priest', 'heretic-priest'],
  'conspirator': ['conspirator', 'conspirators', 'forgery', 'forged'],
  'saboteur': ['saboteur', 'saboteurs', 'trap', 'trapped', 'booby-trap'],
  'recruiter': ['recruiter', 'recruiters'],
  'animus': ['animus', 'neverborn'],
};

const ROLE_DOC = id => '/docs/roles/' + id;

// A few ability strings are written for the lobby composition screen, where the
// host is comparing roles as a designer would — they name the UI, cite genre
// conventions, or run long. Those read badly as a definition dropped into the
// middle of a conversation, so they are re-voiced here. The lobby copy stays as
// it is; only these four diverge, and only in register, never in rules.
const ROLE_GLOSS_OVERRIDE_TEMPLATE = {
  'heretic-priest': 'Wears the Priest\'s vestments and preaches the same sermons — but drift rises where it should fall. Finding one means noticing who got worse after a blessing.',
  'murderer': 'The knife in the dark. Kills one player each night, and sits in the cabal\'s channel watching every other Heretic\'s plan.',
  'sanctioned-psyker': 'One sanctioned warp-kill, once per game, against anyone. Firing it costs {driftWeight} drift — which lands the Psyker in Red, where a T2 scan executes them on sight. Nothing marks them: from the table they look exactly like a Murderer.',
  'animus': 'Once per game, reaches for a player believed to be drowning in Red drift. If right, the Animus speaks in their name for a day and the body ruptures at dusk, revealing everything. If wrong, the attempt wastes in silence.',
};
const ROLE_GLOSS_OVERRIDE = Object.fromEntries(
  Object.entries(ROLE_GLOSS_OVERRIDE_TEMPLATE).map(([id, template]) =>
    [id, renderTemplate(template, { driftWeight: formatSigned(ROLE_DRIFT_WEIGHT[id] ?? 0) })])
);

const roleTerms = [...validRoles.values()].map(role => ({
  id: role.id,
  label: role.displayName,
  kind: role.faction === 'heretic' ? 'Heretic role' : 'Loyalist role',
  faction: role.faction,
  gloss: ROLE_GLOSS_OVERRIDE[role.id] || role.ability,
  doc: ROLE_DOC(role.id),
  aliases: ROLE_ALIASES[role.id] || [role.displayName.toLowerCase()],
}));

// Mechanics and setting. Written for this tooltip: one or two sentences, the
// definition first, the consequence second.
const mechanicTerms = [
  {
    id: 'drift', label: 'Drift', kind: 'Mechanic', doc: '/docs/drift',
    aliases: ['drift', 'drifting', 'drifted', 'drift cost'],
    glossTemplate: 'The corruption the Warp leaves on a soul, scored 0 to {maxDrift}. It climbs when you act, kill, or vote with the losing side, and it never resets — you only ever feel it as a whisper, never as a number.',
  },
  {
    id: 'warp', label: 'The Warp', kind: 'Setting', doc: '/docs/drift',
    aliases: ['the warp', 'warp', 'warp-touched'],
    gloss: 'The chaos dimension pressing against reality. Every forbidden gift in this game draws on it, and it always sends an invoice.',
  },
  {
    id: 'zone', label: 'Drift zone', kind: 'Mechanic', doc: '/docs/drift',
    aliases: ['drift zone', 'drift zones', 'green zone', 'yellow zone', 'orange zone', 'red zone', 'black zone'],
    glossTemplate: 'Where a score sits on the ladder: Green ({greenMin}–{greenMax}), Yellow ({yellowMin}–{yellowMax}), Orange ({orangeMin}–{orangeMax}), Red ({redMin}–{redMax}), Black ({blackMin}). Powers read the zone, not the number.',
  },
  {
    id: 'torture', label: 'Torture', kind: 'Day outcome', doc: '/docs/how-to-play',
    aliases: ['torture', 'tortured', 'tortures', 'torture chamber', 'excruciator'],
    gloss: 'The day vote\'s lesser verdict: the conclave breaks a suspect instead of killing them. Each round cripples the target one tier further and demands an answer. Not to be confused with the Interrogator, who works at night.',
  },
  {
    id: 'lynch', label: 'Lynch', kind: 'Day outcome', doc: '/docs/how-to-play',
    aliases: ['lynch', 'lynched', 'lynching'],
    gloss: 'The day vote\'s fatal verdict. At 60% of the living — or against a suspect already marked — the conclave executes rather than tortures, and the body\'s allegiance is read out publicly.',
  },
  {
    id: 'crippled', label: 'Crippled', kind: 'Mechanic', doc: '/docs/how-to-play',
    aliases: ['crippled', 'cripple', 'cripple tier'],
    gloss: 'Torture damage. Tier 1 wounds, Tier 2 forces you to justify every vote aloud, Tier 3 shatters you. A crippled operative cannot take a night action.',
  },
  {
    id: 'confession', label: 'Confession', kind: 'Mechanic', doc: '/docs/how-to-play',
    aliases: ['confession', 'confess', 'confessed', 'confesses'],
    gloss: 'What torture demands. The broken may confess, resist, or refuse and break — and at Tier 3 the conclave stops asking and simply demands it.',
  },
  {
    id: 'execute-on-sight', label: 'Execute on Sight', kind: 'Mechanic', doc: '/docs/roles/interrogator',
    aliases: ['execute on sight', 'executed on sight', 'summary execution'],
    gloss: 'An Interrogator scan at T2 or higher against an Orange-or-worse target kills on the spot and reveals the alignment to everyone. It is why cheap nightly scans are worth the drift.',
  },
  {
    id: 'possession', label: 'Possession', kind: 'Mechanic', doc: '/docs/roles/animus',
    aliases: ['possession', 'possess', 'possessed', 'possessing'],
    gloss: 'The Animus\'s one shot: reach into a player already in Red drift and speak with their voice for a day. When it ends the body ruptures and the Warp is visible to all.',
  },
  {
    id: 'blood-ritual', label: 'Blood Ritual', kind: 'Heretic action', doc: '/docs/roles/blood-ritual',
    aliases: ['blood ritual', 'blood-ritual'],
    gloss: 'A faction-wide Heretic move. Only one cabalite\'s claim lands each night, and it shares that Heretic\'s night action slot — taking it means giving up your own directive.',
  },
  {
    id: 'catalyst', label: 'Catalyst', kind: 'Mechanic', doc: '/docs/roles/recruiter',
    aliases: ['catalyst', 'conversion', 'converted'],
    glossTemplate: 'The Recruiter\'s conversion. A player sitting at Black — drift {blackMin} — can be flipped to the Heretic side silently, and wakes already turned.',
  },
  {
    id: 'conclave', label: 'The Conclave', kind: 'Setting', doc: '/docs/how-to-play',
    aliases: ['conclave', 'conclaves'],
    gloss: 'The assembled operatives — the table itself. It sits by day to accuse and vote, and disperses when the light withdraws.',
  },
  {
    id: 'cabal', label: 'The Cabal', kind: 'Setting', doc: '/docs/how-to-play',
    aliases: ['cabal', 'cabalite', 'cabalites'],
    gloss: 'The Heretics, collectively. They know one another from the first night, share a private channel, and win together.',
  },
  {
    id: 'heretic', label: 'Heretic', kind: 'Faction', doc: '/docs/how-to-play',
    aliases: ['heretic', 'heretics'],
    gloss: 'The Warp\'s servants, hidden among the faithful. They win by reaching parity with the Loyalists — by the knife, or by conversion.',
  },
  {
    id: 'loyalist', label: 'Loyalist', kind: 'Faction', doc: '/docs/how-to-play',
    aliases: ['loyalist', 'loyalists'],
    gloss: 'The Emperor\'s faithful. They win by cutting the living Heretic count below parity, which means finding them before the nights run out.',
  },
  {
    id: 'parity', label: 'Parity', kind: 'Win condition', doc: '/docs/how-to-play',
    aliases: ['parity'],
    gloss: 'The Heretic victory line: living Heretics equal or outnumber living Loyalists. Every night kill drags the table toward it.',
  },
  {
    id: 'sleep', label: 'Sleep', kind: 'Mechanic', doc: '/docs/drift',
    aliases: ['sleep', 'sleeps', 'slept', 'sleeping'],
    glossTemplate: 'Submitting no night action. It costs nothing and pays {sleepRecovery} drift, which is the only dependable way back down the ladder.',
  },
];

// Renders any entry's glossTemplate (drift/zone/catalyst/sleep — the four
// that state a number) into its final `gloss`; entries with a plain `gloss`
// already (no numbers to template) pass through untouched.
const MECHANIC_COST_CONTEXT = {
  maxDrift: DRIFT.MAX,
  sleepRecovery: formatSigned(DRIFT.SLEEP_RECOVERY),
  greenMin: DRIFT.ZONES.green[0], greenMax: DRIFT.ZONES.green[1],
  yellowMin: DRIFT.ZONES.yellow[0], yellowMax: DRIFT.ZONES.yellow[1],
  orangeMin: DRIFT.ZONES.orange[0], orangeMax: DRIFT.ZONES.orange[1],
  redMin: DRIFT.ZONES.red[0], redMax: DRIFT.ZONES.red[1],
  blackMin: DRIFT.ZONES.black[0],
};
for (const term of mechanicTerms) {
  if (term.glossTemplate) term.gloss = renderTemplate(term.glossTemplate, MECHANIC_COST_CONTEXT);
}

export const GLOSSARY_TERMS = [...roleTerms, ...mechanicTerms];

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
