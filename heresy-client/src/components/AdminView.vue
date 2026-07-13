<template>
  <main class="admin-shell">
    <section v-if="!authenticated" class="admin-login" @submit.prevent>
      <div>
        <span class="kicker">Admin</span>
        <h1>Heresy Rising Control</h1>
      </div>
      <form @submit.prevent="login">
        <label>
          Password
          <input v-model="passwordInput" type="password" autocomplete="current-password" autofocus />
        </label>
        <button type="submit" :disabled="loading">Unlock</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else class="admin-panel">
      <header class="admin-header">
        <div>
          <span class="kicker">Admin</span>
          <h1>Players, Stats & Resumes</h1>
        </div>
        <div class="admin-actions">
          <button type="button" @click="loadOverview" :disabled="loading">Refresh</button>
          <button type="button" @click="logout">Lock</button>
        </div>
      </header>

      <div class="stat-strip">
        <div><span>Players</span><strong>{{ totals.players || 0 }}</strong></div>
        <div><span>Runs</span><strong>{{ totals.runs || 0 }}</strong></div>
        <div><span>Games</span><strong>{{ totals.gamesPlayed || 0 }}</strong></div>
        <div><span>Wins</span><strong>{{ totals.wins || 0 }}</strong></div>
        <div><span>Losses</span><strong>{{ totals.losses || 0 }}</strong></div>
        <div><span>Valid Resumes</span><strong>{{ totals.activeResumes || 0 }}</strong></div>
      </div>

      <nav class="tabs">
        <button :class="{ active: tab === 'players' }" @click="tab = 'players'">Players</button>
        <button :class="{ active: tab === 'achievements' }" @click="tab = 'achievements'">Achievements</button>
        <button :class="{ active: tab === 'resumes' }" @click="tab = 'resumes'">Resumes</button>
        <button :class="{ active: tab === 'gameLogs' }" @click="openGameLogs">Game Logs</button>
      </nav>

      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="tab === 'players'" class="players-panel">
        <div class="merge-panel">
          <strong>Merge Players</strong>
          <label>
            From
            <select v-model.number="mergeSourceId">
              <option :value="null">Source player</option>
              <option v-for="player in players" :key="player.id" :value="player.id">
                {{ player.username }} · {{ player.playerCode }}
              </option>
            </select>
          </label>
          <label>
            Into
            <select v-model.number="mergeTargetId">
              <option :value="null">Target player</option>
              <option v-for="player in players" :key="player.id" :value="player.id">
                {{ player.username }} · {{ player.playerCode }}
              </option>
            </select>
          </label>
          <button type="button" class="danger" :disabled="!canMergePlayers" @click="mergePlayers">Merge</button>
        </div>

        <div class="table-wrap">
          <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Games</th>
              <th>W/L</th>
              <th>Bosses</th>
              <th>Cards</th>
              <th>Symbols</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="player in players" :key="player.id" :class="{ selected: selectedPlayer?.id === player.id }">
              <td><input v-model="player.username" /></td>
              <td><code>{{ player.playerCode }}</code></td>
              <td><input v-model.number="player.gamesPlayed" type="number" min="0" /></td>
              <td class="split">
                <input v-model.number="player.wins" type="number" min="0" />
                <input v-model.number="player.losses" type="number" min="0" />
              </td>
              <td><input v-model.number="player.bossesDefeatedTotal" type="number" min="0" /></td>
              <td><input v-model.number="player.cardsPlayedTotal" type="number" min="0" /></td>
              <td><input v-model.number="player.symbolsPlayedTotal" type="number" min="0" /></td>
              <td class="row-actions">
                <button @click="selectedPlayer = player">Details</button>
                <button @click="savePlayer(player)">Save</button>
                <button class="danger" @click="deletePlayer(player)">Delete</button>
              </td>
            </tr>
          </tbody>
          </table>
        </div>
      </section>

      <section v-if="tab === 'achievements'" class="detail-grid">
        <article v-for="player in players" :key="player.id" class="achievement-card">
          <header>
            <strong>{{ player.username }}</strong>
            <span>{{ player.gamesPlayed }} games</span>
          </header>
          <div class="badge-list">
            <span v-for="achievement in achievementsFor(player)" :key="achievement">{{ achievement }}</span>
            <em v-if="achievementsFor(player).length === 0">No achievements yet</em>
          </div>
        </article>
      </section>

      <section v-if="tab === 'resumes'" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th>Next</th>
              <th>Bosses Defeated</th>
              <th>Active Room</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="resume in resumes" :key="resume.code">
              <td><code>{{ resume.code }}</code></td>
              <td><span class="status" :class="resume.status">{{ resume.status }}</span></td>
              <td>Dungeon {{ resume.nextDungeonNumber }}</td>
              <td>{{ resume.bossesDefeated?.length || 0 }}/{{ resume.totalBosses }}</td>
              <td>{{ resume.activeRoomCode || '-' }}</td>
              <td>{{ formatDate(resume.updatedAt) }}</td>
              <td class="row-actions">
                <button v-if="resume.status === 'active'" class="danger" @click="setResumeStatus(resume, 'invalid')">Invalidate</button>
                <button v-else @click="setResumeStatus(resume, 'active')">Reactivate</button>
                <button @click="clearResumeRoom(resume)">Clear Room</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="tab === 'gameLogs'" class="logs-panel">
        <div class="logs-toolbar">
          <strong>Game Logs</strong>
          <button type="button" @click="loadGameLogs" :disabled="logsLoading">Refresh Logs</button>
        </div>
        <div class="logs-layout">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Ruleset</th>
                  <th>Players</th>
                  <th>Phase</th>
                  <th>Events</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="log in gameLogs" :key="log.id">
                  <tr :class="{ selected: selectedGameLog?.id === log.id }">
                    <td class="room-log-cell">
                      <button
                        type="button"
                        class="expand-arrow"
                        :class="{ open: expandedLogIds.has(log.id) }"
                        :title="expandedLogIds.has(log.id) ? 'Collapse dungeons' : 'Expand dungeons'"
                        @click="toggleLogExpansion(log)"
                      >
                        ▸
                      </button>
                      <code>{{ log.roomCode }}</code>
                    </td>
                    <td>{{ formatRuleset(log.ruleset) }}</td>
                    <td>{{ formatLogPlayers(log) }}</td>
                    <td>{{ log.phase }}</td>
                    <td>{{ log.eventCount }}</td>
                    <td>{{ formatDate(log.updatedAt) }}</td>
                    <td class="row-actions">
                      <button type="button" @click="loadGameLog(log.id)">Open</button>
                      <button type="button" @click="copyGameLog(log)" title="Copy full log">Copy All</button>
                      <button type="button" class="danger" @click="deleteGameLog(log)">Delete</button>
                    </td>
                  </tr>
                  <tr v-if="expandedLogIds.has(log.id)" class="expanded-log-row">
                    <td colspan="7">
                      <div v-if="expandedLogDetails[log.id]" class="dungeon-copy-list">
                        <button
                          v-for="dungeon in dungeonsForLog(expandedLogDetails[log.id])"
                          :key="dungeon.index"
                          type="button"
                          @click="copyGameLogDungeon(expandedLogDetails[log.id], dungeon)"
                        >
                          Copy Dungeon {{ dungeon.dungeonNumber }}{{ dungeon.bossName ? ` -> ${dungeon.bossName}` : '' }}
                        </button>
                        <span v-if="dungeonsForLog(expandedLogDetails[log.id]).length === 0">No dungeon segments found.</span>
                      </div>
                      <span v-else>Loading dungeon logs...</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <article v-if="selectedGameLog" class="log-detail">
            <header>
              <div>
                <strong>{{ selectedGameLog.roomCode }}</strong>
                <span>{{ formatRuleset(selectedGameLog.ruleset) }} · {{ selectedGameLog.phase }}</span>
              </div>
              <button type="button" @click="selectedGameLog = null">Close</button>
            </header>
            <div class="log-meta">
              <span>{{ selectedGameLog.players?.length || 0 }} players</span>
              <span>{{ selectedGameLog.events?.length || 0 }} events</span>
              <span>Updated {{ formatDate(selectedGameLog.updatedAt) }}</span>
            </div>
            
            <div class="round-selector" v-if="parsedDungeons.length > 0">
              <label>
                Dungeon:
                <select v-model.number="selectedRoundIndex">
                  <option :value="-1">All Dungeons ({{ parsedDungeons.length }} total)</option>
                  <option v-for="dungeon in parsedDungeons" :key="dungeon.index" :value="dungeon.index">
                    Dungeon {{ dungeon.dungeonNumber }}{{ dungeon.bossName ? ` -> ${dungeon.bossName}` : '' }}
                  </option>
                </select>
              </label>
            </div>
            
            <h3>Round History</h3>
            <div class="log-history">
              <p v-for="(item, index) in filteredHistory" :key="`${item.timestamp}-${index}`">
                <span>{{ formatDate(item.timestamp) }}</span>
                {{ item.prefix ? `${item.prefix} ` : '' }}{{ item.message || item.cardName || item.type }}
              </p>
              <p v-if="filteredHistory.length === 0" class="no-entries">No entries for this dungeon</p>
            </div>
            <h3>Event Log</h3>
            <pre>{{ formattedFilteredEvents }}</pre>
          </article>
        </div>
      </section>

      <aside v-if="selectedPlayer" class="drawer">
        <header>
          <strong>{{ selectedPlayer.username }}</strong>
          <button @click="selectedPlayer = null">Close</button>
        </header>
        <div class="counter-editor">
          <h3>Symbol Totals</h3>
          <label v-for="symbol in symbols" :key="symbol">
            {{ symbol }}
            <input v-model.number="selectedPlayer.symbolTotals[symbol]" type="number" min="0" />
          </label>
          <h3>Recent Runs</h3>
          <p v-for="run in selectedPlayer.recentRuns || []" :key="run.id">
            {{ run.outcome }} · dungeon {{ run.dungeonReached }} · {{ formatDate(run.endedAt) }}
          </p>
        </div>
      </aside>
    </section>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue';

