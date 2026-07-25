/**
 * Report generation — aggregation, JSON output, text summary.
 */

/**
 * Aggregate results into summary statistics.
 * @param {Array} games - Array of game result objects
 * @returns {Object} Aggregated report
 */
export function aggregateResults(games) {
  if (!games || games.length === 0) {
    return {
      summary: {
        loyalistWins: 0,
        hereticWins: 0,
        draws: 0,
        loyalistWinRate: 0,
        avgRounds: 0,
        medianRounds: 0,
      },
      perRole: {},
    };
  }

  const loyalistWins = games.filter(g => g.winner === 'loyalist').length;
  const hereticWins = games.filter(g => g.winner === 'heretic').length;
  const draws = games.filter(g => g.winner === 'draw').length;
  const total = games.length;
  const rounds = games.map(g => g.rounds).sort((a, b) => a - b);
  const avgRounds = rounds.reduce((s, r) => s + r, 0) / rounds.length;
  const medianRounds = rounds.length % 2 === 1
    ? rounds[Math.floor(rounds.length / 2)]
    : (rounds[rounds.length / 2 - 1] + rounds[rounds.length / 2]) / 2;

  // Per-role stats
  const roleStats = {};
  for (const game of games) {
    for (const player of game.players) {
      const roleId = player.roleId;
      if (!roleId) continue;
      if (!roleStats[roleId]) {
        roleStats[roleId] = {
          games: 0,
          survivedToEnd: 0,
          avgDriftAtEnd: 0,
          lynchedRate: 0,
          totalDrift: 0,
          lynched: 0,
        };
      }
      roleStats[roleId].games++;
      roleStats[roleId].totalDrift += player.drift || 0;
      if (player.alive) roleStats[roleId].survivedToEnd++;
      if (!player.alive && player.crippleTier >= 3) roleStats[roleId].lynched++;
    }
  }

  // Calculate derived per-role stats
  for (const [roleId, stats] of Object.entries(roleStats)) {
    stats.avgDriftAtEnd = stats.games > 0
      ? Math.round((stats.totalDrift / stats.games) * 10) / 10
      : 0;
    stats.lynchedRate = stats.games > 0
      ? Math.round((stats.lynched / stats.games) * 100) / 100
      : 0;
    delete stats.totalDrift;
    delete stats.lynched;
  }

  // Per-composition stats
  const compStats = {};
  for (const game of games) {
    const compKey = (game.composition || [])
      .map(c => c.roleId || c)
      .sort()
      .join(',');
    if (!compStats[compKey]) {
      compStats[compKey] = { games: 0, loyalistWins: 0, hereticWins: 0, draws: 0 };
    }
    compStats[compKey].games++;
    if (game.winner === 'loyalist') compStats[compKey].loyalistWins++;
    else if (game.winner === 'heretic') compStats[compKey].hereticWins++;
    else compStats[compKey].draws++;
  }

  // Drift distribution
  const driftValues = games.flatMap(g =>
    g.players.map(p => p.drift || 0)
  );
  const driftBuckets = { '0-4': 0, '5-9': 0, '10-14': 0, '15-19': 0, '20': 0 };
  for (const d of driftValues) {
    if (d >= 20) driftBuckets['20']++;
    else if (d >= 15) driftBuckets['15-19']++;
    else if (d >= 10) driftBuckets['10-14']++;
    else if (d >= 5) driftBuckets['5-9']++;
    else driftBuckets['0-4']++;
  }

  return {
    summary: {
      loyalistWins,
      hereticWins,
      draws,
      loyalistWinRate: total > 0 ? Math.round((loyalistWins / total) * 1000) / 1000 : 0,
      hereticWinRate: total > 0 ? Math.round((hereticWins / total) * 1000) / 1000 : 0,
      drawRate: total > 0 ? Math.round((draws / total) * 1000) / 1000 : 0,
      avgRounds: Math.round(avgRounds * 10) / 10,
      medianRounds,
      totalGames: total,
    },
    perRole: roleStats,
    perComposition: compStats,
    driftDistribution: driftBuckets,
  };
}

/**
 * Generate a text summary table for stdout.
 * @param {Object} report - From aggregateResults
 * @returns {string}
 */
export function formatTextSummary(report) {
  const { summary, perRole } = report;
  const lines = [];

  lines.push('═'.repeat(50));
  lines.push('  HERESY RISING — SIMULATION RESULTS');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`  Games:        ${summary.totalGames}`);
  lines.push(`  Loyalist:     ${summary.loyalistWins} (${(summary.loyalistWinRate * 100).toFixed(1)}%)`);
  lines.push(`  Heretic:      ${summary.hereticWins} (${(summary.hereticWinRate * 100).toFixed(1)}%)`);
  lines.push(`  Draws:        ${summary.draws} (${(summary.drawRate * 100).toFixed(1)}%)`);
  lines.push(`  Avg Rounds:   ${summary.avgRounds}`);
  lines.push(`  Median Rounds: ${summary.medianRounds}`);
  lines.push('');

  if (Object.keys(perRole).length > 0) {
    lines.push('── Per-Role Stats ─────────────────────────');
    lines.push('');
    lines.push('  Role                    Games  Alive%  Drift  Lynched%');
    lines.push('  ─────────────────────── ─────  ──────  ─────  ────────');
    for (const [roleId, stats] of Object.entries(perRole).sort()) {
      const surviveRate = Math.round((stats.survivedToEnd / stats.games) * 100);
      lines.push(
        `  ${roleId.padEnd(23)} ${String(stats.games).padStart(5)}  ` +
        `${String(surviveRate).padStart(3)}%   ` +
        `${String(stats.avgDriftAtEnd).padStart(5)}  ` +
        `${(stats.lynchedRate * 100).toFixed(0)}%`
      );
    }
  }

  // Drift distribution
  if (report.driftDistribution) {
    lines.push('');
    lines.push('── Drift Distribution ─────────────────────');
    lines.push('');
    const dist = report.driftDistribution;
    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    for (const [bucket, count] of Object.entries(dist)) {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 2));
      lines.push(`  ${bucket.padEnd(5)}: ${String(count).padStart(5)} (${String(pct).padStart(2)}%) ${bar}`);
    }
  }

  lines.push('');
  lines.push('═'.repeat(50));

  return lines.join('\n');
}

/**
 * Build the complete results JSON object.
 * @param {Object} meta - Run metadata
 * @param {Array} games - Game result objects
 * @param {number} elapsed - Elapsed time in ms
 * @returns {Object}
 */
export function buildResultsJSON(meta, games, elapsed) {
  const aggregated = aggregateResults(games);
  return {
    meta: {
      ...meta,
      elapsed,
    },
    summary: aggregated.summary,
    perRole: aggregated.perRole,
    games: games.map(g => ({
      seed: g.seed,
      winner: g.winner,
      rounds: g.rounds,
      composition: g.composition.map(c => c.roleId || c),
      players: g.players.map(p => ({
        role: p.roleId,
        faction: p.faction,
        alive: p.alive,
        drift: p.drift,
        lynched: !p.alive && p.crippleTier >= 3,
      })),
    })),
  };
}
