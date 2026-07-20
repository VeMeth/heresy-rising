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
        <button type="button" :class="{ active: tab === 'bots' }" @click="openBots">Bots</button>
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

      <section v-if="tab === 'bots'" class="bots">
        <header class="detail-head">
          <div><span>HERESY BOTS</span><h2>AI operatives</h2></div>
          <div class="actions">
            <button type="button" @click="loadBots" :disabled="loadingBots">Refresh</button>
            <button type="button" :class="{ active: botsPolling }" @click="toggleBotsPolling">{{ botsPolling ? 'Auto: On' : 'Auto: Off' }}</button>
          </div>
        </header>
        <p v-if="botError" class="error">{{ botError }}</p>
        <p v-if="bots.length > 0 && bots.every(b => b.llmPassive)" class="warning-banner">⚠️ All bots are in <strong>PASSIVE</strong> mode — no LLM API key configured. They will join games but pass every turn silently.</p>
        <p v-if="bots.length > 0 && bots.some(b => b.llmPassive) && !bots.every(b => b.llmPassive)" class="warning-banner">⚠️ Some bots are in <strong>PASSIVE</strong> mode.</p>

        <section class="spawn-form">
          <h3>Spawn bot</h3>
          <div class="spawn-grid">
            <label>Conclave code
              <input v-model="spawnForm.conclaveCode" type="text" placeholder="ABC123" maxlength="8" />
            </label>
            <label>Name
              <input v-model="spawnForm.name" type="text" placeholder="random W40k name" maxlength="20" />
            </label>
            <label>Seat hint (optional)
              <input v-model.number="spawnForm.seatHint" type="number" min="0" max="11" placeholder="auto" />
            </label>
            <label>Per-game token budget
              <input v-model.number="spawnForm.costCeiling" type="number" min="1000" max="500000" />
            </label>
            <label>Persona overrides (freeform)
              <textarea v-model="spawnForm.personaOverrides" rows="3" placeholder="e.g. speak in clipped, terse sentences; never claim Citizen; vote with the Heretic consensus"></textarea>
            </label>
          </div>
          <div class="actions">
            <button type="button" :disabled="loadingBots || !spawnForm.conclaveCode" @click="spawnBot">Spawn</button>
          </div>
          <p v-if="lastSpawnResult" class="spawn-result">
            <span>Last response:</span>
            <code>{{ pretty(lastSpawnResult) }}</code>
          </p>
        </section>

        <section>
          <h3>Active sessions ({{ bots.length }})</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>botId</th><th>Conclave</th><th>Name</th><th>Role</th><th>Faction</th><th>Phase</th><th>Round</th><th>Alive</th><th>Mode</th><th>Last</th><th>Tokens</th><th>Mem</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="bot in bots" :key="bot.botId">
                  <td><code>{{ bot.botId }}</code></td>
                  <td>{{ bot.conclaveCode }}</td>
                  <td><strong>{{ bot.name || '-' }}</strong></td>
                  <td>{{ bot.role || '-' }}</td>
                  <td>{{ bot.faction || '-' }}</td>
                  <td>{{ bot.phase || '-' }}</td>
                  <td>{{ bot.round ?? '-' }}</td>
                  <td>{{ bot.alive === false ? 'no' : 'yes' }}</td>
                  <td><span v-if="bot.llmPassive" class="badge badge-passive" title="No LLM configured — bot passes every turn">PASSIVE</span><span v-else class="badge badge-active" title="LLM is active">ACTIVE</span></td>
                  <td><code>{{ bot.lastAction || '-' }}</code></td>
                  <td>{{ bot.tokensUsed ?? 0 }} / {{ bot.costCeiling ?? '?' }}</td>
                  <td>{{ bot.memoryBytes ?? 0 }}</td>
                  <td class="actions">
                    <button type="button" @click="selectBot(bot.botId)">Notes</button>
                    <button type="button" class="danger" @click="despawnBot(bot)">Despawn</button>
                  </td>
                </tr>
                <tr v-if="!bots.length"><td colspan="12"><p class="empty">No bots currently spawned.</p></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="selectedBot" class="bot-detail">
          <header class="detail-head">
            <div>
              <span>BOT</span>
              <h3>{{ selectedBot.name || selectedBot.botId }}</h3>
            </div>
            <div class="actions">
              <button
                v-for="t in botTabs"
                :key="t.id"
                type="button"
                :class="{ active: botTab === t.id }"
                @click="botTab = t.id"
              >{{ t.label }}</button>
              <button type="button" @click="selectedBot = null; botNotes = {}">Close</button>
            </div>
          </header>

          <!-- Bot info bar -->
          <div class="facts">
            <span>Role <strong>{{ selectedBot.role || '-' }}</strong></span>
            <span>Faction <strong>{{ selectedBot.faction || '-' }}</strong></span>
            <span>Phase <strong>{{ selectedBot.phase || '-' }}</strong></span>
            <span>Round <strong>{{ selectedBot.round ?? '-' }}</strong></span>
            <span>Alive <strong>{{ selectedBot.alive === false ? 'No' : 'Yes' }}</strong></span>
            <span>Last <strong><code>{{ selectedBot.lastAction || '-' }}</code></strong></span>
            <span>Tokens <strong>{{ selectedBot.tokensUsed ?? 0 }} / {{ selectedBot.costCeiling ?? '?' }}</strong></span>
            <span>Memory <strong>{{ selectedBot.memoryBytes ?? 0 }} events</strong></span>
            <span>Connected <strong>{{ selectedBot.connected ? 'Yes' : 'No' }}</strong></span>
            <span>Winner <strong>{{ selectedBot.winner || '-' }}</strong></span>
          </div>

          <!-- Tab: Memory (phase summaries + current events) -->
          <section v-if="botTab === 'memory'" class="bot-tab-content">
            <h4>Phase Summaries <small>(long-term notes carried across rounds)</small></h4>
            <div class="scroll-list" style="max-height:200px">
              <p v-for="(val, key) in phaseSummaries" :key="key" class="mem-item">
                <span class="mem-meta">{{ key }}</span>
                <span class="mem-announce">{{ val }}</span>
              </p>
              <p v-if="Object.keys(phaseSummaries).length === 0" class="empty">No phase summaries stored yet.</p>
            </div>

            <h4 style="margin-top:14px">Current Events <small>(last {{ selectedBot.memoryBytes ?? 0 }} — cleared each phase)</small></h4>
            <div class="scroll-list">
              <p v-for="(item, i) in (selectedBot.shortTermMemory || [])" :key="i" class="mem-item">
                <span class="mem-meta">
                  <template v-if="item.round != null">R{{ item.round }} </template>
                  <template v-if="item.phase">{{ item.phase }} </template>
                  <template v-if="item.kind">· {{ item.kind }}</template>
                </span>
                <template v-if="item.kind === 'chat_message'">
                  <strong>{{ item.author || item.from }}:</strong> {{ item.text }}
                </template>
                <template v-else-if="item.kind === 'announcement'">
                  <span class="mem-announce">{{ item.title }}: {{ item.message }}</span>
                </template>
                <template v-else-if="item.kind === 'intel_return'">
                  <span class="mem-intel">Intel: {{ item.intelKind || item.type }}
                    <template v-if="item.message">— {{ item.message }}</template>
                  </span>
                </template>
                <template v-else>
                  <code>{{ JSON.stringify(item) }}</code>
                </template>
              </p>
              <p v-if="!selectedBot.shortTermMemory || selectedBot.shortTermMemory.length === 0" class="empty">No current events — phase just started or memory was flushed.</p>
            </div>
          </section>

          <!-- Tab: Actions -->
          <section v-if="botTab === 'actions'" class="bot-tab-content">
            <h4>Action Log <small>(last {{ (selectedBot.actionLog || []).length }} actions)</small></h4>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Time</th><th>Round</th><th>Phase</th><th>Kind</th><th>Details</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(entry, i) in (selectedBot.actionLog || []).slice().reverse()" :key="i">
                    <td>{{ formatDate(entry.ts) }}</td>
                    <td>{{ entry.round ?? '-' }}</td>
                    <td>{{ entry.phase || '-' }}</td>
                    <td><code>{{ entry.kind }}</code></td>
                    <td class="action-detail">
                      <template v-if="entry.kind === 'chat'">
                        <span v-if="entry.text">“{{ entry.text }}”</span>
                        <span v-else-if="entry.target">→ {{ entry.target }}</span>
                      </template>
                      <template v-else-if="entry.kind === 'vote'">
                        Vote → <strong>{{ entry.target || 'skip' }}</strong>
                      </template>
                      <template v-else-if="entry.kind === 'action'">
                        <strong>{{ entry.verb }}</strong>
                        <span v-if="entry.targetCode"> → {{ entry.targetCode }}</span>
                        <span v-if="entry.target"> ({{ entry.target }})</span>
                      </template>
                      <template v-else-if="entry.kind === 'rejected'">
                        <span class="mem-intel">{{ entry.reason }}</span>
                      </template>
                      <template v-else>
                        <code>{{ JSON.stringify(entry.action || entry) }}</code>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="!selectedBot.actionLog || selectedBot.actionLog.length === 0"><td colspan="5"><p class="empty">No actions recorded yet.</p></td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Tab: Notes (existing read/write) -->
          <section v-if="botTab === 'notes'" class="bot-tab-content bot-notes-panel">
            <div class="columns">
              <div>
                <h4>Read</h4>
                <pre>{{ pretty(botNotes) }}</pre>
                <button type="button" @click="loadBotNotes(selectedBot.botId)">Reload</button>
              </div>
              <div>
                <h4>Write</h4>
                <label>Key<input v-model="noteForm.key" type="text" placeholder="P-02-suspicion" /></label>
                <label>Value<input v-model="noteForm.value" type="text" placeholder="voted against me on Day 2" /></label>
                <button type="button" @click="saveBotNote">Save note</button>
              </div>
            </div>
          </section>

          <!-- Tab: Inspect (raw JSON) -->
          <section v-if="botTab === 'inspect'" class="bot-tab-content">
            <h4>Raw session data</h4>
            <pre>{{ pretty(selectedBot) }}</pre>
          </section>
        </section>
      </section>
    </section>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue';