const STORAGE_KEY = 'heresy-rising:adminPassword';
const symbols = ['sword', 'shield', 'scroll', 'arrow', 'jump'];
const tab = ref('players');
const passwordInput = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const password = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const authenticated = ref(!!password.value);
const loading = ref(false);
const error = ref('');
const players = ref([]);
const resumes = ref([]);
const totals = ref({});
const selectedPlayer = ref(null);
const mergeSourceId = ref(null);
const mergeTargetId = ref(null);
const gameLogs = ref([]);
const selectedGameLog = ref(null);
const selectedRoundIndex = ref(-1);
const logsLoading = ref(false);
const expandedLogIds = ref(new Set());
const expandedLogDetails = ref({});

const canMergePlayers = computed(() => (
  mergeSourceId.value &&
  mergeTargetId.value &&
  mergeSourceId.value !== mergeTargetId.value
));

const parsedDungeons = computed(() => dungeonsForLog(selectedGameLog.value));

function dungeonsForLog(log) {
  const events = log?.events || [];
  const starts = events.filter(event => event.kind === 'game_started');
  if (starts.length === 0) return [];

  return starts.map((start, index) => {
    const nextStart = starts[index + 1];
    const endTimestamp = nextStart?.t || null;
    const dungeonNumber = Number(start.dungeon) || index + 1;
    const boss = events.find(event => (
      event.kind === 'boss_revealed' &&
      event.t >= start.t &&
      (!endTimestamp || event.t < endTimestamp)
    ));
    return {
      index,
      dungeonNumber,
      startTimestamp: start.t,
      endTimestamp,
      bossName: boss?.bossName || boss?.cardName || boss?.name || ''
    };
  });
}

