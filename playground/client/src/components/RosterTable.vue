<script setup>
// RosterTable — the state editor. Presentational only: every edit emits
// update-player/update-game with just the changed key(s); App.vue calls
// the API and re-fetches. Never assume a local edit "stuck" — always
// re-render from props, since the server clamps drift/crippleTier and
// hands back the clamped row.

import { computed, reactive } from 'vue';

const props = defineProps({
  players: { type: Array, default: () => [] },
  roles: { type: Array, default: () => [] },
  game: { type: Object, default: null },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['update-player', 'update-game']);

function updatePlayer(playerCode, key, value) {
  emit('update-player', { playerCode, updates: { [key]: value } });
}

function updateGame(key, value) {
  emit('update-game', { updates: { [key]: value } });
}

// --- drift zones ---------------------------------------------------------
// Fixed boundaries at maxDrift=20 are green 0-4 / yellow 5-9 / orange
// 10-14 / red 15-19 / black 20. maxDrift is configurable per session, so
// scale the boundaries proportionally rather than hardcoding 20 — this
// keeps the same 5-band shape without breaking when maxDrift differs.
function driftZone(drift, maxDrift) {
  const m = Number(maxDrift) > 0 ? Number(maxDrift) : 20;
  const d = Number(drift) || 0;
  if (d <= Math.floor(m * 0.2)) return 'green';
  if (d <= Math.floor(m * 0.45)) return 'yellow';
  if (d <= Math.floor(m * 0.7)) return 'orange';
  if (d <= Math.floor(m * 0.95)) return 'red';
  return 'black';
}

function driftClass(drift, maxDrift) {
  return `drift-${driftZone(drift, maxDrift)}`;
}

const roleIds = computed(() => props.roles.map((r) => r.id));

function roleName(id) {
  return props.roles.find((r) => r.id === id)?.displayName ?? id;
}

const playerCodes = computed(() => props.players.map((p) => p.playerCode));

// full playerCode -> shortCode, for the <select> options below (patient_zero,
// possessed_by) that list every player by code — those options must keep
// the full code as their `value` (that's what's sent to the API) but can
// show the short form as their label.
function shortFor(playerCode) {
  return props.players.find((p) => p.playerCode === playerCode)?.shortCode ?? playerCode;
}

// --- generic input handlers ------------------------------------------

function onTextChange(playerCode, key, event) {
  updatePlayer(playerCode, key, event.target.value);
}

function onNumberChange(playerCode, key, event) {
  const v = event.target.value;
  updatePlayer(playerCode, key, v === '' ? null : Number(v));
}

function onCheckboxChange(playerCode, key, event) {
  updatePlayer(playerCode, key, event.target.checked);
}

function onSelectChange(playerCode, key, event) {
  const v = event.target.value;
  updatePlayer(playerCode, key, v === '' ? null : v);
}

function onGameText(key, event) {
  const v = event.target.value;
  updateGame(key, v === '' ? null : v);
}

function onGameNumber(key, event) {
  const v = event.target.value;
  updateGame(key, v === '' ? null : Number(v));
}

function onGameCheckbox(key, event) {
  updateGame(key, event.target.checked);
}

function onGameSelect(key, event) {
  updateGame(key, event.target.value);
}

// --- per-player flags disclosure -----------------------------------------
//
// Each player has 8 flag fields (tortured_before, mark_public, possessed_by,
// possession_revealed, plague_carrier, tier1_until_round, skip_next_night,
// death_cause). Cramming all of them into a single narrow table cell — the
// last column of the roster — used to render the expanded <details> with
// every input/select squeezed to the cell's intrinsic width, producing a
// layout that was hard to read and hard to click. Now each "flags" toggle
// expands a SECOND <tr> with colspan over the entire table, so the fields
// lay out in a comfortable grid across the full board width.
const openFlags = reactive({});
function toggleFlags(playerCode) {
  openFlags[playerCode] = !openFlags[playerCode];
}
const COL_COUNT = 8; // Code, Name, Role, Faction, Drift, Alive, Cripple, Flags
</script>

<template>
  <div class="roster-table">
    <section v-if="game" class="game-editor">
      <h2>Game state</h2>
      <div class="gamestate-grid">
        <label class="prominent">
          Phase
          <select :value="game.phase" :disabled="busy" @change="onGameSelect('phase', $event)">
            <option value="lobby">lobby</option>
            <option value="day">day</option>
            <option value="night">night</option>
            <option value="ended">ended</option>
          </select>
        </label>
        <label class="prominent">
          Round
          <input
            type="number"
            class="num"
            min="0"
            :value="game.round"
            :disabled="busy"
            @change="onGameNumber('round', $event)"
          />
        </label>
        <label>
          Day stage
          <input
            type="text"
            :value="game.dayStage ?? ''"
            :disabled="busy"
            placeholder="(none)"
            @change="onGameText('dayStage', $event)"
          />
        </label>
        <label>
          Max drift
          <input
            type="number"
            class="num"
            min="1"
            :value="game.maxDrift"
            :disabled="busy"
            @change="onGameNumber('maxDrift', $event)"
          />
        </label>
        <label>
          Death reveal
          <select :value="game.deathReveal" :disabled="busy" @change="onGameSelect('deathReveal', $event)">
            <option value="alignment">alignment</option>
            <option value="role">role</option>
          </select>
        </label>
        <label>
          Patient zero
          <select
            :value="game.patient_zero ?? ''"
            :disabled="busy"
            @change="onGameSelect('patient_zero', $event)"
          >
            <option value="">(none)</option>
            <option v-for="code in playerCodes" :key="code" :value="code">{{ shortFor(code) }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="players-editor">
      <h2>Roster</h2>
      <table class="players-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Role</th>
            <th>Faction</th>
            <th>Drift</th>
            <th>Alive</th>
            <th>Cripple</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="p in players" :key="p.playerCode">
            <tr :class="{ 'row-dead': !p.alive }">
              <td class="mono" :title="p.playerCode">{{ p.shortCode ?? p.playerCode }}</td>
              <td>{{ p.name }}<span v-if="p.isBot" class="bot-tag">bot</span></td>
              <td>
                <select
                  :value="p.role"
                  :disabled="busy"
                  @change="onSelectChange(p.playerCode, 'role', $event)"
                >
                  <option value="">(none)</option>
                  <option v-for="id in roleIds" :key="id" :value="id">{{ roleName(id) }}</option>
                </select>
              </td>
              <td>
                <select
                  :value="p.faction"
                  :class="p.faction === 'heretic' ? 'status-bad' : 'status-ok'"
                  :disabled="busy"
                  @change="onSelectChange(p.playerCode, 'faction', $event)"
                >
                  <option value="loyalist">loyalist</option>
                  <option value="heretic">heretic</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  class="num drift-input"
                  :class="driftClass(p.drift, game?.maxDrift)"
                  min="0"
                  :max="game?.maxDrift ?? 20"
                  :value="p.drift"
                  :disabled="busy"
                  @change="onNumberChange(p.playerCode, 'drift', $event)"
                />
              </td>
              <td>
                <label class="alive-toggle">
                  <input
                    type="checkbox"
                    :checked="p.alive"
                    :disabled="busy"
                    @change="onCheckboxChange(p.playerCode, 'alive', $event)"
                  />
                  <span :class="p.alive ? 'status-ok' : 'status-bad'">{{ p.alive ? 'alive' : 'dead' }}</span>
                </label>
              </td>
              <td>
                <input
                  type="number"
                  class="num"
                  min="0"
                  max="3"
                  :value="p.crippleTier"
                  :disabled="busy"
                  @change="onNumberChange(p.playerCode, 'crippleTier', $event)"
                />
              </td>
              <td>
                <button
                  type="button"
                  class="flags-toggle"
                  :class="{ 'flags-toggle--open': openFlags[p.playerCode] }"
                  :disabled="busy"
                  @click="toggleFlags(p.playerCode)"
                >
                  {{ openFlags[p.playerCode] ? '▾ flags' : '▸ flags' }}
                </button>
              </td>
            </tr>
            <tr v-if="openFlags[p.playerCode]" class="flags-row">
              <td :colspan="COL_COUNT" class="flags-cell">
                <div class="flags-body">
                  <label class="checkbox-row">
                    <input
                      type="checkbox"
                      :checked="p.tortured_before"
                      :disabled="busy"
                      @change="onCheckboxChange(p.playerCode, 'tortured_before', $event)"
                    />
                    tortured_before
                  </label>
                  <label class="checkbox-row">
                    <input
                      type="checkbox"
                      :checked="p.mark_public"
                      :disabled="busy"
                      @change="onCheckboxChange(p.playerCode, 'mark_public', $event)"
                    />
                    mark_public
                  </label>
                  <label>
                    possessed_by
                    <select
                      :value="p.possessed_by ?? ''"
                      :disabled="busy"
                      @change="onSelectChange(p.playerCode, 'possessed_by', $event)"
                    >
                      <option value="">(none)</option>
                      <option v-for="code in playerCodes" :key="code" :value="code">{{ shortFor(code) }}</option>
                    </select>
                  </label>
                  <label class="checkbox-row">
                    <input
                      type="checkbox"
                      :checked="p.possession_revealed"
                      :disabled="busy"
                      @change="onCheckboxChange(p.playerCode, 'possession_revealed', $event)"
                    />
                    possession_revealed
                  </label>
                  <label class="checkbox-row">
                    <input
                      type="checkbox"
                      :checked="p.plague_carrier"
                      :disabled="busy"
                      @change="onCheckboxChange(p.playerCode, 'plague_carrier', $event)"
                    />
                    plague_carrier
                  </label>
                  <label>
                    tier1_until_round
                    <input
                      type="number"
                      class="num"
                      min="0"
                      :value="p.tier1_until_round ?? ''"
                      :disabled="busy"
                      @change="onNumberChange(p.playerCode, 'tier1_until_round', $event)"
                    />
                  </label>
                  <label class="checkbox-row">
                    <input
                      type="checkbox"
                      :checked="p.skip_next_night"
                      :disabled="busy"
                      @change="onCheckboxChange(p.playerCode, 'skip_next_night', $event)"
                    />
                    skip_next_night
                  </label>
                  <label>
                    death_cause
                    <input
                      type="text"
                      :value="p.death_cause ?? ''"
                      :disabled="busy"
                      placeholder="(none)"
                      @change="onTextChange(p.playerCode, 'death_cause', $event)"
                    />
                  </label>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.roster-table {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

/* NOTE: do not name this (or any playground class) something as generic as
   the old `.game-grid` — heresy-client's OWN global style.css defines a
   `.game-grid` for the live game's roster/orders/chat layout (height:
   calc(100vh - 201px), min-height: 560px, dark background). Vue's scoped
   styles only raise this rule's own specificity; they don't stop that
   unscoped global rule from ALSO matching the same class name when this
   component is embedded at /playground, and since that rule sets height/
   min-height/background that this rule never declared, those properties
   applied completely unopposed — swelling this small field grid to fill
   nearly the whole viewport. Cross-checked against every class this repo's
   playground components define; `game-grid` was the only collision. */
.gamestate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.5rem 0.6rem;
}

.gamestate-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 11px;
  color: var(--text-dim);
}

.gamestate-grid label.prominent {
  font-weight: 700;
  color: var(--text);
}

.gamestate-grid label.prominent select,
.gamestate-grid label.prominent input {
  font-size: 14px;
  font-weight: 700;
}

.checkbox-row {
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
}

.checkbox-row input {
  width: auto;
}

.players-table {
  font-size: 11px;
}

.players-table select,
.players-table input[type='number'] {
  width: 100%;
  min-width: 4.5em;
}

.row-dead {
  opacity: 0.55;
}

.bot-tag {
  margin-left: 0.35rem;
  font-size: 9px;
  text-transform: uppercase;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0 0.25rem;
}

.drift-input {
  width: 4.5em;
}

.drift-green {
  color: var(--ok);
}

.drift-yellow {
  color: var(--warn);
}

.drift-orange {
  color: color-mix(in srgb, var(--warn) 55%, var(--bad) 45%);
}

.drift-red {
  color: var(--bad);
}

.drift-black {
  color: var(--bad);
  font-weight: 700;
}

.alive-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-direction: row;
  font-size: 11px;
}

.alive-toggle input {
  width: auto;
}

.flags-toggle {
  font-size: 10px;
  padding: 0.2rem 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-dim);
}

.flags-toggle--open {
  color: var(--accent);
  border-color: var(--accent);
}

.flags-row > .flags-cell {
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  padding: 0.6rem 0.8rem;
  /* The expanded row spans the full table width (colspan=8), so the
     auto-fit grid below has room to lay the 8 flag fields out in 3-4
     comfortable columns rather than stacking them into a narrow strip. */
}

.flags-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.4rem 0.8rem;
}

.flags-body label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 10px;
  color: var(--text-dim);
  min-width: 0;
}

.flags-body label.checkbox-row {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}

.flags-body label.checkbox-row input {
  width: auto;
  flex: none;
}

.flags-body input[type='text'],
.flags-body input[type='number'],
.flags-body select {
  width: 100%;
  min-width: 0;
}
</style>
