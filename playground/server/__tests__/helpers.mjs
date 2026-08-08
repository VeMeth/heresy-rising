/**
 * Shared fixtures for the playground test suite.
 *
 * NOT a test file itself (no "test"/"-test"/".test." in the name), so
 * `node --test server/__tests__/` (playground/package.json's test script)
 * does not try to run it as a suite on its own — it's imported by the
 * files that are.
 */

/**
 * An 8-player roster covering every kill-chain defence in one board:
 *   - sanctioned-psyker: kill-capable, NOT drift-gated (only 'murderer' is)
 *   - murderer: kill-capable AND drift-gated — the only role that can
 *     produce the 'gated-by-drift' verdict (heresyGameManager.js:829-ish,
 *     "killer.role_id==='murderer'")
 *   - chirurgeon: protect
 *   - arbitrator: bodyguard
 *   - saboteur: boobytrap
 *   - 3x imperial-citizen filler (sanctioned-psyker ships at >=7p per
 *     composition.json's sanctioned_psyker_min_player_count)
 *
 * Faction parity holds: heretic (murderer, saboteur) = 2 <= loyalist
 * (sanctioned-psyker, chirurgeon, arbitrator, 3x citizen) = 6.
 */
export const KILL_CHAIN_ROSTER = [
  'sanctioned-psyker',
  'chirurgeon',
  'arbitrator',
  'saboteur',
  'murderer',
  'imperial-citizen',
  'imperial-citizen',
  'imperial-citizen',
];

/** @returns {{name:string}[]} */
export function mkPlayers(n, prefix = 'P') {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}` }));
}

/**
 * Build a sandbox on KILL_CHAIN_ROSTER and return it alongside a
 * name->playerCode map, keyed the same as the roster order, so callers don't
 * have to re-derive seat indices by hand.
 *
 * @param {import('../sandbox.js').CreateSandboxOptions} opts
 * @returns {{sandbox: import('../sandbox.js').Sandbox, psyker:string, chir:string, arb:string, sab:string, murd:string, c1:string, c2:string, c3:string}}
 */
export function buildKillChainSandbox(createSandbox, opts = {}) {
  const players = mkPlayers(KILL_CHAIN_ROSTER.length);
  const sandbox = createSandbox({
    players,
    roster: KILL_CHAIN_ROSTER,
    options: { maxDrift: 20 },
    ...opts,
  });
  const [psyker, chir, arb, sab, murd, c1, c2, c3] = sandbox.listPlayerCodes().map(p => p.playerCode);
  return { sandbox, psyker, chir, arb, sab, murd, c1, c2, c3 };
}
