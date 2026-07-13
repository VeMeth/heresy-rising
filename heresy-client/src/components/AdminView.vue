<template>
  <main class="admin-shell">
    <section v-if="!authenticated" class="login-panel">
      <span>ADMIN</span>
      <h1>Heresy Rising Control</h1>
      <form @submit.prevent="login">
        <label>Password<input v-model="passwordInput" type="password" autocomplete="current-password" autofocus></label>
        <button type="submit" :disabled="loading">Unlock</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else class="control-room">
      <header class="topbar">
        <div>
          <span>ADMIN</span>
          <h1>Live Conclaves</h1>
        </div>
        <div class="actions">
          <button type="button" @click="loadOverview" :disabled="loading">Refresh</button>
          <button type="button" @click="logout">Lock</button>
        </div>
      </header>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="metrics">
        <div><span>Conclaves</span><strong>{{ totals.games || 0 }}</strong></div>
        <div><span>Active</span><strong>{{ totals.active || 0 }}</strong></div>
        <div><span>Lobby</span><strong>{{ totals.lobby || 0 }}</strong></div>
        <div><span>Ended</span><strong>{{ totals.ended || 0 }}</strong></div>
        <div><span>Players</span><strong>{{ totals.players || 0 }}</strong></div>
        <div><span>Messages</span><strong>{{ totals.messages || 0 }}</strong></div>
      </div>

      <nav class="tabs">
        <button type="button" :class="{ active: tab === 'cells' }" @click="tab = 'cells'">Conclaves</button>
        <button type="button" :class="{ active: tab === 'logs' }" @click="openLogs">Game Logs</button>
      </nav>

      <section v-if="tab === 'cells'" class="layout">
        <aside class="cell-list">
          <button
            v-for="game in games"
            :key="game.code"
            type="button"
            :class="{ selected: selectedCode === game.code }"
            @click="loadGame(game.code)"
          >
            <strong>{{ game.code }}</strong>
            <span>{{ game.status }} · {{ game.phase }}{{ game.dayStage ? `/${game.dayStage}` : '' }}</span>
            <small>{{ game.playerCount }} players · round {{ game.round }}</small>
          </button>
          <p v-if="!games.length" class="empty">No conclaves found.</p>
        </aside>

        <article v-if="detail" class="detail">
          <header class="detail-head">
            <div>
              <span>CONCLAVE {{ detail.game.code }}</span>
              <h2>{{ detail.game.status }} · {{ detail.game.phase }}{{ detail.game.dayStage ? `/${detail.game.dayStage}` : '' }}</h2>
            </div>
            <div class="actions">
              <button type="button" @click="copyJson(detail)">Copy JSON</button>
              <button type="button" @click="endGame('admin')">End</button>
              <button type="button" class="danger" @click="deleteGame">Delete</button>
            </div>
          </header>

          <div class="facts">
            <span>Mode <strong>{{ detail.game.mode }}</strong></span>
            <span>Round <strong>{{ detail.game.round }}</strong></span>
            <span>Winner <strong>{{ detail.game.winner || '-' }}</strong></span>
            <span>Deadline <strong>{{ formatDate(detail.game.deadline) }}</strong></span>
            <span>Max drift <strong>{{ detail.game.maxDrift }}</strong></span>
            <span>Updated <strong>{{ formatDate(detail.game.updatedAt) }}</strong></span>
          </div>

          <section>
            <h3>Players</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Seat</th><th>Name</th><th>Role</th><th>Faction</th><th>Drift</th><th>State</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="player in detail.players" :key="player.playerCode">
                    <td>{{ player.seat }}<span v-if="player.isHost"> H</span></td>
                    <td><strong>{{ player.name }}</strong><code>{{ player.playerCode }}</code></td>
                    <td>
                      <select v-model="player.roleId">
                        <option :value="null">Unassigned</option>
                        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.displayName }}</option>
                      </select>
                    </td>
                    <td>
                      <select v-model="player.faction">
                        <option value="">-</option>
                        <option value="loyalist">loyalist</option>
                        <option value="heretic">heretic</option>
                      </select>
                    </td>
                    <td><input v-model.number="player.drift" type="number" min="0" :max="detail.game.maxDrift"></td>
                    <td class="checks">
                      <label><input v-model="player.alive" type="checkbox"> Alive</label>
                      <label><input v-model="player.ready" type="checkbox"> Ready</label>
                      <label><input v-model="player.connected" type="checkbox"> Online</label>
                      <label><input v-model="player.confessed" type="checkbox"> Confessed</label>
                    </td>
                    <td><button type="button" @click="savePlayer(player)">Save</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div class="columns">
            <section>
              <h3>Actions</h3>
              <pre>{{ pretty(detail.actions) }}</pre>
            </section>
            <section>
              <h3>Votes</h3>
              <pre>{{ pretty(detail.votes) }}</pre>
            </section>
          </div>

          <div class="columns">
            <section>
              <h3>Messages</h3>
              <div class="scroll-list">
                <p v-for="message in detail.messages" :key="message.id">
                  <span>{{ formatDate(message.createdAt) }} · {{ message.channel }} · {{ message.author }}</span>
                  {{ message.body }}
                </p>
              </div>
            </section>
            <section>
              <h3>Events</h3>
              <pre>{{ pretty(detail.events) }}</pre>
            </section>
          </div>
        </article>
      </section>

      <section v-if="tab === 'logs'" class="logs">
        <header class="detail-head">
          <div><span>ARCHIVE</span><h2>Game Logs</h2></div>
          <button type="button" @click="loadLogs" :disabled="loading">Refresh</button>
        </header>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Room</th><th>Phase</th><th>Players</th><th>Events</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td><code>{{ log.roomCode }}</code></td>
                <td>{{ log.phase }}</td>
                <td>{{ (log.players || []).map(p => p.name).join(', ') || '-' }}</td>
                <td>{{ log.eventCount }}</td>
                <td>{{ formatDate(log.updatedAt) }}</td>
                <td class="actions">
                  <button type="button" @click="loadLog(log.id)">Open</button>
                  <button type="button" class="danger" @click="deleteLog(log)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <pre v-if="selectedLog">{{ pretty(selectedLog) }}</pre>
      </section>
    </section>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue';

