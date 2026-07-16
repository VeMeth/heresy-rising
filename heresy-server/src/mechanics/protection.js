export function canProtectSelf(roleId) {
  return roleId === 'chirurgeon';
}

export function validateRotation(db, gameCode, actorCode, targetCode, currentRound) {
  const prev = db.prepare(
    "SELECT target_code FROM hr_actions WHERE game_code=? AND actor_code=? AND kind IN ('protect','bodyguard') AND round=?"
  ).get(gameCode, actorCode, currentRound - 1);
  if (!prev) return true;
  return prev.target_code !== targetCode;
}

export function getLastProtectTarget(db, gameCode, playerCode) {
  const row = db.prepare(
    "SELECT target_code FROM hr_actions WHERE game_code=? AND actor_code=? AND kind='protect' ORDER BY round DESC LIMIT 1"
  ).get(gameCode, playerCode);
  return row?.target_code || null;
}
