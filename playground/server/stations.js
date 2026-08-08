import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Station catalogs for heresy-rising-site night and day resolution.
 * Each station represents a single atomic operation in the engine's dispatch loop.
 *
 * These tables are transcribed directly from the engine (heresyGameManager.js)
 * and checked for consistency at runtime. Mismatch with the engine is fatal.
 */

// Night stations 0–14, verbatim from docs/night-resolver.html
export const NIGHT_STATIONS = Object.freeze([
  { n: 0, name: 'Build night state' },
  { n: 1, name: 'Sleep & flat action costs' },
  { n: 2, name: 'Protect' },
  { n: 3, name: 'Bodyguard' },
  { n: 4, name: 'Infect' },
  { n: 5, name: 'Sermons' },
  { n: 6, name: 'Intel & Execute on Sight' },
  { n: 7, name: 'Heretical Catalyst' },
  { n: 8, name: 'Kill' },
  { n: 9, name: 'Blood Ritual' },
  { n: 10, name: 'Possess' },
  { n: 11, name: 'Plague tick' },
  { n: 12, name: 'Proximity Siphon' },
  { n: 13, name: 'Night report' },
  { n: 14, name: 'Win check → Day n+1' },
]);

// Day stations D0–D6, from resolveDay and day resolution functions.
export const DAY_STATIONS = Object.freeze([
  { n: 'D0', name: 'Vote tally' },
  { n: 'D1', name: 'Stand-down / tie' },
  { n: 'D2', name: 'Torture' },
  { n: 'D3', name: 'Lynch' },
  { n: 'D4', name: 'Possession detonation' },
  { n: 'D5', name: 'Heretic cap' },
  { n: 'D6', name: 'Win check → Night n' },
]);

/**
 * Map from hr_actions.kind to the night station that consumes it.
 * Verified against resolveNight() loop at heresyGameManager.js:782–889.
 *
 * - boobytrap: consumed via trapBlocks() check at every station; has no dedicated
 *   station but functions as a defensive interrupt. Mapped to 0 as a placeholder.
 * - forgery: day-only action, not resolved during night. Mapped to null.
 */
export const KIND_TO_STATION = Object.freeze({
  sleep: 1,
  investigate: 6, // resolveIntel at station 6
  protect: 2,
  'warp-read': 6, // resolveIntel at station 6
  'drift-hint': 6, // resolveIntel at station 6
  bodyguard: 3,
  kill: 8,
  sermon: 5,
  'corrupt-sermon': 5,
  boobytrap: 0, // Consumed by trapBlocks() at every station; no dedicated station
  'heretical-catalyst': 7,
  possess: 10,
  infect: 4,
  'blood-ritual': 9,
  forgery: null, // Day-only; no night station
});

/**
 * Reasons why drift changed, as passed to changeDrift(c, player, delta, reason).
 * Mapped to either a single station number, 'ambiguous' (needs disambiguation), or null.
 *
 * Ambiguous reasons appear at multiple stations and need actor-kind or context to
 * disambiguate at trace-parse time. Each ambiguous reason is documented with its
 * candidate stations.
 *
 * Verified by grepping every changeDrift() call site in heresyGameManager.js.
 */
export const REASON_TO_STATION = Object.freeze({
  // Unambiguous reasons (single station or context-specific)
  sleep: 1, // Station 1: no action submitted
  'sermon-self': 5, // Station 5: Priest / Heretic Priest self-cost
  'sermon-target': 5, // Station 5: target drift from sermon
  'murderer-gate-witnessed': 8, // Station 8: target +1 when murderer's kill fizzles
  'plague-source': 11, // Station 11: Patient Zero accumulation
  'plague-carrier': 11, // Station 11: carrier accumulation
  'proximity-siphon': 12, // Station 12: Imperial Citizen siphon
  'heretic-cap': 'D5', // Day station D5: heretic drift cap spike
  'wrong-lynch': 'D3', // Day station D3: loyalist executed by lynch
  forgery: 'D*', // Day-only, can occur at any day phase

  // Ambiguous reasons (multiple possible stations, need actor kind or outcome)
  'night-action': 'ambiguous', // Candidate stations: 1 (flat cost), 8 (kill), 9 (blood-ritual)
  trap: 'ambiguous', // Candidate stations: 0 (build, boobytrap index), 2–10 (trapBlocks() on any action)
  'witnessed-violence': 'ambiguous', // Candidate stations: 6 (execute-on-sight), 8 (kill), 9 (blood-ritual), D3 (lynch), D4 (possession detonation)
  'possess-attempt': null, // Submission-time charge at submitAction(); not resolved at night-end. Requires special handling.
});

/**
 * Set of all ambiguous reasons that require actor-kind or outcome context to resolve.
 */
