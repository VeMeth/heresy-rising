<script setup>
// Presentational only. Never calls the API — every mutation is emitted
// upward to App.vue, which calls the server and re-feeds this component
// fresh `players`/`actions` props. See App.vue's header comment.
//
// `roles` MUST be the rewritten roleDefinitions() output from the server
// (GET /api/roles), never raw game_data/roles-40k.json — the engine
// renames watch/shield/booby-trap/sermon to drift-hint/bodyguard/
// boobytrap/(corrupt-)sermon at load time and this panel reads `kind`
// directly off that prop.

import { computed, reactive } from 'vue';

const props = defineProps({
  players: { type: Array, default: () => [] },
  roles: { type: Array, default: () => [] },
  game: { type: Object, default: null },
  actions: { type: Array, default: () => [] },
  // actorCode -> {kind, targetCode, at} for submissions the engine acknowledged
  // with `silent:true`. Sourced from the submitAction response in App.vue.
  silentDrops: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['submit-action', 'retract-action']);

const roleMap = computed(() => new Map((props.roles || []).map(r => [r.id, r])));
const livingPlayers = computed(() => (props.players || []).filter(p => p.alive));
const heretics = computed(() => livingPlayers.value.filter(p => p.faction === 'heretic'));

const phase = computed(() => props.game?.phase ?? null);
const isNight = computed(() => phase.value === 'night');
const isDay = computed(() => phase.value === 'day');

function roleOf(p) {
  return roleMap.value.get(p.role) ?? null;
}

function nightActionOf(p) {
  return roleOf(p)?.actions?.night ?? null;
}

function dayActionOf(p) {
  return roleOf(p)?.actions?.day ?? null;
}

function hasNightAction(p) {
  const a = nightActionOf(p);
  return !!a && a.kind !== 'sleep';
}

// Target filtering per the role's actions.night.target ('self' | 'other' |
// 'any' | 'hostile'). 'hostile' compares the ACTOR's current faction
// (player.faction, which can differ from the role's default faction, e.g.
// a possessed/turned player) against each candidate's current faction —
// never the static role-sheet faction.
function targetOptions(actor, mode) {
  const living = livingPlayers.value;
  switch (mode) {
    case 'self':
      return living.filter(p => p.code === actor.code);
    case 'other':
      return living.filter(p => p.code !== actor.code);
    case 'hostile':
      return living.filter(p => p.code !== actor.code && p.faction !== actor.faction);
    case 'any':
    default:
      return living;
  }
}

function currentAction(p) {
  return (props.actions || []).find(a => a.actorCode === p.code) ?? null;
}

function nameFor(code) {
  const p = (props.players || []).find(x => x.code === code);
  return p ? `${p.name} (${p.shortCode ?? p.code})` : code;
}

function describeAction(p, action) {
  if (action.faction) {
    return `blood-ritual → ${nameFor(action.targetCode)}`;
  }
  const kind = isNight.value ? nightActionOf(p)?.kind : dayActionOf(p)?.kind;
  const parts = [kind ?? '?', '→', nameFor(action.targetCode)];
  if (action.variant) parts.push(`[${action.variant}]`);
  return parts.join(' ');
}

// --- per-row draft form state (submission inputs, not the submitted state
// itself — that lives in `actions` and is rendered read-only above) -------

const forms = reactive({});
function formFor(code) {
  if (!forms[code]) forms[code] = { targetCode: '', variant: '', dataText: '' };
  return forms[code];
}

const brForms = reactive({});
function brFormFor(code) {
  if (!brForms[code]) brForms[code] = { targetCode: '' };
  return brForms[code];
}

const forgeForms = reactive({});
function forgeFormFor(code) {
  if (!forgeForms[code]) forgeForms[code] = { targetCode: '', body: '' };
  return forgeForms[code];
}

// --- silent-drop detection ------------------------------------------------
//
// When a crippled actor submits protect/bodyguard/drift-hint/warp-read, the
// engine returns `{kind, targetCode, silent:true}` and writes NO hr_actions row
// (heresyGameManager.js:1210). The submission looks accepted and produces no
// tell — by design, so torture damage can't be probed by watching for an error.
//
// At resolve time this is byte-identical to a genuine sleep, so the trace can
// only ever call it `derived-input`. This ack is the single moment it is
// directly observable, so App.vue keeps the response keyed by actor and passes
// it down as `silentDrops`. That makes the badge below an OBSERVED fact rather
// than the hedge an "action list stayed empty" heuristic would give us — the
// latter cannot distinguish a silent drop from any other rejection.
const silentFlags = computed(() => props.silentDrops || {});

// --- emit helpers ----------------------------------------------------------

function submitRoleAction(p) {
  const action = nightActionOf(p);
  if (!action) return;
  const f = formFor(p.code);
  if (!f.targetCode) return;
  const payload = { actorCode: p.code, targetCode: f.targetCode };
  if (action.variants && action.variants.length) payload.variant = f.variant || undefined;
  if (['drift-hint', 'bodyguard'].includes(action.kind) && f.dataText) {
    try {
      payload.data = JSON.parse(f.dataText);
    } catch {
      payload.data = f.dataText;
    }
  }
  emit('submit-action', payload);
}

function submitBloodRitual(p) {
  const f = brFormFor(p.code);
  if (!f.targetCode) return;
  emit('submit-action', { actorCode: p.code, targetCode: f.targetCode, faction: true });
}

function submitForgery(p) {
  const f = forgeFormFor(p.code);
  if (!f.targetCode) return;
  emit('submit-action', {
    actorCode: p.code,
    targetCode: f.targetCode,
    data: { body: f.body || '' },
  });
}

function retract(p) {
  emit('retract-action', { actorCode: p.code });
}

const bloodRitualClaim = computed(() => (props.actions || []).find(a => a.faction) ?? null);
</script>

<template>
  <div class="action-panel">
    <h2>Actions — {{ phase ?? 'no session' }}</h2>

    <p v-if="!livingPlayers.length" class="empty-hint">No living players.</p>

    <table v-else class="action-table">
      <thead>
        <tr>
          <th>Seat</th>
          <th>Role</th>
          <th>Faction</th>
          <th class="num">Drift</th>
          <th>Action</th>
          <th>Submitted</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in livingPlayers" :key="p.code">
          <td class="mono" :title="p.code">
            {{ p.shortCode ?? p.code }}
            <span v-if="p.crippleTier" class="status-warn"> T{{ p.crippleTier }}</span>
          </td>
          <td>{{ roleOf(p)?.displayName ?? p.role ?? '—' }}</td>
          <td>{{ p.faction }}</td>
          <td class="num tabular-nums">{{ p.drift }}</td>

          <!-- Action controls: night phase -->
          <td v-if="isNight">
            <template v-if="hasNightAction(p)">
              <div class="row-controls">
                <span class="mono verb">{{ nightActionOf(p).kind }}</span>
                <select v-model="formFor(p.code).targetCode" :disabled="busy">
                  <option value="" disabled>target…</option>
                  <option
                    v-for="t in targetOptions(p, nightActionOf(p).target)"
                    :key="t.code"
                    :value="t.code"
                  >
                    {{ t.name }} ({{ t.shortCode ?? t.code }})
                  </option>
                </select>
                <select
                  v-if="nightActionOf(p).variants && nightActionOf(p).variants.length"
                  v-model="formFor(p.code).variant"
                  :disabled="busy"
                >
                  <option value="" disabled>variant…</option>
                  <option v-for="v in nightActionOf(p).variants" :key="v" :value="v">{{ v }}</option>
                </select>
                <input
                  v-if="['drift-hint', 'bodyguard'].includes(nightActionOf(p).kind)"
                  v-model="formFor(p.code).dataText"
                  :disabled="busy"
                  class="mono data-input"
                  placeholder="data (optional JSON)"
                />
                <button
                  type="button"
                  :disabled="busy || !formFor(p.code).targetCode"
                  @click="submitRoleAction(p)"
                >
                  Submit
                </button>
              </div>
            </template>
            <span v-else class="empty-hint">no night action</span>
          </td>

          <!-- Action controls: day phase -->
          <td v-else-if="isDay">
            <template v-if="dayActionOf(p)?.kind === 'forgery'">
              <div class="row-controls">
                <span class="mono verb">forgery</span>
                <select v-model="forgeFormFor(p.code).targetCode" :disabled="busy">
                  <option value="" disabled>impersonate…</option>
                  <option v-for="t in livingPlayers" :key="t.code" :value="t.code">
                    {{ t.name }} ({{ t.shortCode ?? t.code }})
                  </option>
                </select>
                <input
                  v-model="forgeFormFor(p.code).body"
                  :disabled="busy"
                  class="data-input"
                  placeholder="forged message"
                />
                <button
                  type="button"
                  :disabled="busy || !forgeFormFor(p.code).targetCode"
                  @click="submitForgery(p)"
                >
                  Submit
                </button>
              </div>
            </template>
            <span v-else class="empty-hint">no day action</span>
          </td>

          <td v-else class="empty-hint">n/a — phase {{ phase ?? '?' }}</td>

          <!-- Currently submitted -->
          <td>
            <span v-if="currentAction(p)" class="mono">{{ describeAction(p, currentAction(p)) }}</span>
            <span v-else class="empty-hint">none</span>
            <div v-if="silentFlags[p.code]" class="status-warn silent-note">
              ⚠ silently dropped — engine accepted this
              <span class="mono">{{ silentFlags[p.code].kind }}</span>
              but wrote no action (torture damage). It will resolve as a sleep.
            </div>
          </td>

          <td>
            <button
              v-if="currentAction(p)"
              type="button"
              :disabled="busy"
              @click="retract(p)"
            >
              Retract
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="isNight && heretics.length" class="blood-ritual">
      <h2>Blood Ritual</h2>
      <p class="empty-hint">
        Faction action, one claim per night across all Heretics — the server rejects a
        second submission rather than replacing the first.
        <span v-if="bloodRitualClaim">
          Currently claimed by <span class="mono" :title="bloodRitualClaim.actorCode">{{ nameFor(bloodRitualClaim.actorCode) }}</span> →
          {{ nameFor(bloodRitualClaim.targetCode) }}.
        </span>
        <span v-else>Unclaimed tonight.</span>
      </p>
      <div v-for="p in heretics" :key="p.code" class="row-controls br-row">
        <span class="mono" :title="p.code">{{ p.shortCode ?? p.code }}</span>
        <span>{{ p.name }}</span>
        <select v-model="brFormFor(p.code).targetCode" :disabled="busy">
          <option value="" disabled>target…</option>
          <option v-for="t in targetOptions(p, 'hostile')" :key="t.code" :value="t.code">
            {{ t.name }} ({{ t.shortCode ?? t.code }})
          </option>
        </select>
        <button
          type="button"
          :disabled="busy || !brFormFor(p.code).targetCode"
          @click="submitBloodRitual(p)"
        >
          Claim Blood Ritual
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.action-table th,
.action-table td {
  vertical-align: top;
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.verb {
  color: var(--text-dim);
}

.data-input {
  width: 10rem;
}

.silent-note {
  font-size: 11px;
  margin-top: 0.15rem;
  max-width: 22rem;
  white-space: normal;
}

.blood-ritual {
  margin-top: 0.75rem;
}

.br-row {
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border-soft);
}
</style>
