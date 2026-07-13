<template>
  <div class="lb-backdrop" @click.self="$emit('close')">
    <div class="lb-panel" role="dialog" aria-label="Leaderboard">

      <div class="lb-header">
        <h2 class="lb-title">🏆 Leaderboard</h2>
        <span class="lb-total">{{ activeTab === 'runs' ? `${total} run${total !== 1 ? 's' : ''} recorded` : `${playerRows.length} ranked player${playerRows.length !== 1 ? 's' : ''}` }}</span>
        <button class="lb-close" @click="$emit('close')" aria-label="Close">✕</button>
      </div>

      <div class="lb-body">
        <div class="lb-tabs">
          <button :class="{ active: activeTab === 'runs' }" @click="activeTab = 'runs'">Best Runs</button>
          <button :class="{ active: activeTab === 'players' }" @click="activeTab = 'players'">Player Stats</button>
        </div>
        <div v-if="activeTab === 'runs'" class="lb-filters" aria-label="Run leaderboard filters">
          <button :class="{ active: runPlayerCount === 'all' }" @click="setRunPlayerCount('all')">All Teams</button>
          <button :class="{ active: runPlayerCount === '2' }" @click="setRunPlayerCount('2')">2 Players</button>
        </div>
        <p v-if="loading" class="lb-state">Loading…</p>
        <p v-else-if="error" class="lb-state lb-error">{{ error }}</p>
        <p v-else-if="activeTab === 'runs' && rows.length === 0" class="lb-state">No runs recorded yet. Be the first!</p>
        <p v-else-if="activeTab === 'players' && playerRows.length === 0" class="lb-state">No player stats yet.</p>

        <table v-else-if="activeTab === 'runs'" class="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Result</th>
              <th>Bosses</th>
              <th>Progress</th>
              <th>Team</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="row.id" :class="row.outcome">
              <td class="lb-rank">{{ i + 1 }}</td>
              <td>
                <span class="lb-badge" :class="row.outcome">
                  {{ row.outcome === 'victory' ? 'VICTORY' : 'DEFEAT' }}
                </span>
              </td>
              <td class="lb-bosses">
                <span class="bosses-bar">
                  <span
                    v-for="n in rowTotalBosses(row)"
                    :key="n"
                    class="boss-dot"
                    :class="{ filled: n <= row.bossesDefeated }"
                  ></span>
                  <span class="boss-label">{{ row.bossesDefeated }}/{{ rowTotalBosses(row) }}</span>
                </span>
              </td>
              <td class="lb-progress">{{ progressLabel(row) }}</td>
              <td class="lb-team">
                <span
                  v-for="(p, ti) in row.team"
                  :key="ti"
                  class="team-member"
                  :title="memberTitle(p)"
                >
                  <span class="member-name">{{ p.name }}</span>
                  <span v-if="p.hero" class="member-hero">{{ heroEmojis(p) }}</span>
                  <span v-if="ti < row.team.length - 1" class="member-sep">,</span>
                </span>
                <span v-if="row.playerCount > row.team.length" class="team-more">
                  +{{ row.playerCount - row.team.length }}
                </span>
              </td>
              <td class="lb-date">{{ formatDate(row.endedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <table v-else class="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Wins</th>
              <th>Games</th>
              <th>Win Rate</th>
              <th>Bosses</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in playerRows" :key="row.id">
              <td class="lb-rank">{{ i + 1 }}</td>
              <td class="member-name">{{ row.username }}</td>
              <td>{{ row.wins }}</td>
              <td>{{ row.gamesPlayed }}</td>
              <td>{{ Math.round(row.winRate * 100) }}%</td>
              <td>{{ row.bossesDefeatedTotal }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="lb-footer">
        <button class="lb-refresh" @click="fetchData" :disabled="loading">↻ Refresh</button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const props = defineProps({
  // If not provided, derives server URL from the socket connection
  serverUrl: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['close']);

const rows    = ref([]);
const playerRows = ref([]);
const total   = ref(0);
const loading = ref(false);
const error   = ref('');
const activeTab = ref('runs');
const runPlayerCount = ref('all');

function getServerBase() {
  if (props.serverUrl) return props.serverUrl;
  // Nginx proxies /api to the server at the same origin
  return window.location.origin;
}

async function fetchData() {
  loading.value = true;
  error.value   = '';
  try {
    const base = getServerBase();
    if (!base) throw new Error('No server URL');
    const playerCountParam = runPlayerCount.value === 'all' ? '' : `&playerCount=${encodeURIComponent(runPlayerCount.value)}`;
    const res = await fetch(`${base}/api/leaderboard?limit=10${playerCountParam}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const playerRes = await fetch(`${base}/api/leaderboard/players?limit=20`);
    if (!playerRes.ok) throw new Error(`HTTP ${playerRes.status}`);
    const playerJson = await playerRes.json();
    rows.value  = json.rows  ?? [];
    total.value = json.total ?? 0;
    playerRows.value = playerJson.rows ?? [];
  } catch (e) {
    error.value = 'Failed to load leaderboard.';
  } finally {
    loading.value = false;
  }
}

function setRunPlayerCount(value) {
  if (runPlayerCount.value === value) return;
  runPlayerCount.value = value;
  fetchData();
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const HERO_EMOJI = {
  barbarian: '🔥', gladiator: '⚔️', sorceress: '🔮', wizard: '🧙',
  paladin: '🛡️',  valkyrie: '✨', huntress: '🏹', ranger: '🎯',
  ninja: '🥷',     thief: '💰', druid: '🌿', shaman: '🥁'
};
function heroEmoji(hero) { return HERO_EMOJI[hero] ?? '❓'; }
function heroEmojis(player) {
  return [player?.hero, player?.secondHero].filter(Boolean).map(heroEmoji).join('');
}
function rowTotalBosses(row) {
  return row?.totalBosses || 7;
}
function progressLabel(row) {
  if (row?.outcome === 'victory') return 'Completed';
  const cardText = `${row?.dungeonCardsCleared || 0}/${row?.dungeonCardsTotal || 0} cards`;
  if (row?.bossReached) {
    return `${cardText}, boss ${row?.bossSymbolsCleared || 0}/${row?.bossSymbolsTotal || 0}`;
  }
  return cardText;
}
function memberTitle(player) {
  const heroes = [player?.hero, player?.secondHero].filter(Boolean).join(' + ');
  return heroes ? `${player.name} - ${heroes}` : player.name;
}

onMounted(fetchData);
</script>

<style scoped>
.lb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 600;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.lb-panel {
  background: #1a1a2e;
  border: 2px solid #3a3a5c;
  border-radius: 16px;
  width: min(720px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}

.lb-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #3a3a5c;
  flex-shrink: 0;
}

.lb-title {
  margin: 0;
  font-size: 1.3rem;
  color: #FFD700;
  flex: 1;
}

.lb-total {
  font-size: 0.8rem;
  color: #888;
}

.lb-close {
  background: none;
  border: none;
  color: #888;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  transition: color 0.2s, background 0.2s;
}
.lb-close:hover { color: #fff; background: rgba(255,255,255,0.1); }

.lb-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1.25rem;
}

.lb-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.lb-tabs button {
  border: 1px solid #3a3a5c;
  border-radius: 8px;
  background: rgba(255,255,255,0.06);
  color: #aaa;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
}

.lb-tabs button.active {
  border-color: rgba(255,215,0,0.55);
  background: rgba(255,215,0,0.14);
  color: #FFD700;
}

.lb-filters {
  display: flex;
  gap: 0.4rem;
  margin: -0.25rem 0 0.85rem;
}

.lb-filters button {
  border: 1px solid #30304e;
  border-radius: 999px;
  background: rgba(255,255,255,0.04);
  color: #8f99b8;
  padding: 0.28rem 0.7rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.lb-filters button.active {
  border-color: rgba(76, 175, 80, 0.55);
  background: rgba(76, 175, 80, 0.14);
  color: #a5d6a7;
}

.lb-state {
  text-align: center;
  color: #888;
  padding: 2rem;
}

.lb-error { color: #f44336; }

.lb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.lb-table th {
  text-align: left;
  color: #888;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid #3a3a5c;
}

.lb-table td {
  padding: 0.55rem 0.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  vertical-align: middle;
  color: #e0e0e0;
}

.lb-table tr:last-child td { border-bottom: none; }

/* Victory rows get a subtle gold left border */
.lb-table tr.victory td:first-child {
  border-left: 3px solid #FFD700;
}
/* Defeat rows get subtle red left border */
.lb-table tr.game-over td:first-child {
  border-left: 3px solid #f44336;
}

.lb-rank {
  color: #888;
  font-size: 0.8rem;
  width: 2rem;
}

.lb-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.lb-badge.victory  { background: rgba(255,215,0,0.2);   color: #FFD700; }
.lb-badge.game-over { background: rgba(244,67,54,0.2);  color: #ef5350; }

.lb-bosses { white-space: nowrap; }
.lb-progress {
  min-width: 110px;
  color: #b8c7c2;
  font-size: 0.78rem;
}

.bosses-bar {
  display: flex;
  align-items: center;
  gap: 3px;
}

.boss-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #333;
  border: 1px solid #555;
  transition: background 0.2s;
}
.boss-dot.filled { background: #FFD700; border-color: #FFD700; }

.boss-label {
  margin-left: 4px;
  font-size: 0.75rem;
  color: #888;
}

.lb-team {
  max-width: 260px;
  line-height: 1.4;
}

.team-member {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}

.member-name {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-hero {
  font-size: 0.75rem;
}

.member-sep { color: #555; margin: 0 1px; }

.team-more {
  font-size: 0.72rem;
  color: #666;
}

.lb-date {
  font-size: 0.75rem;
  color: #666;
  white-space: nowrap;
}

.lb-footer {
  padding: 0.75rem 1.25rem;
  border-top: 1px solid #3a3a5c;
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

.lb-refresh {
  background: rgba(255,255,255,0.08);
  border: 1px solid #3a3a5c;
  color: #aaa;
  padding: 0.4rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.82rem;
  transition: background 0.2s, color 0.2s;
}
.lb-refresh:hover:not(:disabled) { background: rgba(255,255,255,0.15); color: #fff; }
.lb-refresh:disabled { opacity: 0.4; cursor: default; }

/* Scrollbar */
.lb-body::-webkit-scrollbar { width: 6px; }
.lb-body::-webkit-scrollbar-track { background: transparent; }
.lb-body::-webkit-scrollbar-thumb { background: #3a3a5c; border-radius: 3px; }

@media (max-width: 640px) {
  .lb-panel {
    max-height: 92vh;
  }

  .lb-header {
    align-items: flex-start;
  }

  .lb-total {
    display: none;
  }

  .lb-body {
    overflow-x: auto;
    padding: 0.75rem;
  }

  .lb-table {
    min-width: 560px;
  }
}
</style>