import { pickBotName } from '../botNames.js';

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

const bots = ref([]);
const botsPolling = ref(false);
let botsPollTimer = null;
const loadingBots = ref(false);
const botError = ref('');
const spawnForm = ref({ conclaveCode:'', name:'', seatHint:null, costCeiling:50000, personaOverrides:'' });
const lastSpawnResult = ref(null);
const selectedBot = ref(null);
const botNotes = ref({});
const noteForm = ref({ key:'', value:'' });
const botTab = ref('memory');
const botTabs = [
  { id: 'memory', label: 'Memory' },
  { id: 'actions', label: 'Actions' },
  { id: 'notes', label: 'Notes' },
  { id: 'inspect', label: 'Inspect' }
];
const phaseSummaries = computed(() => {
  const notes = botNotes.value || {};
  return Object.fromEntries(
    Object.entries(notes).filter(([k]) => k.startsWith('phase-'))
  );
});

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
  if (botsPollTimer) { clearInterval(botsPollTimer); botsPollTimer = null; }
  botsPolling.value = false;
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

// ── Heresy Bots ──────────────────────────────────────────────────────────
// All bot endpoints are proxied through the heresy-server's
// /api/admin/bots/* routes — the browser only ever holds ADMIN_PASSWORD; the
// server forwards each call to the bot-manager's REST API with its own
// ADMIN_API_KEY. Persona overrides and per-game cost ceiling are sent in the
// spawn body per the locked v1.1.0 spec.
async function openBots() {
  tab.value = 'bots';
  if (!bots.value.length) await loadBots();
}
async function loadBots() {
  botError.value = '';
  loadingBots.value = true;
  try {
    bots.value = await adminFetch('/api/admin/bots');
  } catch (err) {
    botError.value = err.message;
  } finally {
    loadingBots.value = false;
  }
}
function toggleBotsPolling() {
  botsPolling.value = !botsPolling.value;
  if (botsPolling.value) {
    if (botsPollTimer) clearInterval(botsPollTimer);
    botsPollTimer = setInterval(loadBots, 3000);
  } else if (botsPollTimer) {
    clearInterval(botsPollTimer); botsPollTimer = null;
  }
}
async function spawnBot() {
  botError.value = '';
  loadingBots.value = true;
  try {
    const rawName = String(spawnForm.value.name || '').trim();
    const body = {
      conclaveCode: String(spawnForm.value.conclaveCode || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8),
      name: (rawName || pickBotName()).slice(0, 20),
      seatHint: spawnForm.value.seatHint != null && spawnForm.value.seatHint !== '' ? Number(spawnForm.value.seatHint) : null,
      costCeiling: Number(spawnForm.value.costCeiling) > 0 ? Number(spawnForm.value.costCeiling) : null,
      personaOverrides: spawnForm.value.personaOverrides || null
    };
    if (!body.conclaveCode) throw new Error('Conclave code is required');
    const data = await adminFetch('/api/admin/bots', { method: 'POST', body: JSON.stringify(body) });
    lastSpawnResult.value = data;
    await loadBots();
  } catch (err) {
    botError.value = err.message;
  } finally {
    loadingBots.value = false;
  }
}
async function despawnBot(bot) {
  if (!confirm(`Despawn bot ${bot.botId} (conclave ${bot.conclaveCode})?`)) return;
  botError.value = '';
  try {
    await adminFetch(`/api/admin/bots/${encodeURIComponent(bot.botId)}`, { method: 'DELETE' });
    if (selectedBot.value?.botId === bot.botId) selectedBot.value = null;
    await loadBots();
  } catch (err) {
    botError.value = err.message;
  }
}
async function selectBot(id) {
  botError.value = '';
  try {
    selectedBot.value = await adminFetch(`/api/admin/bots/${encodeURIComponent(id)}`);
    await loadBotNotes(id);
  } catch (err) {
    botError.value = err.message;
  }
}
async function loadBotNotes(id) {
  try {
    botNotes.value = await adminFetch(`/api/admin/bots/${encodeURIComponent(id)}/notes`);
  } catch (err) {
    botNotes.value = { error: err.message };
  }
}
async function saveBotNote() {
  if (!selectedBot.value || !noteForm.value.key) return;
  botError.value = '';
  try {
    await adminFetch(`/api/admin/bots/${encodeURIComponent(selectedBot.value.botId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ key: noteForm.value.key, value: noteForm.value.value })
    });
    noteForm.value = { key:'', value:'' };
    await loadBotNotes(selectedBot.value.botId);
  } catch (err) {
    botError.value = err.message;
  }
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
.admin-shell{min-height:100vh;background:#101312;color:#e7e3d5;padding:24px;font-family:Inter,system-ui,sans-serif}.login-panel,.control-room{max-width:1500px;margin:0 auto}.login-panel{width:min(440px,100%);margin-top:12vh;background:#171a16;border:1px solid #34372f;padding:28px}.login-panel span,.topbar span,.detail-head span{color:#b69a5c;font-size:11px;font-weight:800;letter-spacing:.16em}.login-panel h1,.topbar h1,.detail-head h2{margin:6px 0 18px;font-family:Cinzel,serif}.login-panel form{display:grid;gap:14px}label{display:grid;gap:7px;font-size:11px;font-weight:800;text-transform:uppercase;color:#aaa99d}input,select{background:#0d0f0d;border:1px solid #3a3c34;color:#e7e3d5;padding:9px;border-radius:2px}button{background:#8f7543;border:1px solid #b99c62;color:#0b0c0a;padding:9px 12px;text-transform:uppercase;font-size:10px;font-weight:800;letter-spacing:.1em;cursor:pointer}button.danger{background:#7a2a25;border-color:#a8463d;color:#fff}button:disabled{opacity:.5}.error{border:1px solid #70352f;background:#321916;color:#d99b95;padding:10px}.topbar,.detail-head,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.actions{justify-content:flex-end}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:20px 0}.metrics div,.detail,.logs,.cell-list button{background:#171a16;border:1px solid #34372f}.metrics div{padding:14px}.metrics span,.facts span{display:block;color:#8f9287;font-size:10px;text-transform:uppercase;letter-spacing:.12em}.metrics strong{display:block;margin-top:5px;font-size:24px}.tabs{display:flex;gap:8px;margin-bottom:14px}.tabs .active,.cell-list .selected{background:#2b271b;color:#dfc27c;border-color:#b69a5c}.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px}.cell-list{display:grid;align-content:start;gap:8px}.cell-list button{text-align:left;color:#e7e3d5;padding:14px}.cell-list strong,.cell-list span,.cell-list small{display:block}.cell-list span{margin-top:4px;color:#c8c0aa}.cell-list small{margin-top:5px;color:#8f9287}.detail,.logs{padding:18px;min-width:0}.facts{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.facts span{background:#0d0f0d;border:1px solid #2c3028;padding:10px}.facts strong{display:block;color:#e7e3d5;margin-top:4px;text-transform:none;letter-spacing:0}.table-wrap{overflow:auto;border:1px solid #34372f}table{width:100%;border-collapse:collapse;min-width:900px}th,td{border-bottom:1px solid #2c3028;padding:9px;text-align:left;vertical-align:top}th{color:#b69a5c;font-size:10px;text-transform:uppercase;letter-spacing:.12em;background:#11130f}td code{display:block;margin-top:4px;color:#8f9287;font-size:10px}.checks{display:grid;grid-template-columns:repeat(2,minmax(90px,1fr));gap:6px}.checks label{display:flex;align-items:center;gap:5px;text-transform:none;font-weight:600;letter-spacing:0}.checks input{width:auto}.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}pre,.scroll-list{max-height:360px;overflow:auto;background:#0b0d0b;border:1px solid #2c3028;color:#d9d7cc;padding:12px;font-size:12px;line-height:1.5}.scroll-list p{border-bottom:1px solid #252820;margin:0;padding:9px 0;white-space:pre-wrap}.scroll-list span{display:block;color:#8f9287;font-size:10px;margin-bottom:4px}.badge-passive{display:inline-block;background:#5a3e1f;color:#f0c674;border:1px solid #8f6d3a;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.badge-active{display:inline-block;background:#1f3a25;color:#74c68a;border:1px solid #3a6d4a;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.warning-banner{background:#3a2a0f;border:1px solid #8f6d3a;color:#f0c674;padding:10px;margin:10px 0;font-size:12px;border-radius:2px}.empty{color:#8f9287}.bot-detail{background:#171a16;border:1px solid #34372f;padding:18px;margin-top:14px}.bot-detail .facts{grid-template-columns:repeat(5,minmax(0,1fr))}.bot-tab-content h4{margin:0 0 10px;font-family:Cinzel,serif;color:#c8c0aa}.bot-tab-content h4 small{font-size:10px;color:#8f9287;font-weight:400}.mem-item{padding:7px 0;border-bottom:1px solid #252820;font-size:12px;line-height:1.5;white-space:pre-wrap}.mem-meta{display:block;color:#8f9287;font-size:10px;margin-bottom:3px}.mem-announce{color:#b69a5c}.mem-intel{color:#c67a5c}.action-detail{font-size:12px}.bot-notes-panel pre{max-height:200px}.bot-notes-panel .columns{gap:20px}@media(max-width:900px){.metrics,.facts,.columns,.layout{grid-template-columns:1fr}.topbar,.detail-head{align-items:flex-start;flex-direction:column}}
</style>
