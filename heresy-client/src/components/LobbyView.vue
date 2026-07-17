<template>
  <section class="lobby page">
    <div class="section-heading"><div><span class="eyebrow">ASSEMBLY IN PROGRESS</span><h1>The conclave gathers</h1><p>Share conclave code <strong>{{ game.code }}</strong>. The host begins when every operative is ready.</p></div><button class="ghost" @click="$emit('leave')">Leave conclave</button></div>
    <div class="lobby-grid">
      <article class="panel roster-card"><header><h2>Operatives</h2><span>{{ players.length }}/12</span></header><ul class="lobby-players"><li v-for="p in players" :key="p.playerCode"><span class="avatar">{{ initial(p.name) }}</span><div><strong>{{ p.name }}</strong><small>{{ p.isHost ? 'Conclave commander' : p.connected === false ? 'Disconnected' : 'Awaiting orders' }}</small></div><span class="ready" :class="{yes:p.ready}">{{ p.ready?'READY':'NOT READY' }}</span></li></ul><p v-if="players.length<5" class="notice">At least five operatives are required.</p></article>
      <article class="panel setup-card"><header><h2>Operation parameters</h2><span>{{ game.mode==='async'?'ASYNC':'LIVE' }}</span></header>
        <div class="preset"><strong>{{ players.length }}-operative conclave</strong><p>Roles are assigned only after launch and revealed privately via dossier. The roster is sealed.</p></div>
        <label>Maximum Drift<input v-model.number="setup.maxDrift" type="number" min="1" max="100" :disabled="!isHost"></label>
        <label>Day phase (minutes)<input v-model.number="dayMinutes" type="number" min="1" max="1440" :disabled="!isHost"></label>
        <label>Night phase (minutes)<input v-model.number="nightMinutes" type="number" min="1" max="1440" :disabled="!isHost"></label>
        <button v-if="isHost" class="secondary wide" @click="$emit('configure',{...setup})">Use these parameters</button>
      </article>
      <article v-if="isHost" class="panel composition-card">
        <header><h2>Composition</h2><span :class="compositionValid ? 'ok' : 'warn'">{{ compositionValid ? 'Valid' : `${serverErrors.length || localErrors.length} issue(s)` }}</span></header>
        <div class="composition-mode">
          <button :class="{selected: compositionMode==='preset'}" @click="setCompositionMode('preset')">Preset</button>
          <button :class="{selected: compositionMode==='custom'}" @click="setCompositionMode('custom')">Custom</button>
        </div>
        <div v-if="compositionMode==='preset'" class="preset-picker">
          <label v-for="n in presetCounts" :key="n" class="preset-option" :class="{selected: presetCount===n}">
            <input type="radio" :value="n" v-model="presetCount" :disabled="!isHost" />
            <span><strong>{{ n }}p</strong><small>{{ presetFlavor[n] }}</small></span>
          </label>
        </div>
        <div v-if="compositionMode==='custom'" class="custom-picker">
          <p class="picker-hint">Build a roster of exactly {{ players.length }} roles. Roles are shuffled randomly at start.</p>
          <div v-for="faction in ['loyalist','heretic']" :key="faction" class="faction-group">
            <h3>{{ faction === 'loyalist' ? 'Loyalist' : 'Heretic' }}</h3>
            <ul>
              <li v-for="r in rolesByFaction[faction]" :key="r.id" class="role-row">
                <span class="role-name">{{ r.displayName }}</span>
                <span class="role-count">
                  <button class="count-btn" @click="removeRole(r.id)" :disabled="!isHost || (customRoster.match(new RegExp(r.id.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&'),'g'))||[]).length===0">-</button>
                  <span>{{ countInRoster(r.id) }}</span>
                  <button class="count-btn" @click="addRole(r.id)" :disabled="!isHost || rosterFull">+</button>
                </span>
              </li>
            </ul>
          </div>
          <p class="roster-length" :class="{ok: customRoster.length===playerCount, warn: customRoster.length!==playerCount}">Roster: {{ customRoster.length }} / {{ playerCount }}</p>
        </div>
        <div v-if="serverErrors.length" class="validation-errors">
          <p v-for="e in serverErrors" :key="'s-'+e.rule" :class="'err-'+e.kind">{{ e.message }}</p>
        </div>
        <div v-if="compositionMode==='custom' && localWarnings.length && !serverErrors.length" class="validation-warnings">
          <p v-for="w in localWarnings" :key="'w-'+w.rule" class="warn-soft">{{ w.message }}</p>
          <button class="ghost small" @click="acknowledgeAllWarnings">Acknowledge all &amp; proceed</button>
        </div>
      </article>
    </div>
    <div class="lobby-actions"><button class="secondary" :class="{selected:me?.ready}" :disabled="busy" @click="$emit('ready')">{{ me?.ready?'Stand down':'Mark ready' }}</button><button v-if="isHost" class="primary" :disabled="!canStart||busy||!compositionValid" @click="emitStart">Seal the chamber</button><span v-else>Waiting for the conclave commander.</span></div>
  </section>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { validateComposition } from '../server-composition-validator.js';
