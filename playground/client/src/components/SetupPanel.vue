<script setup>
// SetupPanel — presentational only. Builds the payloads App.vue needs to
// call the API; never calls the API itself. See App.vue's header comment
// for the contract this panel and RosterTable are held to.

import { ref, reactive, computed, watch } from 'vue';

const props = defineProps({
  roles: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  scenarios: { type: Array, default: () => [] },
  sessionId: { type: [String, Number], default: null },
});

const emit = defineEmits([
  'create',
  'save-scenario',
  'load-scenario',
  'snapshot',
  'rewind',
  'export-test',
]);

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 12;

// --- roster being assembled ---------------------------------------------

const playerCount = ref(8);
const names = reactive([]);
const rosterPicks = reactive([]);

function defaultName(seat) {
  return `P${seat + 1}`;
}

function resizeSeats(count) {
  const clamped = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.trunc(count) || MIN_PLAYERS));
  while (names.length < clamped) {
    names.push(defaultName(names.length));
    rosterPicks.push('');
  }
  while (names.length > clamped) {
    names.pop();
    rosterPicks.pop();
  }
  if (playerCount.value !== clamped) playerCount.value = clamped;
}

resizeSeats(playerCount.value);

watch(playerCount, (n) => resizeSeats(n));

const roleById = computed(() => {
  const map = {};
  for (const r of props.roles) map[r.id] = r;
  return map;
});

const loyalistRoles = computed(() => props.roles.filter((r) => r.faction === 'loyalist'));
const hereticRoles = computed(() => props.roles.filter((r) => r.faction === 'heretic'));

function nightVerb(role) {
  return role?.actions?.night?.kind ?? 'sleep';
}

const assignedCount = computed(() => rosterPicks.filter((id) => id).length);
const rosterComplete = computed(
  () => assignedCount.value === playerCount.value && rosterPicks.every((id) => id)
);

const rosterLoyalistCount = computed(
  () => rosterPicks.filter((id) => roleById.value[id]?.faction === 'loyalist').length
);
const rosterHereticCount = computed(
  () => rosterPicks.filter((id) => roleById.value[id]?.faction === 'heretic').length
);
const rosterImbalanced = computed(() => {
  if (assignedCount.value === 0) return false;
  return rosterHereticCount.value === 0 || rosterHereticCount.value >= rosterLoyalistCount.value;
});

// --- seed / options -------------------------------------------------

const seed = ref(1234);
const options = reactive({
  maxDrift: 20,
  deathReveal: 'alignment',
  anonymized: false,
  warpTaintVisible: false,
});

const canCreate = computed(() => !props.busy && rosterComplete.value);

function handleCreate() {
  if (!canCreate.value) return;
  emit('create', {
    players: names.map((name) => ({ name })),
    roster: [...rosterPicks],
    seed: Number(seed.value) || 0,
    options: { ...options },
  });
}

// --- scenarios --------------------------------------------------------

const selectedScenario = ref('');
const saveScenarioName = ref('');
const exportTestName = ref('');
const snapshotLabel = ref('');

const hasSession = computed(() => props.sessionId != null);

function handleLoad() {
  if (!selectedScenario.value) return;
  emit('load-scenario', selectedScenario.value);
}

function handleSave() {
  const name = saveScenarioName.value.trim();
  if (!name) return;
  emit('save-scenario', name);
  saveScenarioName.value = '';
}

function handleExportTest() {
  const name = exportTestName.value.trim();
  if (!name) return;
  emit('export-test', name);
  exportTestName.value = '';
}

function handleSnapshot() {
  emit('snapshot', snapshotLabel.value.trim());
}

function handleRewind() {
  emit('rewind');
}
</script>

