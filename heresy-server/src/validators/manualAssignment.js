import { shuffle } from '../utils.js';

/**
 * Resolve a game's seat-to-role assignment when an admin has hand-picked
 * some (or all) of the roles, letting the locked Fisher-Yates shuffle fill
 * in every seat the admin left untouched.
 *
 * This is a narrow, server-side-only escape hatch (see
 * docs/specs/mechanics/setup.md's "Role assignment" section) — it must
 * never be reachable by a normal host, only by a caller already verified
 * to be on the admin allowlist.
 *
 * @param {Object} params
 * @param {string[]} params.ids                       – Resolved role-id roster (a multiset;
 *   duplicate 'imperial-citizen' entries are allowed, but per composition's H2 rule every
 *   other role id is unique within it).
 * @param {{player_code:string}[]} params.players      – Lobby player rows, in seat order.
 * @param {Record<string,string>} params.manualAssignments – Admin's explicit picks, keyed by
 *   playerCode, may be a partial map covering only some seats.
 * @returns {string[]} Role ids parallel to `players` — assigned[i] is the role for players[i],
 *   exactly the same shape `shuffle(ids)` produces.
 * @throws {Error} If `manualAssignments` references a playerCode not present in `players`, or a
 *   roleId not present (or already fully consumed) in the `ids` pool.
 */
export function resolveManualAssignment({ ids, players, manualAssignments }) {
  const pool = ids.slice();
  const playerCodes = new Set(players.map(pl => pl.player_code));

  for (const code of Object.keys(manualAssignments)) {
    if (!playerCodes.has(code)) {
      throw new Error(`Manual assignment invalid: unknown player code "${code}".`);
    }
  }

  const assigned = new Array(players.length).fill(null);

  players.forEach((pl, i) => {
    const roleId = manualAssignments[pl.player_code];
    if (roleId === undefined) return;
    const idx = pool.indexOf(roleId);
    if (idx === -1) {
      throw new Error(`Manual assignment invalid: role "${roleId}" is not available in the chosen roster (already used or not present).`);
    }
    pool.splice(idx, 1);
    assigned[i] = roleId;
  });

  const shuffledLeftovers = shuffle(pool);
  let leftoverIdx = 0;
  for (let i = 0; i < assigned.length; i += 1) {
    if (assigned[i] === null) {
      assigned[i] = shuffledLeftovers[leftoverIdx];
      leftoverIdx += 1;
    }
  }

  return assigned;
}
