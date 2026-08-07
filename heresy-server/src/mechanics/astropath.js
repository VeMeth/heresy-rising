// L8 Astropath (locked spec, 2026-08-07, v1.1.0). hr_actions already durably
// logs every night action any player submits (game_code, round, actor_code,
// kind, target_code, ...), upserted in submitAction — it IS the visitor log
// the Astropath reads. No new persistence, just filtered queries over the
// same table protection.js's getLastProtectTarget/validateRotation already
// query.
//
// `kind != 'warp-read'` filter below is deliberate. v1.1.0 shifted T1 to
// read Night N (the night being resolved), which means the Astropath's own
// warp-read for the same target on the same night would land in the visitor
// list alongside every real visit — making T1 a self-referential random pick
// ("is the name that surfaced mine, or someone else's?"). The spec's visitor
// enumeration (roles/astropath.md v1.0.0 changelog) lists the kinds that
// count as visits and intentionally omits warp-read; the principle "any
// night action" is read here as excluding the reader's own scan, since the
// read itself is meta-intel about the trail, not a physical visitation.

// Actor codes of every player whose night action targeted `targetCode` on
// exactly `round`. Deliberately does not exclude the target's own action on
// themselves — self-investigate is banned at submission (target:'other'), so
// a target can never appear as its own visitor here in practice.
export function getVisitorsForRound(db, gameCode, targetCode, round) {
  const rows = db.prepare(
    "SELECT actor_code FROM hr_actions WHERE game_code=? AND round=? AND target_code=? AND kind<>'warp-read'"
  ).all(gameCode, round, targetCode);
  return rows.map(r => r.actor_code);
}

// Deduped union of actor codes across the inclusive round range
// [fromRound, toRound] — T2's "visited sometime in the last 2 nights", no
// per-night attribution.
export function getVisitorsUnion(db, gameCode, targetCode, fromRound, toRound) {
  const rows = db.prepare(
    "SELECT DISTINCT actor_code FROM hr_actions WHERE game_code=? AND round BETWEEN ? AND ? AND target_code=? AND kind<>'warp-read'"
  ).all(gameCode, fromRound, toRound, targetCode);
  return rows.map(r => r.actor_code);
}