const filteredHistory = computed(() => {
  if (selectedRoundIndex.value === -1) {
    return selectedGameLog.value?.history || [];
  }
  const dungeon = parsedDungeons.value[selectedRoundIndex.value];
  if (!dungeon) return [];
  return filterHistoryForDungeon(selectedGameLog.value, dungeon);
});

const filteredEvents = computed(() => {
  if (selectedRoundIndex.value === -1) {
    return selectedGameLog.value?.events || [];
  }
  const dungeon = parsedDungeons.value[selectedRoundIndex.value];
  if (!dungeon) return [];
  return filterEventsForDungeon(selectedGameLog.value, dungeon);
});

function filterHistoryForDungeon(log, dungeon) {
  return (log?.history || []).filter(entry => {
    const entryTime = entry.timestamp || 0;
    return entryTime >= dungeon.startTimestamp && (!dungeon.endTimestamp || entryTime < dungeon.endTimestamp);
  });
}

function filterEventsForDungeon(log, dungeon) {
  return (log?.events || []).filter(event => {
    const eventTime = event.t || event.timestamp || 0;
    return eventTime >= dungeon.startTimestamp && (!dungeon.endTimestamp || eventTime < dungeon.endTimestamp);
  });
}

const formattedFilteredEvents = computed(() => JSON.stringify(filteredEvents.value, null, 2));