<template>
  <div class="setup-panel">
    <h2>Setup</h2>

    <section class="setup-block">
      <h3>Roster</h3>
      <div class="setup-row">
        <label>
          Players
          <input
            type="number"
            class="num"
            :min="MIN_PLAYERS"
            :max="MAX_PLAYERS"
            v-model.number="playerCount"
            :disabled="busy"
          />
        </label>
        <span
          class="assign-count"
          :class="rosterComplete ? 'status-ok' : 'status-warn'"
        >{{ assignedCount }}/{{ playerCount }} roles assigned</span>
      </div>

      <table class="seat-table">
        <thead>
          <tr>
            <th>Seat</th>
            <th>Name</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(name, i) in names" :key="i">
            <td class="mono num">{{ i + 1 }}</td>
            <td>
              <input
                type="text"
                v-model.trim="names[i]"
                :disabled="busy"
              />
            </td>
            <td>
              <select v-model="rosterPicks[i]" :disabled="busy">
                <option value="">— choose role —</option>
                <optgroup label="Loyalist">
                  <option v-for="r in loyalistRoles" :key="r.id" :value="r.id">
                    {{ r.displayName }} · {{ r.tier }} · {{ nightVerb(r) }}
                  </option>
                </optgroup>
                <optgroup label="Heretic">
                  <option v-for="r in hereticRoles" :key="r.id" :value="r.id">
                    {{ r.displayName }} · {{ r.tier }} · {{ nightVerb(r) }}
                  </option>
                </optgroup>
              </select>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="faction-tally">
        <span>Loyalist: <strong class="num">{{ rosterLoyalistCount }}</strong></span>
        <span>Heretic: <strong class="num">{{ rosterHereticCount }}</strong></span>
        <span v-if="rosterImbalanced" class="status-warn">unbalanced split</span>
      </div>
    </section>

    <section class="setup-block">
      <h3>Seed &amp; options</h3>
      <div class="setup-grid">
        <label>
          Seed
          <input type="number" class="num" v-model.number="seed" :disabled="busy" />
        </label>
        <label>
          Max drift
          <input type="number" class="num" min="1" v-model.number="options.maxDrift" :disabled="busy" />
        </label>
        <label>
          Death reveal
          <select v-model="options.deathReveal" :disabled="busy">
            <option value="alignment">alignment</option>
            <option value="role">role</option>
          </select>
        </label>
        <label class="checkbox-row" title="Shuffles codenames for determinism-costing anonymity. Leave off to keep runs reproducible.">
          <input type="checkbox" v-model="options.anonymized" :disabled="busy" />
          Anonymized
          <span class="hint">(breaks determinism)</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" v-model="options.warpTaintVisible" :disabled="busy" />
          Warp taint visible
        </label>
      </div>

      <button type="button" class="create-button" :disabled="!canCreate" @click="handleCreate">
        Create session
      </button>
    </section>

    <section class="setup-block">
      <h3>Scenarios</h3>
      <div class="setup-row">
        <select v-model="selectedScenario" :disabled="busy">
          <option value="">— select scenario —</option>
          <option v-for="s in scenarios" :key="s.name" :value="s.name">
            {{ s.name }} ({{ s.playerCount }}p{{ s.savedAt ? ' · ' + s.savedAt : '' }})
          </option>
        </select>
        <button type="button" :disabled="busy || !hasSession || !selectedScenario" @click="handleLoad">
          Load
        </button>
      </div>
      <div class="setup-row">
        <input
          type="text"
          placeholder="scenario name"
          v-model.trim="saveScenarioName"
          :disabled="busy || !hasSession"
        />
        <button type="button" :disabled="busy || !hasSession || !saveScenarioName.trim()" @click="handleSave">
          Save
        </button>
      </div>
      <div class="setup-row">
        <input
          type="text"
          placeholder="test file name"
          v-model.trim="exportTestName"
          :disabled="busy || !hasSession"
        />
        <button type="button" :disabled="busy || !hasSession || !exportTestName.trim()" @click="handleExportTest">
          Export as test
        </button>
      </div>
    </section>

    <section class="setup-block">
      <h3>Snapshot</h3>
      <div class="setup-row">
        <input
          type="text"
          placeholder="label (optional)"
          v-model.trim="snapshotLabel"
          :disabled="busy || !hasSession"
        />
        <button type="button" :disabled="busy || !hasSession" @click="handleSnapshot">
          Snapshot
        </button>
        <button type="button" :disabled="busy || !hasSession" @click="handleRewind">
          Rewind
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.setup-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.setup-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.setup-block h3 {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-dim);
}

.setup-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.setup-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 0.75rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 11px;
  color: var(--text-dim);
}

label input,
label select {
  width: 100%;
}

.checkbox-row {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}

.checkbox-row input {
  width: auto;
}

.hint {
  color: var(--text-faint);
  font-style: italic;
}

.seat-table {
  font-size: 11px;
}

.seat-table input[type='text'] {
  width: 100%;
}

.seat-table select {
  width: 100%;
}

.assign-count {
  font-size: 11px;
}

.faction-tally {
  display: flex;
  gap: 1rem;
  font-size: 11px;
  color: var(--text-dim);
}

.create-button {
  align-self: flex-start;
  background: var(--accent-dim);
  border-color: var(--accent);
  font-weight: 600;
}

.create-button:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg);
}
</style>