export const AMBIGUOUS_REASONS = Object.freeze(
  new Set(Object.entries(REASON_TO_STATION)
    .filter(([, station]) => station === 'ambiguous')
    .map(([reason]) => reason))
);

/**
 * Documented ambiguities for trace classification:
 * - 'night-action': Station 1 (flat cost for most roles), station 8 (kill self-cost),
 *   or station 9 (blood-ritual self-cost). Disambiguated by action kind.
 * - 'trap': Stations 0 (boobytrap indexed at build), or 2–10 (trapBlocks() defensive interrupt).
 *   Disambiguated by whether the charge is an index operation or a reaction.
 * - 'witnessed-violence': Stations 6 (execute-on-sight), 8 (kill), 9 (blood-ritual),
 *   day D3 (lynch), or day D4 (possession detonation). Disambiguated by phase and action outcome.
 */

/**
 * Kill evaluation order, transcribed from heresyGameManager.js:826–843.
 * Each gate is checked in order; a gate that exits stops further evaluation.
 *
 * Critical facts (from lines 829, 834):
 * - A trap on the **target** does NOT block a kill — it charges TRAP_DRIFT and continues.
 *   Only a trap on the **actor** causes the chain to exit.
 * - Bodyguard redirect is checked BEFORE protect:
 *   `if (!bodyguardRedirected && protectedIds.has(target)) victim = null`
 *   A doubled-up defense (both bodyguard and protect on same target) means the
 *   Arbitrator claims the hit and dies, while the Chirurgeon's protect is never consulted.
 *
 * Field notes:
 * - `gate` is a descriptive name for the branch, NOT a verdict. `verdictOnExit` is
 *   the VERDICTS value a trace should assign when the chain exits at this step, or
 *   null for a step that never terminates the chain. These string literals must stay
 *   in sync with VERDICTS below — they are spelled out rather than referenced because
 *   VERDICTS is declared later in this module and would be in the temporal dead zone.
 * - Every threshold here is config-driven. Do not hardcode the default numbers: the
 *   playground exists precisely so maxDrift and the drift costs can be changed.
 */
export const KILL_PRECEDENCE = Object.freeze([
  {
    step: 1,
    gate: 'murderer-drift-gate',
    verdictOnExit: 'gated-by-drift',
    terminates: true,
    note: 'Murderer only: fizzles when killer.drift + killRole.driftWeight > game.max_drift. '
      + 'Target takes MURDERER_GATE_TARGET_DRIFT; the killer pays NO self-cost (the '
      + 'night-action charge sits after this continue).',
  },
  {
    step: 2,
    gate: 'actor-trap-blocks',
    verdictOnExit: 'blocked-by-trap',
    terminates: true,
    note: 'Trap on ACTOR? Kill cancelled, actor takes TRAP_DRIFT. The night-action '
      + 'self-cost was already charged before this check.',
  },
  {
    step: 3,
    gate: 'target-trap-taxes',
    verdictOnExit: null,
    terminates: false,
    note: 'Trap on TARGET? Actor takes TRAP_DRIFT but the kill CONTINUES. '
      + 'The only gate in the chain that does not stop it.',
  },
  {
    step: 4,
    gate: 'bodyguard-redirect',
    verdictOnExit: 'redirected-to-bodyguard',
    terminates: true,
    note: 'Bodyguard on target? Guard becomes the victim and dies. Checked BEFORE protect.',
  },
  {
    step: 5,
    gate: 'protect-absorbs',
    verdictOnExit: 'absorbed-by-protect',
    terminates: true,
    note: 'Protect on target, and only if no bodyguard already redirected? victim = null. '
      + 'Leaves NO positive evidence — this is the one verdict that must be derived.',
  },
]);

/**
 * Intel kind constant object to avoid the underscore/hyphen trap.
 * Two intelKind values differ by exactly one character:
 * - 'drift_hint' (underscore): zone-crossing cue sent by changeDrift() when a player
 *   crosses zones during any drift change.
 * - 'drift-hint' (hyphen): Investigator/Novice Psychic's scan result at station 6
 *   (resolveIntel, warp-read path).
 *
 * Accidentally swapping these is a live bug. Exporting them as named constants
 * prevents inlining and catches mismatches at parse time.
 */
export const INTEL_KIND = Object.freeze({
  // Drift zone crossing cue (sent by changeDrift, line 1277)
  ZONE_CUE: 'drift_hint',

  // Investigator and Novice Psychic scan (resolveIntel, line 1007)
  SCAN: 'drift-hint',

  // Warp-read (Astropath visitor scan, resolveIntel, line 1044)
  WARP_READ: 'warp-read',

  // Interrogation result (T1-T3 faction/zone scans, resolveIntel, line 1061)
  INTERROGATE: 'interrogate',

  // Execute-on-Sight trigger message (station 6, line 819)
  EXECUTE_ON_SIGHT: 'execute_on_sight',

  // Animus possession success/failure (station 10, line 879)
  ANIMUS_POSSESS: 'animus_possess',

  // Murderer kill gate cue (station 8, line 827)
  MURDERER_KILL_GATED: 'murderer_kill_gated',
});

