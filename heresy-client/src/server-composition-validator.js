const SOFT_MESSAGES = {
  S1: "Priest below 5p weakens the Heretic Priest\u2019s claim targets. Proceed?",
  S2: "Heretic Priest below 6p lacks a Priest to mimic. Proceed?",
  S3: "Recruiter below 8p shortens the catalyst carrier window. Proceed?",
  S4: "Conspirator below 11p may produce sparse forgeries. Proceed?",
  S5: "Heretic Priest without a Priest/chirurgeon target has weaker mimicry. Proceed?"
};

/**
 * Validate a composition roster against hard and soft rules.
 * Client copy — mirrors heresy-server/src/validators/composition.js exactly.
 */
export function validateComposition({ roster, playerCount, confirmedWarnings = [], validRoles, hardRules, source = 'custom' }) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(roster) || !roster.length) {
    return { ok: false, errors: [{ kind: 'hard', rule: 'H1', message: 'Roster is empty or invalid.' }], warnings };
  }

  if (typeof playerCount !== 'number' || playerCount < 1) {
    return { ok: false, errors: [{ kind: 'hard', rule: 'H1', message: 'Invalid player count.' }], warnings };
  }

  if (roster.length !== playerCount) {
    errors.push({ kind: 'hard', rule: 'H1', message: `Roster length (${roster.length}) must equal player count (${playerCount}).` });
  }

  const counts = new Map();
  for (const id of roster) {
    if (id === 'imperial-citizen') continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      errors.push({ kind: 'hard', rule: 'H2', message: `Duplicate non-citizen role: ${id} appears ${count} times.` });
    }
  }

  for (const id of roster) {
    if (!validRoles.has(id)) {
      errors.push({ kind: 'hard', rule: 'H3', message: `Unknown role ID: ${id}.` });
    }
  }

  let hereticCount = 0;
  let loyalistCount = 0;
  for (const id of roster) {
    const role = validRoles.get(id);
    if (!role) continue;
    if (role.faction === 'heretic') hereticCount++;
    else loyalistCount++;
  }

  if (hereticCount > loyalistCount) {
    errors.push({ kind: 'hard', rule: 'H4', message: `Heretic count (${hereticCount}) exceeds Loyalist count (${loyalistCount}) at start.` });
  }

  if (hereticCount === 0) {
    errors.push({ kind: 'hard', rule: 'H5', message: 'No Heretics in roster. At least 1 Heretic is required.' });
  }
  if (loyalistCount === 0) {
    errors.push({ kind: 'hard', rule: 'H5', message: 'No Loyalists in roster. At least 1 Loyalist is required.' });
  }

  if (source === 'custom') {
    if (roster.includes('priest') && playerCount < hardRules.priest_min_player_count) {
      warnings.push({ kind: 'soft', rule: 'S1', message: SOFT_MESSAGES.S1 });
    }
    if (roster.includes('heretic-priest') && playerCount < hardRules.heretic_priest_min_player_count) {
      warnings.push({ kind: 'soft', rule: 'S2', message: SOFT_MESSAGES.S2 });
    }
    if (roster.includes('recruiter') && playerCount < hardRules.recruiter_min_player_count) {
      warnings.push({ kind: 'soft', rule: 'S3', message: SOFT_MESSAGES.S3 });
    }
    if (roster.includes('conspirator') && playerCount < hardRules.conspirator_min_player_count) {
      warnings.push({ kind: 'soft', rule: 'S4', message: SOFT_MESSAGES.S4 });
    }
    if (roster.includes('heretic-priest') && !roster.includes('priest') && !roster.includes('chirurgeon')) {
      warnings.push({ kind: 'soft', rule: 'S5', message: SOFT_MESSAGES.S5 });
    }

    for (const w of warnings) {
      if (!confirmedWarnings.includes(w.rule)) {
        errors.push({ kind: 'soft_unacknowledged', rule: w.rule, message: w.message });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
