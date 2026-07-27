// Player-count digits in these messages are generated from the same
// hardRules values the checks below compare against (passed in by the
// caller \u2014 see compositionData.js's hardRules, itself derived from
// game_data/composition.json) instead of being re-typed, so a message can
// never quote a stale threshold.
function buildSoftMessages(hardRules) {
  return {
    S1: `Priest below ${hardRules.priest_min_player_count}p weakens the Heretic Priest\u2019s claim targets. Proceed?`,
    S2: `Heretic Priest below ${hardRules.heretic_priest_min_player_count}p lacks a Priest to mimic. Proceed?`,
    S3: `Recruiter below ${hardRules.recruiter_min_player_count}p shortens the catalyst carrier window. Proceed?`,
    S4: `Conspirator below ${hardRules.conspirator_min_player_count}p may produce sparse forgeries. Proceed?`,
    S5: "Heretic Priest without a Priest/chirurgeon target has weaker mimicry. Proceed?",
    S6: `Animus below ${hardRules.animus_min_player_count}p makes a wrong speculation guess costlier relative to the table size. Proceed?`
  };
}

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
    // hardRules.animus_min_player_count is a required key in
    // game_data/composition.json (not optional like the *_rationale prose
    // fields) — a silent `?? 8` fallback here would mask a config/schema
    // regression by quietly reproducing today's value instead of surfacing
    // it, so a missing key throws rather than falling back.
    if (roster.includes('animus') && hardRules.animus_min_player_count === undefined) {
      throw new Error('validateComposition: hardRules.animus_min_player_count is required.');
    }

    const SOFT_MESSAGES = buildSoftMessages(hardRules);

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
    if (roster.includes('animus') && playerCount < hardRules.animus_min_player_count) {
      warnings.push({ kind: 'soft', rule: 'S6', message: SOFT_MESSAGES.S6 });
    }

    for (const w of warnings) {
      if (!confirmedWarnings.includes(w.rule)) {
        errors.push({ kind: 'soft_unacknowledged', rule: w.rule, message: w.message });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