const BOSS_ACHIEVEMENTS = [
  { id: 'boss-baby-barbarian', label: 'Baby Barbarian Slayer' },
  { id: 'boss-grime-reaper', label: 'Grime Reaper Reaper' },
  { id: 'boss-zola', label: 'Gorgon Breaker' },
  { id: 'boss-dragon', label: 'Dragon Puncher' },
  { id: 'boss-dungeon-master', label: 'Dungeon Mastered' },
  { id: 'boss-kick-9000', label: 'K.I.C.K. Operator' },
  { id: 'boss-dungeon-master-final-form', label: 'Final Form Finisher' }
];
const GAME_ACHIEVEMENTS = [
  { label: 'First Run', target: 1 },
  { label: 'Regular Delver', target: 10 },
  { label: 'Dungeon Addict', target: 25 },
  { label: 'Table Veteran', target: 50 },
  { label: 'Five-Minute Menace', target: 100 }
];
const WIN_ACHIEVEMENTS = [
  { label: 'First Win', target: 1 },
  { label: 'Winning Habit', target: 5 },
  { label: 'Dungeon Cleaner', target: 10 },
  { label: 'Boss Farmer', target: 25 }
];
const CARD_ACHIEVEMENTS = [
  { label: 'Card Tosser', target: 50 },
  { label: 'Card Machine', target: 250 },
  { label: 'Deck Grinder', target: 500 },
  { label: 'Card Storm', target: 1000 }
];
const KILL_TIERS = [
  { label: 'Bronze', target: 1 },
  { label: 'Silver', target: 5 },
  { label: 'Gold', target: 10 },
  { label: 'Mythic', target: 25 }
];

const authHeaders = computed(() => ({
  'Content-Type': 'application/json',
  'X-Admin-Password': password.value
}));

async function adminFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders.value,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function login() {
  error.value = '';
  loading.value = true;
  try {
    password.value = passwordInput.value;
    await adminFetch('/api/admin/login', { method: 'POST', body: '{}' });
    sessionStorage.setItem(STORAGE_KEY, password.value);
    authenticated.value = true;
    await loadOverview();
  } catch (err) {
    error.value = err.message;
    authenticated.value = false;
  } finally {
    loading.value = false;
  }
}