/**
 * Verdict vocabulary for kill/attack outcomes in the trace.
 *
 * Keys are SCREAMING_SNAKE_CASE, values are the kebab-case strings that go on
 * the wire. These were once keyed by their own values (`{landed:'landed',
 * 'blocked-by-trap':'blocked-by-trap'}`), which read fine but meant every
 * `VERDICTS.LANDED` in trace.js silently evaluated to `undefined` — and
 * JSON.stringify drops undefined properties, so `verdict` and `confidence`
 * vanished from every trace on the wire with no error anywhere. Keep the two
 * cases distinct: identifier-shaped keys, string-shaped values.
 */
export const VERDICTS = Object.freeze({
  LANDED: 'landed',
  BLOCKED_BY_TRAP: 'blocked-by-trap',
  REDIRECTED_TO_BODYGUARD: 'redirected-to-bodyguard',
  ABSORBED_BY_PROTECT: 'absorbed-by-protect',
  GATED_BY_DRIFT: 'gated-by-drift',
  SILENT_CRIPPLED: 'silent-crippled',
  NO_OP: 'no-op',
  UNKNOWN: 'unknown',
});

/**
 * Confidence levels for attributed facts in the trace. See the note on
 * VERDICTS above for why the keys are SCREAMING_SNAKE_CASE.
 */
export const CONFIDENCE = Object.freeze({
  OBSERVED: 'observed',
  DERIVED_INPUT: 'derived-input',
  DERIVED_ABSENCE: 'derived-absence',
  DERIVED_RULE: 'derived-rule',
  UNOBSERVABLE: 'unobservable',
});

/**
 * Engine contract tripwire. If the engine code changes in ways that affect
 * the station dispatch, this hash will mismatch and warn that trace logic
 * is unvalidated.
 *
 * Spans are line ranges from heresyGameManager.js that were transcribed into
 * this file. computeEngineContractHash() extracts and hashes these spans.
 */
export const ENGINE_CONTRACT = Object.freeze({
  file: 'heresy-server/src/heresyGameManager.js',
  spans: [
    { name: 'resolveNight', start: 782, end: 889 },
    { name: 'resolveIntel', start: 1005, end: 1070 },
    { name: 'changeDrift', start: 1268, end: 1286 },
    { name: 'resolveDayVote', start: 1088, end: 1128 },
  ],
  hash: '622d7506f5be351a5ec3d7c0bb23e1a24347d1fa9238e8bf2c88e753a79dd5e0',
});

/**
 * Compute the SHA256 hash of the engine contract spans.
 * Reads the file at repoRoot, extracts line ranges, concatenates, and hashes.
 *
 * @param {string} repoRoot - Repository root directory
 * @returns {string} SHA256 hash in hex
 */
export function computeEngineContractHash(repoRoot) {
  const filePath = `${repoRoot}/${ENGINE_CONTRACT.file}`;
  const content = readFileSync(filePath, 'utf-8').split('\n');

  const extracted = ENGINE_CONTRACT.spans
    .map(({ start, end }) => {
      // Lines are 1-indexed in the contract; array is 0-indexed
      return content.slice(start - 1, end).join('\n');
    })
    .join('\n');

  const hash = createHash('sha256').update(extracted).digest('hex');
  return hash;
}

/**
 * Retrieve a night station by its number.
 * @param {number} n - Station number 0–14
 * @returns {object} { n, name }
 */
export function nightStation(n) {
  return NIGHT_STATIONS[n];
}

/**
 * Retrieve a day station by its ID.
 * @param {string} id - Station ID D0–D6
 * @returns {object} { n, name }
 */
export function dayStation(id) {
  return DAY_STATIONS.find(s => s.n === id);
}

/**
 * Get the night station that consumes a given action kind.
 * @param {string} kind - Action kind from hr_actions.kind
 * @returns {number|null} Station number, or null if day-only or unmapped
 */
export function stationForKind(kind) {
  return KIND_TO_STATION[kind] ?? null;
}

/**
 * Get the station(s) associated with a changeDrift reason.
 * @param {string} reason - Reason string from changeDrift() calls
 * @returns {number|string|null} Station number/ID, 'ambiguous', or null
 */
export function stationForReason(reason) {
  return REASON_TO_STATION[reason] ?? null;
}
