<template>
  <div class="simres">
    <div class="simres-stats">
      <div class="simres-stat simres-loy"><span>Loyalist wins</span><strong>{{ pct(result.summary?.loyalistWinRate) }}</strong></div>
      <div class="simres-stat simres-her"><span>Heretic wins</span><strong>{{ pct(result.summary?.hereticWinRate) }}</strong></div>
      <div class="simres-stat"><span>Draws</span><strong>{{ pct(result.summary?.drawRate) }}</strong></div>
      <div class="simres-stat"><span>Avg rounds</span><strong>{{ num(result.summary?.avgRounds) }}</strong></div>
      <div class="simres-stat"><span>Median rounds</span><strong>{{ num(result.summary?.medianRounds) }}</strong></div>
      <div class="simres-stat"><span>Games run</span><strong>{{ result.meta?.gameCount ?? result.summary?.totalGames ?? '-' }}</strong></div>
    </div>
    <p class="simres-meta">
      Seed <code>{{ result.meta?.seed ?? '-' }}</code>
      <template v-if="result.meta?.playerCount"> · {{ result.meta.playerCount }}p</template>
      <template v-if="result.meta?.simVersion"> · sim v{{ result.meta.simVersion }}</template>
      <template v-if="result.meta?.elapsed != null"> · {{ num(result.meta.elapsed / 1000) }}s</template>
    </p>

    <details v-if="roleRows.length" class="simres-roles" open>
      <summary>Per-role outcomes ({{ roleRows.length }} roles)</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Role</th><th>Games</th><th>Survived</th><th>Lynched</th><th>Avg drift @ end</th></tr></thead>
          <tbody>
            <tr v-for="r in roleRows" :key="r.id">
              <td>{{ r.displayName }}</td>
              <td>{{ r.games }}</td>
              <td>{{ pct(r.survivalRate) }}</td>
              <td>{{ pct(r.lynchedRate) }}</td>
              <td>{{ r.avgDriftAtEnd != null ? num(r.avgDriftAtEnd) : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<script setup>
// Shared render of a heresy-sim result payload — the inner {meta, summary,
// perRole} object, already unwrapped from whichever transport carried it
// (the `game:simulate` socket ack's `.result`, or the raw JSON body from
// POST /api/admin/simulate). Used by both LobbyView's host-only "test this
// setup" panel and AdminView's Simulator tab so the two surfaces render
// identical win-rate/per-role summaries.
import { computed } from 'vue';
import { validRoles } from '../compositionData.js';

const props = defineProps({
  result: { type: Object, required: true },
});

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return `${(Number(v) * 100).toFixed(1)}%`;
}
function num(v, decimals = 1) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(decimals);
}

const roleRows = computed(() => {
  const perRole = props.result?.perRole || {};
  return Object.entries(perRole)
    .map(([id, stats]) => ({
      id,
      displayName: validRoles.get(id)?.displayName || id,
      games: stats?.games ?? 0,
      survivalRate: stats?.games ? (stats.survivedToEnd ?? 0) / stats.games : null,
      lynchedRate: stats?.lynchedRate,
      avgDriftAtEnd: stats?.avgDriftAtEnd,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
});
</script>

<style scoped>
.simres { margin-top: 14px; }
.simres-stats {
  display: flex; flex-wrap: wrap; gap: 10px 20px;
  padding: 12px 14px; border: 1px solid var(--line, #34372f);
  background: #0d0f0d; border-radius: 2px;
}
.simres-stat { display: flex; flex-direction: column; gap: 2px; min-width: 92px; }
.simres-stat span { font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: var(--muted, #8f9287); }
.simres-stat strong { font: 700 18px Cinzel, serif; color: var(--pale, #e8e4d5); }
.simres-loy strong { color: #9fbf8a; }
.simres-her strong { color: #d58c75; }
.simres-meta { margin: 10px 2px 0; color: var(--muted, #8f9287); font-size: 11px; }
.simres-meta code { color: var(--gold, #b69a5c); }
.simres-roles { margin-top: 14px; }
.simres-roles summary { cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--gold2, #dfc27c); margin-bottom: 8px; }
.simres-roles .table-wrap { overflow: auto; border: 1px solid var(--line, #34372f); margin-top: 8px; }
.simres-roles table { width: 100%; border-collapse: collapse; min-width: 480px; }
.simres-roles th, .simres-roles td { border-bottom: 1px solid #2c3028; padding: 7px 9px; text-align: left; font-size: 12px; }
.simres-roles th { color: var(--gold, #b69a5c); font-size: 10px; text-transform: uppercase; letter-spacing: .1em; background: #11130f; }
</style>