const STORAGE_KEY = 'heresy-rising:adminPassword';
const passwordInput = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const password = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const authenticated = ref(!!password.value);
const loading = ref(false);
const error = ref('');
const tab = ref('cells');
const games = ref([]);
const totals = ref({});
const roles = ref([]);
const detail = ref(null);
const selectedCode = ref('');
const logs = ref([]);
const selectedLog = ref(null);

const headers = computed(() => ({ 'Content-Type': 'application/json', 'X-Admin-Password': password.value }));

async function adminFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...headers.value, ...(options.headers || {}) } });
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
  sessionStorage.removeItem(STORAGE_KEY);
  password.value = '';
  passwordInput.value = '';
  authenticated.value = false;
}
async function loadOverview() {
  error.value = '';
  loading.value = true;
  try {
    const data = await adminFetch('/api/admin/overview');
    games.value = data.games || [];
    totals.value = data.totals || {};
    roles.value = data.roles || [];
    if (!selectedCode.value && games.value[0]) await loadGame(games.value[0].code);
    else if (selectedCode.value) await loadGame(selectedCode.value).catch(() => { detail.value = null; selectedCode.value = ''; });
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
async function loadGame(code) {
  selectedCode.value = code;
  detail.value = await adminFetch(`/api/admin/games/${encodeURIComponent(code)}`);
}
async function savePlayer(player) {
  const data = await adminFetch(`/api/admin/games/${encodeURIComponent(selectedCode.value)}/players/${encodeURIComponent(player.playerCode)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      roleId: player.roleId,
      faction: player.faction || null,
      drift: player.drift,
      alive: player.alive,
      ready: player.ready,
      connected: player.connected,
      confessed: player.confessed
    })
  });
  Object.assign(player, data.player);
}
async function endGame(winner) {
  if (!selectedCode.value || !confirm(`End conclave ${selectedCode.value}?`)) return;
  detail.value = await adminFetch(`/api/admin/games/${encodeURIComponent(selectedCode.value)}/end`, { method: 'POST', body: JSON.stringify({ winner }) });
  await loadOverview();
}
async function deleteGame() {
  if (!selectedCode.value || !confirm(`Permanently delete conclave ${selectedCode.value}?`)) return;
  await adminFetch(`/api/admin/games/${encodeURIComponent(selectedCode.value)}`, { method: 'DELETE' });
  detail.value = null;
  selectedCode.value = '';
  await loadOverview();
}
async function openLogs() {
  tab.value = 'logs';
  if (!logs.value.length) await loadLogs();
}
async function loadLogs() {
  const data = await adminFetch('/api/admin/game-logs?limit=200');
  logs.value = data.logs || [];
}
async function loadLog(id) {
  const data = await adminFetch(`/api/admin/game-logs/${encodeURIComponent(id)}`);
  selectedLog.value = data.log;
}
async function deleteLog(log) {
  if (!confirm(`Delete log for ${log.roomCode}?`)) return;
  await adminFetch(`/api/admin/game-logs/${encodeURIComponent(log.id)}`, { method: 'DELETE' });
  logs.value = logs.value.filter(item => item.id !== log.id);
  if (selectedLog.value?.id === log.id) selectedLog.value = null;
}
async function copyJson(value) {
  await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
}
function pretty(value) {
  return JSON.stringify(value || [], null, 2);
}
function formatDate(value) {
  if (!value) return '-';
  const numeric = Number(value);
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toLocaleString();
}

if (authenticated.value) loadOverview();
</script>

<style scoped>
.admin-shell{min-height:100vh;background:#101312;color:#e7e3d5;padding:24px;font-family:Inter,system-ui,sans-serif}.login-panel,.control-room{max-width:1500px;margin:0 auto}.login-panel{width:min(440px,100%);margin-top:12vh;background:#171a16;border:1px solid #34372f;padding:28px}.login-panel span,.topbar span,.detail-head span{color:#b69a5c;font-size:11px;font-weight:800;letter-spacing:.16em}.login-panel h1,.topbar h1,.detail-head h2{margin:6px 0 18px;font-family:Cinzel,serif}.login-panel form{display:grid;gap:14px}label{display:grid;gap:7px;font-size:11px;font-weight:800;text-transform:uppercase;color:#aaa99d}input,select{background:#0d0f0d;border:1px solid #3a3c34;color:#e7e3d5;padding:9px;border-radius:2px}button{background:#8f7543;border:1px solid #b99c62;color:#0b0c0a;padding:9px 12px;text-transform:uppercase;font-size:10px;font-weight:800;letter-spacing:.1em;cursor:pointer}button.danger{background:#7a2a25;border-color:#a8463d;color:#fff}button:disabled{opacity:.5}.error{border:1px solid #70352f;background:#321916;color:#d99b95;padding:10px}.topbar,.detail-head,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.actions{justify-content:flex-end}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:20px 0}.metrics div,.detail,.logs,.cell-list button{background:#171a16;border:1px solid #34372f}.metrics div{padding:14px}.metrics span,.facts span{display:block;color:#8f9287;font-size:10px;text-transform:uppercase;letter-spacing:.12em}.metrics strong{display:block;margin-top:5px;font-size:24px}.tabs{display:flex;gap:8px;margin-bottom:14px}.tabs .active,.cell-list .selected{background:#2b271b;color:#dfc27c;border-color:#b69a5c}.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px}.cell-list{display:grid;align-content:start;gap:8px}.cell-list button{text-align:left;color:#e7e3d5;padding:14px}.cell-list strong,.cell-list span,.cell-list small{display:block}.cell-list span{margin-top:4px;color:#c8c0aa}.cell-list small{margin-top:5px;color:#8f9287}.detail,.logs{padding:18px;min-width:0}.facts{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.facts span{background:#0d0f0d;border:1px solid #2c3028;padding:10px}.facts strong{display:block;color:#e7e3d5;margin-top:4px;text-transform:none;letter-spacing:0}.table-wrap{overflow:auto;border:1px solid #34372f}table{width:100%;border-collapse:collapse;min-width:900px}th,td{border-bottom:1px solid #2c3028;padding:9px;text-align:left;vertical-align:top}th{color:#b69a5c;font-size:10px;text-transform:uppercase;letter-spacing:.12em;background:#11130f}td code{display:block;margin-top:4px;color:#8f9287;font-size:10px}.checks{display:grid;grid-template-columns:repeat(2,minmax(90px,1fr));gap:6px}.checks label{display:flex;align-items:center;gap:5px;text-transform:none;font-weight:600;letter-spacing:0}.checks input{width:auto}.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}pre,.scroll-list{max-height:360px;overflow:auto;background:#0b0d0b;border:1px solid #2c3028;color:#d9d7cc;padding:12px;font-size:12px;line-height:1.5}.scroll-list p{border-bottom:1px solid #252820;margin:0;padding:9px 0;white-space:pre-wrap}.scroll-list span{display:block;color:#8f9287;font-size:10px;margin-bottom:4px}.empty{color:#8f9287}@media(max-width:900px){.metrics,.facts,.columns,.layout{grid-template-columns:1fr}.topbar,.detail-head{align-items:flex-start;flex-direction:column}}
</style>