import { validRoles, hardRules, presetFlavor } from '../compositionData.js';

const props = defineProps({ game: { type: Object, required: true }, me: Object, busy: Boolean, compositionErrors: { type: Array, default: () => [] } });
const emit = defineEmits(['ready', 'start', 'configure', 'leave', 'clear-errors']);

const players = computed(() => props.game.players || []);
const isHost = computed(() => props.me?.isHost);
const playerCount = computed(() => players.value.length);
const canStart = computed(() => playerCount.value >= 5 && players.value.every(p => p.ready));
const presetCounts = [5, 6, 7, 8, 9, 10, 11, 12];

const setup = reactive({ maxDrift: 20, dayMs: 300000, nightMs: 120000 });
watch(() => props.game.maxDrift, v => { if (v) setup.maxDrift = v; }, { immediate: true });
watch(() => props.game.dayMs, v => { if (v) setup.dayMs = v; }, { immediate: true });
watch(() => props.game.nightMs, v => { if (v) setup.nightMs = v; }, { immediate: true });
const dayMinutes = computed({ get: () => Math.round(setup.dayMs / 60000), set: v => { const n = Math.round(Number(v) || 0); if (n >= 1) setup.dayMs = n * 60000; } });
const nightMinutes = computed({ get: () => Math.round(setup.nightMs / 60000), set: v => { const n = Math.round(Number(v) || 0); if (n >= 1) setup.nightMs = n * 60000; } });

const compositionMode = ref('preset');
const presetCount = ref(5);
const customRoster = ref([]);
const confirmedWarnings = ref([]);

watch(playerCount, (n) => { presetCount.value = n; }, { immediate: true });
watch(compositionMode, () => { confirmedWarnings.value = []; emit('clear-errors'); });

const rolesByFaction = computed(() => {
  const loy = [], her = [];
  for (const [, r] of validRoles) {
    if (r.faction === 'loyalist') loy.push(r);
    else her.push(r);
  }
  return { loyalist: loy, heretic: her };
});

function countInRoster(id) {
  return customRoster.value.filter(x => x === id).length;
}
const rosterFull = computed(() => customRoster.value.length >= playerCount.value);

function addRole(id) {
  if (customRoster.value.length < playerCount.value) customRoster.value.push(id);
}
function removeRole(id) {
  const idx = customRoster.value.indexOf(id);
  if (idx !== -1) customRoster.value.splice(idx, 1);
}

function setCompositionMode(mode) {
  compositionMode.value = mode;
  if (mode === 'preset') customRoster.value = [];
  else customRoster.value = [];
}

const localValidation = computed(() => {
  if (compositionMode.value === 'preset') return { ok: true, errors: [], warnings: [] };
  return validateComposition({
    roster: customRoster.value,
    playerCount: playerCount.value,
    confirmedWarnings: confirmedWarnings.value,
    validRoles,
    hardRules,
    source: 'custom'
  });
});
const localErrors = computed(() => localValidation.value.errors.filter(e => e.kind === 'hard'));
const localWarnings = computed(() => localValidation.value.warnings);
const serverErrors = computed(() => props.compositionErrors);

const compositionValid = computed(() => {
  if (compositionMode.value === 'preset') return presetCounts.includes(presetCount.value);
  return localValidation.value.ok && serverErrors.value.length === 0;
});

function acknowledgeAllWarnings() {
  confirmedWarnings.value = localWarnings.value.map(w => w.rule);
}

function emitStart() {
  if (compositionMode.value === 'preset') {
    emit('start', { source: 'preset', presetId: presetCount.value + 'p' });
  } else {
    emit('start', { source: 'custom', roster: [...customRoster.value], confirmedWarnings: [...confirmedWarnings.value] });
  }
}

function initial(name) { return (name || '?').charAt(0).toUpperCase(); }
</script>