function logout() {
  password.value = '';
  passwordInput.value = '';
  sessionStorage.removeItem(STORAGE_KEY);
  authenticated.value = false;
}

async function loadOverview() {
  error.value = '';
  loading.value = true;
  try {
    const data = await adminFetch('/api/admin/overview');
    players.value = data.players.map(player => ({
      ...player,
      symbolTotals: { sword: 0, shield: 0, scroll: 0, arrow: 0, jump: 0, ...(player.symbolTotals || {}) }
    }));
    resumes.value = data.resumes;
    totals.value = data.totals;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function savePlayer(player) {
  const data = await adminFetch(`/api/admin/players/${player.id}`, {
    method: 'PATCH',
    body: JSON.stringify(player)
  });
  Object.assign(player, data.player);
  if (selectedPlayer.value?.id === player.id) selectedPlayer.value = player;
}

async function deletePlayer(player) {
  if (!window.confirm(`Delete ${player.username}?`)) return;
  await adminFetch(`/api/admin/players/${player.id}`, { method: 'DELETE' });
  players.value = players.value.filter(item => item.id !== player.id);
  if (selectedPlayer.value?.id === player.id) selectedPlayer.value = null;
}

async function mergePlayers() {
  const source = players.value.find(player => player.id === mergeSourceId.value);
  const target = players.value.find(player => player.id === mergeTargetId.value);
  if (!source || !target) return;
  if (!window.confirm(`Merge ${source.username} into ${target.username}? The source profile will be deleted.`)) return;

  await adminFetch('/api/admin/players/merge', {
    method: 'POST',
    body: JSON.stringify({
      sourcePlayerId: source.id,
      targetPlayerId: target.id
    })
  });
  if (selectedPlayer.value?.id === source.id) selectedPlayer.value = null;
  mergeSourceId.value = null;
  mergeTargetId.value = null;
  await loadOverview();
}

async function setResumeStatus(resume, status) {
  const data = await adminFetch(`/api/admin/resumes/${resume.code}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, invalidReason: 'admin' })
  });
  Object.assign(resume, data.resume);
}

async function clearResumeRoom(resume) {
  const data = await adminFetch(`/api/admin/resumes/${resume.code}`, {
    method: 'PATCH',
    body: JSON.stringify({ clearActiveRoom: true })
  });
  Object.assign(resume, data.resume);
  await loadOverview();
}

async function openGameLogs() {
  tab.value = 'gameLogs';
  if (gameLogs.value.length === 0) await loadGameLogs();
}

async function loadGameLogs() {
  error.value = '';
  logsLoading.value = true;
  try {
    const data = await adminFetch('/api/admin/game-logs?limit=200');
    gameLogs.value = data.logs || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    logsLoading.value = false;
  }
}

async function loadGameLog(id) {
  error.value = '';
  logsLoading.value = true;
  try {
    const data = await adminFetch(`/api/admin/game-logs/${encodeURIComponent(id)}`);
    selectedGameLog.value = data.log;
    selectedRoundIndex.value = -1; // Reset to show all when opening a new log
  } catch (err) {
    error.value = err.message;
  } finally {
    logsLoading.value = false;
  }
}

async function getLoadedGameLog(id) {
  if (expandedLogDetails.value[id]) return expandedLogDetails.value[id];
  const data = await adminFetch(`/api/admin/game-logs/${encodeURIComponent(id)}`);
  expandedLogDetails.value = {
    ...expandedLogDetails.value,
    [id]: data.log
  };
  return data.log;
}

async function toggleLogExpansion(log) {
  const expanded = new Set(expandedLogIds.value);
  if (expanded.has(log.id)) {
    expanded.delete(log.id);
    expandedLogIds.value = expanded;
    return;
  }
  expanded.add(log.id);
  expandedLogIds.value = expanded;
  try {
    await getLoadedGameLog(log.id);
  } catch (err) {
    error.value = err.message;
  }
}

async function copyGameLog(log) {
  try {
    const loadedLog = await getLoadedGameLog(log.id);
    await copyText(JSON.stringify(loadedLog, null, 2));
    error.value = `Copied game log for ${log.roomCode} to clipboard.`;
    setTimeout(() => error.value = '', 3000);
  } catch (err) {
    error.value = `Failed to copy: ${err.message}`;
  }
}

async function copyGameLogDungeon(log, dungeon) {
  try {
    const segment = {
      id: log.id,
      roomCode: log.roomCode,
      ruleset: log.ruleset,
      players: log.players || [],
      dungeon: {
        number: dungeon.dungeonNumber,
        bossName: dungeon.bossName || null,
        startTimestamp: dungeon.startTimestamp,
        endTimestamp: dungeon.endTimestamp
      },
      history: filterHistoryForDungeon(log, dungeon),
      events: filterEventsForDungeon(log, dungeon)
    };
    await copyText(JSON.stringify(segment, null, 2));
    error.value = `Copied ${log.roomCode} dungeon ${dungeon.dungeonNumber} to clipboard.`;
    setTimeout(() => error.value = '', 3000);
  } catch (err) {
    error.value = `Failed to copy dungeon: ${err.message}`;
  }
}

async function deleteGameLog(log) {
  if (!window.confirm(`Delete game log for room ${log.roomCode}?`)) return;
  try {
    await adminFetch(`/api/admin/game-logs/${encodeURIComponent(log.id)}`, { method: 'DELETE' });
    gameLogs.value = gameLogs.value.filter(item => item.id !== log.id);
    if (selectedGameLog.value?.id === log.id) selectedGameLog.value = null;
    const expanded = new Set(expandedLogIds.value);
    expanded.delete(log.id);
    expandedLogIds.value = expanded;
    const { [log.id]: _removed, ...remainingDetails } = expandedLogDetails.value;
    expandedLogDetails.value = remainingDetails;
    error.value = `Deleted game log for ${log.roomCode}.`;
    setTimeout(() => error.value = '', 3000);
  } catch (err) {
    error.value = `Failed to delete log: ${err.message}`;
  }
}

async function copyText(text) {
  if (!navigator.clipboard) throw new Error('Clipboard is not available');
  await navigator.clipboard.writeText(text);
}

function addThreshold(list, value, output) {
  for (const item of list) if ((value || 0) >= item.target) output.push(item.label);
}

function addKillTiers(items, totals, output) {
  for (const item of items) {
    const count = Number(totals?.[item.id]) || 0;
    const tier = [...KILL_TIERS].reverse().find(entry => count >= entry.target);
    if (tier) output.push(`${tier.label} ${item.label}`);
  }
}

function achievementsFor(player) {
  const achievements = [];
  addThreshold(GAME_ACHIEVEMENTS, player.gamesPlayed, achievements);
  addThreshold(WIN_ACHIEVEMENTS, player.wins, achievements);
  addThreshold(CARD_ACHIEVEMENTS, player.cardsPlayedTotal, achievements);
  addKillTiers(BOSS_ACHIEVEMENTS, player.bossKillTotals, achievements);
  return achievements;
}

function formatDate(value) {
  if (!value) return '-';
  const ms = Number(value) > 10_000_000_000 ? Number(value) : Number(value) * 1000;
  return new Date(ms).toLocaleString();
}

function formatRuleset(value) {
  return String(value || 'base').replace(/_/g, ' ');
}

function formatLogPlayers(log) {
  const players = log.players || [];
  if (players.length === 0) return '-';
  return players.map(player => player.name || 'Unknown').join(', ');
}

if (authenticated.value) loadOverview();
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background: #111719;
  color: #eef6f3;
  padding: 2rem;
}
.admin-login {
  max-width: 420px;
  margin: 12vh auto;
  display: grid;
  gap: 1rem;
}
.admin-login form,
.admin-panel {
  display: grid;
  gap: 1rem;
}
.kicker {
  color: #78d6b5;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.08rem;
}
h1 {
  margin: 0.25rem 0 0;
}
label {
  display: grid;
  gap: 0.35rem;
}
input,
button {
  border: 1px solid rgba(255,255,255,0.15);
  background: #182225;
  color: #eef6f3;
  border-radius: 6px;
  padding: 0.55rem 0.7rem;
}
button {
  cursor: pointer;
  background: #23765f;
}
button.danger {
  background: #7d2c35;
}
.admin-header,
.admin-actions,
.tabs,
.row-actions,
.merge-panel {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.admin-header {
  justify-content: space-between;
}
.stat-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.75rem;
}
.stat-strip div,
.achievement-card,
.drawer,
.admin-login {
  background: #172124;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 1rem;
}
.stat-strip span,
.achievement-card span {
  color: #9fb2ad;
  font-size: 0.8rem;
}
.stat-strip strong {
  display: block;
  font-size: 1.5rem;
}
.tabs button.active {
  background: #78d6b5;
  color: #0f1719;
}
.players-panel {
  display: grid;
  gap: 0.75rem;
}
.logs-panel,
.logs-layout {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.logs-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.log-detail {
  background: #121b1e;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 1rem;
  display: grid;
  gap: 0.8rem;
}
.log-detail header,
.log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.log-detail header span,
.log-meta,
.log-history span {
  color: #9fb2ad;
  font-size: 0.82rem;
}
.log-history {
  max-height: 280px;
  overflow: auto;
  display: grid;
  gap: 0.35rem;
}
.log-history p {
  margin: 0;
}
.log-detail pre {
  max-height: 420px;
  overflow: auto;
  background: #0b1113;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.expanded-log-row td {
  background: #0f1719;
}
.room-log-cell {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  white-space: nowrap;
}
.expand-arrow {
  width: 1.75rem;
  height: 1.75rem;
  display: inline-grid;
  place-items: center;
  padding: 0;
  background: transparent;
  border-color: rgba(255,255,255,0.12);
  color: #9fb2ad;
  transition: transform 0.15s ease, color 0.15s ease;
}
.expand-arrow.open {
  transform: rotate(90deg);
  color: #78d6b5;
}
.dungeon-copy-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.dungeon-copy-list button {
  background: #1d5f70;
}
.merge-panel {
  flex-wrap: wrap;
  background: #172124;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 0.75rem;
}
.merge-panel label {
  min-width: 240px;
}
select {
  border: 1px solid rgba(255,255,255,0.15);
  background: #182225;
  color: #eef6f3;
  border-radius: 6px;
  padding: 0.55rem 0.7rem;
}
.round-selector {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}
.round-selector label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.round-selector select {
  min-width: 300px;
}
.no-entries {
  color: #9fb2ad;
  font-style: italic;
}
.table-wrap {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #121b1e;
}
th,
td {
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 0.55rem;
  text-align: left;
  vertical-align: middle;
}
td input {
  width: 100%;
  min-width: 70px;
}
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.8rem;
}
.achievement-card header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.badge-list span,
.status {
  border-radius: 999px;
  padding: 0.22rem 0.5rem;
  background: rgba(120,214,181,0.16);
}
.status.invalid {
  background: rgba(190,70,80,0.25);
}
.drawer {
  position: fixed;
  top: 1rem;
  right: 1rem;
  width: min(380px, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  overflow: auto;
  box-shadow: 0 18px 50px rgba(0,0,0,0.45);
}
.drawer header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.counter-editor {
  display: grid;
  gap: 0.55rem;
}
.error {
  color: #ff9aa5;
}
@media (max-width: 800px) {
  .admin-shell { padding: 1rem; }
  .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-header { align-items: flex-start; flex-direction: column; }
}
</style>
