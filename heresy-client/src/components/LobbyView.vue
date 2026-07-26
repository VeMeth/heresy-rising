<template>
  <section class="lobby page">
    <div class="section-heading">
      <div>
        <span class="eyebrow">ASSEMBLY IN PROGRESS</span>
        <h1>The conclave gathers</h1>
        <p>Share conclave code <strong>{{ game.code }}</strong>. The host begins when every operative is ready.</p>
      </div>
      <button class="ghost" @click="$emit('leave')">Leave conclave</button>
    </div>
    <div class="lobby-grid">
      <section class="panel chat-panel chat-cell">
        <header><h2>Lobby vox</h2><span>{{ messages.length }} transmission{{ messages.length===1?'':'s' }}</span></header>
        <button v-if="messages.length && hasMore" class="load-history" @click="$emit('history', messages[0]?.id)">Load earlier transmissions</button>
        <div ref="feed" class="message-feed">
          <div v-if="!messages.length" class="empty-chat">
            <strong>No transmissions recorded</strong>
            <p>Be the first to break the silence.</p>
          </div>
          <article v-for="m in messages" :key="m.id || (m.createdAt + '-' + m.author)" :class="['message',{system:m.kind==='system',vote:m.kind==='vote'}]">
            <span v-if="m.kind==='system'" class="system-line">{{ m.body }}</span>
            <template v-else>
              <span class="avatar mini">{{ initial(m.author) }}</span>
              <div>
                <header><strong>{{ m.author }}</strong><time>{{ formatTime(m.createdAt) }}</time></header>
                <p>{{ m.body }}</p>
              </div>
            </template>
          </article>
        </div>
        <form class="composer" @submit.prevent="post">
          <textarea ref="composer" v-model.trim="draft" maxlength="1000" rows="2"
                    placeholder="Address the conclave… (Enter to send, Shift+Enter for newline)"
                    @keydown.enter.exact.prevent="post"></textarea>
          <button class="primary" :disabled="!draft || busy">Transmit</button>
        </form>
      </section>

      <article class="panel roster-card ops-cell">
        <header><h2>Operatives</h2>
          <span v-if="liveMode">{{ onlineCount }}/{{ players.length }} online</span>
          <span v-else>{{ players.length }}/12</span>
        </header>
        <ul class="lobby-players compact">
          <li v-for="p in players" :key="p.playerCode" :class="{offline:liveMode && !p.connected}">
            <span class="avatar">{{ initial(p.name) }}</span>
            <div><strong>{{ p.name }}</strong><small>{{ p.isHost ? 'Commander' : (liveMode && p.connected === false) ? 'Vox lost' : (p.ready ? 'Ready' : 'Awaiting') }}</small></div>
            <i v-if="liveMode" class="presence" :class="{online:p.connected}" :title="p.connected ? 'Online' : 'Disconnected'"></i>
            <span class="ready" :class="{yes:p.ready}">{{ p.ready?'READY':'…' }}</span>
            <span class="kick-slot">
              <button v-if="isHost && !p.isHost" class="kick-btn" :title="'Remove ' + p.name" :aria-label="'Remove ' + p.name" @click="confirmKick(p)">×</button>
            </span>
          </li>
        </ul>
        <p v-if="players.length<5" class="notice">At least five operatives are required.</p>
        <button class="secondary wide ready-in-ops" :class="{selected:me?.ready}" :disabled="busy" @click="$emit('ready')">{{ me?.ready?'Stand down':'Mark ready' }}</button>
      </article>

      <article class="panel setup-card params-cell">
        <header><h2>Operation parameters</h2><span>{{ game.mode==='async'?'ASYNC':'LIVE' }}</span></header>
        <div class="params-row">
          <div class="preset"><strong>{{ players.length }}-operative conclave</strong><p>Sealed at launch; revealed privately per dossier.</p></div>
          <div v-if="isHost" class="param-fields">
            <label>Drift<input v-model.number="setup.maxDrift" type="number" min="1" max="100"></label>
            <label>Day min<input v-model.number="dayMinutes" type="number" min="1" max="1440"></label>
            <label>Night min<input v-model.number="nightMinutes" type="number" min="1" max="1440"></label>
            <button class="secondary" @click="$emit('configure',{...setup})">Use parameters</button>
          </div>
          <dl v-else class="param-readonly">
            <div><dt>Drift</dt><dd>{{ setup.maxDrift }}</dd></div>
            <div><dt>Day</dt><dd>{{ dayMinutes }} min</dd></div>
            <div><dt>Night</dt><dd>{{ nightMinutes }} min</dd></div>
          </dl>
        </div>
      </article>
    </div>

    <article class="panel full-row composition-card">
      <header>
        <h2>Conclave composition</h2>
        <span v-if="isHost" :class="compositionValid ? 'ok' : 'warn'">
          {{ compositionValid ? 'Valid' : headcountMismatch ? 'Awaiting operatives' : `${[...serverErrors, ...localErrors].length} issue(s)` }}
        </span>
      </header>

      <!-- Host-only picker -->
      <template v-if="isHost">
        <div class="composition-mode">
          <button :class="{selected: compositionMode==='preset'}" @click="setCompositionMode('preset')">Preset doctrine</button>
          <button :class="{selected: compositionMode==='custom'}" @click="setCompositionMode('custom')">Custom roster</button>
        </div>

        <p v-if="compositionMode==='preset'" class="picker-hint">
          Presets are designer-balanced doctrines. The exact role spread is sealed — only the operative count and flavour are visible here. The chamber will reject any preset whose size differs from the present operative count.
        </p>
        <p v-else class="picker-hint">
          Build a roster of exactly <strong>{{ targetPlayerCount }}</strong> roles. Non-citizen roles may appear only once; Imperial Citizens fill the remainder. Roles are shuffled randomly across seats at launch. Soft warnings flag imbalance and must be acknowledged before the chamber can be sealed.
        </p>

        <!-- PRESET MODE -->
        <div v-if="compositionMode==='preset'" class="preset-picker">
          <label v-for="n in presetCounts" :key="n" class="preset-option"
                 :class="{selected: presetCount===n, mismatched: n!==playerCount}">
            <input type="radio" :value="n" v-model="presetCount" :disabled="!isHost" />
            <span>
              <strong>{{ n }}p</strong>
              <small>{{ presetFlavor[n] }}</small>
              <em v-if="n!==playerCount" class="mismatch-note">{{ n > playerCount ? 'too large for this roster' : 'too small for this roster' }}</em>
            </span>
          </label>
          <p class="preset-current">
            Selected: <strong>{{ presetCount }}p</strong> doctrine.
            <span v-if="presetCount===playerCount" class="ok">Matches {{ playerCount }} operatives.</span>
            <span v-else class="warn">Does not match {{ playerCount }} operatives — the chamber will reject it.</span>
          </p>
        </div>

        <!-- CUSTOM MODE -->
        <div v-else class="custom-picker">
          <div class="target-size-picker">
            <label>Design for
              <span class="stepper">
                <button type="button" class="ghost small" @click="setTargetPlayerCount(targetPlayerCount-1)" :disabled="targetPlayerCount<=5">−</button>
                <strong>{{ targetPlayerCount }}</strong>
                <button type="button" class="ghost small" @click="setTargetPlayerCount(targetPlayerCount+1)" :disabled="targetPlayerCount>=12">+</button>
              </span>
              operatives
            </label>
            <p v-if="targetPlayerCount!==playerCount" class="target-mismatch-note">
              {{ playerCount }} joined so far.
              <template v-if="targetPlayerCount>playerCount">Drafting ahead — the chamber needs {{ targetPlayerCount }} operatives seated before it can seal with this roster.</template>
              <template v-else>Add roles or raise the target to match everyone present.</template>
            </p>
          </div>
          <div class="composition-summary">
            <div class="summary-stat"><span>Roster</span><strong :class="rosterLengthClass">{{ customRoster.length }} / {{ targetPlayerCount }}</strong></div>
            <div class="summary-stat"><span>Loyalists</span><strong class="loy">{{ factionCounts.loyalist }}</strong></div>
            <div class="summary-stat"><span>Heretics</span>
              <strong :class="{her: true, bad: factionCounts.heretic > loyalistAligned}">{{ factionCounts.heretic }}</strong>
            </div>
            <div class="summary-stat"><span>Citizens</span><strong>{{ factionCounts.citizen }}</strong></div>
            <p class="parity-note" :class="{bad: factionCounts.heretic > loyalistAligned}">
              Parity win rule: Heretics must be ≤ Loyalists at launch.
              <span v-if="factionCounts.heretic > loyalistAligned">Currently violated — add Loyalists or remove Heretics.</span>
            </p>
          </div>

          <div class="faction-columns">
            <div v-for="faction in ['loyalist','heretic']" :key="faction" class="faction-group">
              <h3>{{ faction === 'loyalist' ? 'Loyalist choir' : 'Heretic cabal' }}
                <small>{{ factionCounts[faction] }} in roster</small>
              </h3>
              <ul>
                <li v-for="r in rolesByFaction[faction]" :key="r.id" class="role-row" :class="{selected: countInRoster(r.id)>0}">
                  <div class="role-head">
                    <span class="role-name">
                      {{ r.displayName }}
                      <em class="tier">{{ r.tier }}</em>
                    </span>
                    <span class="role-count">
                      <button class="count-btn" @click="removeRole(r.id)"
                              :disabled="countInRoster(r.id)===0" aria-label="Remove">−</button>
                      <span class="count-display">{{ countInRoster(r.id) }}</span>
                      <button class="count-btn" @click="addRole(r.id)"
                              :disabled="!canAdd(r.id)" :title="addDisabledReason(r.id)" aria-label="Add">+</button>
                    </span>
                    <button class="role-toggle" @click="toggleRole(r.id)"
                            :aria-expanded="expandedRole===r.id">{{ expandedRole===r.id ? 'less' : 'more' }}</button>
                  </div>
                  <div v-if="expandedRole===r.id" class="role-detail">
                    <p><span>Claim:</span> {{ r.claim }}</p>
                    <p><span>Ability:</span> {{ r.ability }}</p>
                    <p v-if="roleThresholds[r.id]" class="threshold-note">
                      Threshold: {{ roleThresholds[r.id].label }}
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <div class="roster-preview">
            <h4>Current roster ({{ customRoster.length }}/{{ targetPlayerCount }})</h4>
            <ul v-if="customRoster.length" class="roster-chips">
              <li v-for="(id, i) in customRoster" :key="id + '-' + i" class="roster-chip"
                  :class="roleFaction(id)" @click="removeRoleAt(i)" :title="'Remove ' + roleDisplay(id)">
                {{ roleDisplay(id) }}<span aria-hidden="true">×</span>
              </li>
            </ul>
            <p v-else class="empty-roster">No roles selected yet. Add roles above.</p>
            <div class="roster-actions">
              <button class="ghost small" @click="clearRoster" :disabled="!customRoster.length">Clear roster</button>
              <button class="ghost small" @click="seedMinimalRoster" :disabled="rosterFull">Seed minimal legal roster</button>
            </div>
          </div>
        </div>

        <!-- Validation feedback -->
        <div v-if="serverErrors.length" class="validation-errors">
          <p class="validation-heading">The chamber rejected the seal:</p>
          <p v-for="e in serverErrors" :key="'s-'+e.rule" :class="'err-'+e.kind">{{ e.message }}</p>
        </div>
        <div v-if="compositionMode==='custom' && (localWarnings.length || softUnacked.length) && !serverErrors.length" class="validation-warnings">
          <p class="validation-heading" v-if="localWarnings.length">Soft warnings — acknowledge to proceed:</p>
          <p v-for="w in localWarnings" :key="'w-'+w.rule" class="warn-soft"
             :class="{acked: confirmedWarnings.includes(w.rule)}">
            <span class="ack-mark">{{ confirmedWarnings.includes(w.rule) ? '✓' : '○' }}</span>
            {{ w.message }}
          </p>
          <button class="ghost small" @click="acknowledgeAllWarnings"
                  :disabled="localWarnings.length>0 && confirmedWarnings.length>=localWarnings.length">
            Acknowledge all &amp; proceed
          </button>
        </div>

        <!-- Private balance-check preview -->
        <div class="sim-panel">
          <header class="sim-panel-head">
            <h3>Test this setup</h3>
            <p class="sim-hint">Runs private simulated games against the roster above before you seal the chamber. Only you see the results.</p>
          </header>
          <div class="sim-controls">
            <label class="sim-games-field">Games
              <input type="number" v-model.number="simGames" min="1" max="100" :disabled="simBusy">
            </label>
            <button class="secondary" :disabled="simBusy || simIsSameSetup || simOnCooldown || !rosterShapeValid" @click="runSimulation">
              <template v-if="simBusy">Simulating…</template>
              <template v-else-if="simIsSameSetup">Change the setup to test again</template>
              <template v-else-if="simOnCooldown">Try again in {{ simCooldownRemaining }}s</template>
              <template v-else>Run balance check</template>
            </button>
          </div>
          <p v-if="simError" class="sim-error">{{ simError }}</p>
          <SimResultsPanel v-if="simResult" :result="simResult" />
        </div>
      </template>

      <!-- Non-host read-only summary -->
      <template v-else>
        <p class="nonhost-note">
          The conclave commander is composing the doctrine.
          Players will receive their private role dossier once the chamber is sealed.
        </p>
      </template>
    </article>

    <div class="lobby-actions">
      <button v-if="isHost" class="primary" :disabled="!canStart||busy||!compositionValid" @click="emitStart">Seal the chamber</button>
      <span v-else>Waiting for the conclave commander.</span>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { validateComposition } from '../server-composition-validator.js';
import { validRoles, hardRules, presetFlavor, roleThresholds } from '../compositionData.js';
import { socket, ensureConnected, getPlayerCode } from '../socket.js';
import SimResultsPanel from './SimResultsPanel.vue';

const props = defineProps({
  game: { type: Object, required: true },
  me: Object,
  busy: Boolean,
  compositionErrors: { type: Array, default: () => [] },
  messages: { type: Array, default: () => [] },
  channel: { type: String, default: 'public' },
  hasMore: { type: Boolean, default: true },
});
const emit = defineEmits(['ready', 'start', 'configure', 'leave', 'clear-errors', 'send', 'channel-change', 'history', 'kick']);

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
const expandedRole = ref(null);

// Custom mode lets the host DRAFT a roster sized for more (or fewer)
// operatives than have actually joined so far — e.g. planning/simulating a
// 10p doctrine while only 5 people are in the lobby. targetPlayerCount is
// the size the host is CURRENTLY DESIGNING FOR; playerCount (above) stays
// the real, live headcount and is what actually gates "Seal the chamber"
// (via compositionValid below) — the two are deliberately decoupled.
const targetPlayerCount = ref(playerCount.value);
function setTargetPlayerCount(n) {
  targetPlayerCount.value = Math.max(5, Math.min(12, Math.round(Number(n) || playerCount.value)));
}
watch(playerCount, (n) => {
  presetCount.value = n;
  // Real headcount grew past the current draft target — bump up (never
  // down) so the target is never smaller than reality, which would make
  // "Seal the chamber" impossible to ever satisfy without the host noticing.
  if (n > targetPlayerCount.value) targetPlayerCount.value = n;
}, { immediate: true });
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
const rosterFull = computed(() => customRoster.value.length >= targetPlayerCount.value);

const factionCounts = computed(() => {
  let loyalist = 0, heretic = 0, citizen = 0;
  for (const id of customRoster.value) {
    const r = validRoles.get(id);
    if (!r) continue;
    if (id === 'imperial-citizen') citizen++;
    else if (r.faction === 'heretic') heretic++;
    else loyalist++;
  }
  return { loyalist, heretic, citizen };
});
// H4 parity (Heretics <= Loyalists) counts Imperial Citizens as
// Loyalist-aligned server-side (validateComposition, shared with the
// server) — factionCounts.loyalist alone excludes them, so any
// heretic/loyalist comparison for the parity indicator needs this instead.
const loyalistAligned = computed(() => factionCounts.value.loyalist + factionCounts.value.citizen);

function canAdd(id) {
  const role = validRoles.get(id);
  if (!role) return false;
  if (rosterFull.value) return false;
  // H2 — non-citizen roles are unique per game.
  if (id !== 'imperial-citizen' && countInRoster(id) >= 1) return false;
  // H4 (parity: Heretics <= Loyalists) is deliberately NOT enforced here.
  // A mid-construction snapshot check blocked adding the FIRST Heretic
  // outright (0 Loyalists so far means any heretic add "exceeds" them) —
  // it also compared against factionCounts.loyalist, which excludes
  // Imperial Citizens, while the real H4 rule (validateComposition, shared
  // with the server) counts Citizens as Loyalist-aligned. Both made it
  // wrongly stricter than the actual rule, and only for an in-progress
  // roster the host hasn't finished building yet. Parity is still fully
  // enforced — just by the existing live summary (the Heretics stat turns
  // red / the parity-note warns) and by compositionValid/rosterShapeValid,
  // which block "Seal the chamber" and "Run balance check" on a roster
  // that's ACTUALLY unbalanced once the host is done editing it.
  return true;
}

function addDisabledReason(id) {
  if (rosterFull.value) return 'Roster is full';
  const role = validRoles.get(id);
  if (!role) return '';
  if (id !== 'imperial-citizen' && countInRoster(id) >= 1) return 'Non-citizen roles are unique per game';
  return '';
}

function addRole(id) {
  if (!canAdd(id)) return;
  customRoster.value.push(id);
}
function removeRole(id) {
  const idx = customRoster.value.indexOf(id);
  if (idx !== -1) customRoster.value.splice(idx, 1);
}
function removeRoleAt(i) {
  customRoster.value.splice(i, 1);
}
function clearRoster() {
  customRoster.value = [];
  confirmedWarnings.value = [];
}
function toggleRole(id) {
  expandedRole.value = expandedRole.value === id ? null : id;
}
function roleDisplay(id) { return validRoles.get(id)?.displayName || id; }
function roleFaction(id) {
  const r = validRoles.get(id);
  return r ? r.faction : '';
}

// Seed a guaranteed-legal minimal roster: one Heretic (Murderer), one
// Loyalist (Interrogator) to satisfy H5, then fill the rest with Imperial
// Citizens. H4 holds (heretic 1 ≤ loyalist N-1 ≥ 4). The host then iterates
// from there. We deliberately do NOT duplicate the locked preset table from
// data/composition.json here, to avoid leaking the doctrine roster into the
// client bundle.
function seedMinimalRoster() {
  const n = targetPlayerCount.value;
  if (n < 5) return;
  const base = ['murderer', 'interrogator'];
  while (base.length < n) base.push('imperial-citizen');
  customRoster.value = base;
  confirmedWarnings.value = [];
}

function setCompositionMode(mode) {
  if (compositionMode.value === mode) return;
  compositionMode.value = mode;
  // Preserve the in-progress custom roster across mode switches; only reset
  // acknowledgement state (handled by the compositionMode watch above).
}

const localValidation = computed(() => {
  if (compositionMode.value === 'preset') return { ok: true, errors: [], warnings: [] };
  return validateComposition({
    roster: customRoster.value,
    playerCount: targetPlayerCount.value,
    confirmedWarnings: confirmedWarnings.value,
    validRoles,
    hardRules,
    source: 'custom'
  });
});
const localErrors = computed(() => localValidation.value.errors.filter(e => e.kind === 'hard' || e.kind === 'soft_unacknowledged'));
const softUnacked = computed(() => localValidation.value.errors.filter(e => e.kind === 'soft_unacknowledged'));
const localWarnings = computed(() => localValidation.value.warnings);
const serverErrors = computed(() => props.compositionErrors);

// Stale ack IDs in `confirmedWarnings` are harmless: the validator only
// checks `confirmedWarnings.includes(w.rule)` against the *current*
// warning set, and ack marks iterate current `localWarnings`. So we do
// NOT prune on every localWarnings change — that would recompute
// localValidation (fresh warnings array ref each time) and mutate
// confirmedWarnings (fresh array ref), forming an infinite reactivity
// loop that hangs the tab. Acknowledgements simply grow the set; clearing
// the roster or reseeding resets it explicitly.

// Roster is internally self-consistent for whatever size it's currently
// drafted/selected for — independent of whether that matches who's actually
// in the lobby right now. Gates the sim/balance-check preview, which is
// exactly the "let the host play around" path: drafting and simulating a
// bigger doctrine ahead of real headcount should never be blocked.
const rosterShapeValid = computed(() => {
  if (compositionMode.value === 'preset') return presetCounts.includes(presetCount.value);
  return localValidation.value.ok;
});

// True when the roster is otherwise perfectly valid (for its drafted size)
// but just doesn't match who's actually here yet — distinct from a real
// roster-shape problem, so the header badge doesn't claim "0 issues" while
// still being unable to seal.
const headcountMismatch = computed(() => compositionMode.value === 'custom' && localValidation.value.ok && serverErrors.value.length === 0 && customRoster.value.length !== playerCount.value);

// Gates "Seal the chamber" — unlike rosterShapeValid, this ALSO requires the
// draft to match the real, live headcount, since the engine will reject a
// roster whose length doesn't equal the actual joined player count.
const compositionValid = computed(() => {
  if (compositionMode.value === 'preset') {
    return presetCounts.includes(presetCount.value) && presetCount.value === playerCount.value;
  }
  return localValidation.value.ok && serverErrors.value.length === 0 && customRoster.value.length === playerCount.value;
});

const rosterLengthClass = computed(() => customRoster.value.length === targetPlayerCount.value ? 'ok' : 'warn');

function acknowledgeAllWarnings() {
  confirmedWarnings.value = Array.from(new Set([...confirmedWarnings.value, ...localWarnings.value.map(w => w.rule)]));
}

function buildCompositionPayload() {
  if (compositionMode.value === 'preset') {
    return { source: 'preset', presetId: presetCount.value + 'p' };
  }
  return { source: 'custom', roster: [...customRoster.value], confirmedWarnings: [...confirmedWarnings.value] };
}

function emitStart() {
  emit('start', buildCompositionPayload());
}

// ── Host-only "test this setup" balance check ────────────────────────────
// Runs the CURRENT composition state (same object emitStart() would submit)
// against heresy-sim via the game:simulate socket event. This is a private
// preview for the host only — it is never broadcast to other lobby members
// or written into shared game state. We talk to the socket directly here
// (rather than via App.vue's shared `command()`/global `busy`) so a
// multi-second simulation run doesn't freeze chat/ready controls for
// everyone in the lobby, and with a longer ack timeout since 100 games can
// take a while.
const simGames = ref(50);
const simBusy = ref(false);
const simResult = ref(null);
const simError = ref('');
const simCooldownRemaining = ref(0);
const simOnCooldown = computed(() => simCooldownRemaining.value > 0);
let simCooldownDeadline = 0;
let simCooldownTimer = null;

// Mirrors heresy-server's simCompositionKey() so the button can tell the
// host "this exact setup was already run" without waiting on a round trip.
function simCompositionKey(composition) {
  if (!composition || typeof composition !== 'object') return '';
  if (composition.source === 'preset') return `preset:${composition.presetId}`;
  if (composition.source === 'custom' && Array.isArray(composition.roster)) return `custom:${[...composition.roster].sort().join(',')}`;
  return JSON.stringify(composition);
}
const lastSimulatedKey = ref(null);
const simIsSameSetup = computed(() => lastSimulatedKey.value !== null && simCompositionKey(buildCompositionPayload()) === lastSimulatedKey.value);

function startSimCooldown(seconds) {
  simCooldownDeadline = Date.now() + seconds * 1000;
  simCooldownRemaining.value = seconds;
  if (simCooldownTimer) clearInterval(simCooldownTimer);
  simCooldownTimer = setInterval(() => {
    const remaining = Math.ceil((simCooldownDeadline - Date.now()) / 1000);
    if (remaining <= 0) {
      simCooldownRemaining.value = 0;
      clearInterval(simCooldownTimer);
      simCooldownTimer = null;
    } else {
      simCooldownRemaining.value = remaining;
    }
  }, 1000);
}

function emitSimulate(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not answer in time.')), timeoutMs);
    socket.emit('game:simulate', payload, (ack) => {
      clearTimeout(timer);
      if (!ack || ack.ok === false) {
        reject(new Error(ack?.error || 'Simulation failed.'));
        return;
      }
      resolve(ack.result);
    });
  });
}

async function runSimulation() {
  if (simBusy.value || simIsSameSetup.value || simOnCooldown.value) return;
  simError.value = '';
  simBusy.value = true;
  try {
    await ensureConnected();
    const games = Math.min(100, Math.max(1, Math.round(Number(simGames.value) || 50)));
    const composition = buildCompositionPayload();
    const result = await emitSimulate({
      code: props.game.code,
      composition,
      games,
      playerCode: getPlayerCode(),
    });
    simResult.value = result;
    lastSimulatedKey.value = simCompositionKey(composition);
    startSimCooldown(60);
  } catch (e) {
    simError.value = e.message || 'Simulation failed.';
  } finally {
    simBusy.value = false;
  }
}

onUnmounted(() => {
  if (simCooldownTimer) clearInterval(simCooldownTimer);
});

function initial(name) { return (name || '?').charAt(0).toUpperCase(); }
const liveMode = computed(() => props.game.mode !== 'async');
const onlineCount = computed(() => liveMode.value ? players.value.filter(p => p.connected).length : 0);
function confirmKick(p) {
  if (!p || p.isHost) return;
  if (!confirm(`Remove ${p.name} from this conclave?`)) return;
  emit('kick', p.playerCode);
}

// Lobby chat
const draft = ref('');
const composer = ref(null);
const feed = ref(null);
let preChangeHeight = 0;
let preChangeScrollTop = 0;
// Capture scroll metrics BEFORE the next render so we can anchor the view
// when older messages get prepended: shift scrollTop by the amount of new
// content so the same content stays visible at the same offset.
watch(() => props.messages.length, () => {
  const el = feed.value;
  if (el) {
    preChangeHeight = el.scrollHeight;
    preChangeScrollTop = el.scrollTop;
  }
});
// After the DOM updates, decide whether to anchor (prepend) or follow
// (append): if the user was near the bottom, treat as append and snap to
// the new bottom; otherwise treat as prepend and preserve their position.
watch(() => props.messages, () => nextTick(() => {
  const el = feed.value;
  if (!el) return;
  const heightDelta = el.scrollHeight - preChangeHeight;
  const wasNearBottom = preChangeHeight - preChangeScrollTop - el.clientHeight < 80;
  if (wasNearBottom) {
    el.scrollTop = el.scrollHeight;
  } else if (heightDelta > 0) {
    el.scrollTop = preChangeScrollTop + heightDelta;
  }
}), { deep: false });
function post() {
  if (!draft.value || props.busy) return;
  emit('send', draft.value);
  draft.value = '';
  // Keep the cursor in the textarea so the player can immediately type
  // the next message. Vue updates the v-model synchronously, but a few
  // browsers can move focus during the same tick when adjacent nodes
  // re-render; nextTick + a tiny restore guarantees we stay where the
  // player expects to be.
  nextTick(() => { composer.value?.focus(); });
}
function formatTime(t) { return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }
</script>

<style scoped>
/* Lobby layout (wide screens — uses the side gutter that was empty):
   ┌─────────┬──────────────┬──────────┐
   │ Params  │  Chat (big)  │  Ops     │
   │ (rail)  │              │          │
   └─────────┴──────────────┴──────────┘
   Below 1300px there isn't room for a rail, so it drops back to a
   row under chat/ops; below 900px everything stacks in one column. */
.lobby.page { max-width: 1500px; }
:deep(.lobby-grid) {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 320px;
  grid-template-areas: "params chat ops";
  gap: 22px;
  align-items: start;
}
:deep(.chat-cell) {
  grid-area: chat;
  height: clamp(480px, 64vh, 680px);
  min-height: 0;
  align-self: start;
  display: flex;
  flex-direction: column;
}
:deep(.ops-cell)  { grid-area: ops; }
:deep(.params-cell){ grid-area: params; }

@media (max-width: 1300px) {
  :deep(.lobby-grid) {
    grid-template-columns: minmax(0, 1fr) 320px;
    grid-template-areas: "chat ops" "params params";
  }
}

@media (max-width: 900px) {
  :deep(.lobby-grid) {
    grid-template-columns: 1fr;
    grid-template-areas: "chat" "ops" "params";
  }
  :deep(.chat-cell) { height: clamp(360px, 60vh, 520px); }
}

.params-cell > header { flex-wrap: wrap; row-gap: 6px; }
.params-cell h2 { font-size: 15px; }
.params-cell .params-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px 20px 20px;
  flex-wrap: wrap;
}
.params-cell .preset { flex: 1 1 260px; min-width: 0; }
.params-cell .preset p { font-size: 11px; }
.params-cell .param-fields {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.params-cell .param-fields label {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin: 0;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: .1em;
  color: var(--muted);
  white-space: nowrap;
}
.params-cell .param-fields input {
  width: 64px;
  padding: 8px 10px;
  font-size: 13px;
  text-align: center;
}
.params-cell .param-fields button {
  padding: 9px 14px;
  font-size: 9.5px;
  height: 34px;
  align-self: flex-end;
}

/* In the wide-screen sidebar the column is too narrow for the fields
   to wrap side by side (as they do in the row layout below 1300px),
   so each label/input pair drops onto its own line — align them into
   a column instead of letting inputs land wherever their own label's
   text width happens to end. */
@media (min-width: 1301px) {
  .params-cell .param-fields {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .params-cell .param-fields label {
    justify-content: space-between;
    width: 100%;
  }
  .params-cell .param-fields input { width: 80px; }
  .params-cell .param-fields button { width: 100%; align-self: stretch; }
  .params-cell .param-readonly {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .params-cell .param-readonly > div {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .params-cell .param-readonly dd { min-width: 80px; }
}
.params-cell .param-readonly {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  flex-wrap: wrap;
  margin: 0;
  padding: 0;
}
.params-cell .param-readonly > div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}
.params-cell .param-readonly dt {
  margin: 0;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: .1em;
  color: var(--muted);
}
.params-cell .param-readonly dd {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  min-width: 64px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 4px;
  color: var(--pale);
}

.chat-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: hidden; }
.chat-panel > header { display:flex; align-items:center; justify-content:space-between; flex: 0 0 auto; }
.chat-panel .message-feed { flex: 1 1 0; min-height: 0; overflow-y: auto; }
.chat-panel .composer { flex: 0 0 auto; }
.chat-panel .composer textarea { resize: none; }

.ops-cell .lobby-players.compact li { padding: 10px 0; }
.ops-cell .lobby-players.compact .avatar { flex: 0 0 32px; height: 32px; font-size:12px; }
.ops-cell .lobby-players.compact small { font-size: 9px; }
.ops-cell .ready { font-size: 9px; padding: 2px 7px; }
.ops-cell .lobby-players.compact li.offline .avatar,
.ops-cell .lobby-players.compact li.offline strong,
.ops-cell .lobby-players.compact li.offline small { opacity: .5; }
.ops-cell .presence {
  flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%;
  background: #5b5e55; margin-right: 4px;
}
.ops-cell .presence.online { background: #71905e; box-shadow: 0 0 5px #71905e; }
.ops-cell .kick-slot { flex: 0 0 26px; display: flex; align-items: center; justify-content: center; }
.ops-cell .kick-btn {
  width: 22px; height: 22px; padding: 0;
  background: transparent; border: 1px solid #43463d; color: var(--muted);
  font: 700 14px Inter; line-height: 1; border-radius: 2px; cursor: pointer;
}
.ops-cell .kick-btn:hover:not(:disabled) { border-color: #c46a5d; color: #e2b3ac; background: #1d1413; }
.ops-cell .kick-btn:disabled { opacity: .3; cursor: not-allowed; }
.ops-cell .ready-in-ops { margin: 14px 18px 0; width: calc(100% - 36px); }
.ops-cell .ready-in-ops.selected { border-color: #71905e; color: #c2d9b3; background: #1f2c1c; }

.avatar.mini { flex: 0 0 30px; height: 30px; font-size: 12px; }
.composition-card { margin-top: 18px; padding: 22px 26px 28px; }
.composition-card header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.composition-card header h2 { font:700 19px Cinzel; letter-spacing:.05em; margin:0; }
.composition-card header .ok { color:#9fbf8a; }
.composition-card header .warn { color:#d58c75; }

.composition-mode { display:flex; gap:10px; margin-bottom:14px; }
.composition-mode button {
  flex:1; background:#171916; border:1px solid #43463d; color:#b7b6aa;
  padding:11px 14px; text-transform:uppercase; letter-spacing:.1em; font-weight:700; font-size:10px;
  cursor:pointer; border-radius:2px;
}
.composition-mode button.selected { border-color:var(--gold); color:var(--gold2); background:#1d1b13; }

.picker-hint { color:var(--muted); font-size:12.5px; line-height:1.6; margin:0 0 16px; max-width:760px; }
.picker-hint strong { color:var(--pale); }

.preset-picker { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px; margin-bottom:6px; }
.preset-option {
  display:flex; align-items:flex-start; gap:9px; padding:11px 12px; border:1px solid #34372f;
  background:#0d0f0d; border-radius:2px; cursor:pointer; margin:0;
}
.preset-option.selected { border-color:var(--gold); background:#1d1b13; }
.preset-option.mismatched { opacity:.6; }
.preset-option input { flex:0 0 auto; margin-top:3px; }
.preset-option span { display:flex; flex-direction:column; gap:3px; }
.preset-option strong { font-size:13px; letter-spacing:.04em; }
.preset-option small { color:var(--muted); font-size:11px; text-transform:none; letter-spacing:0; font-weight:500; }
.preset-option .mismatch-note { color:#d58c75; font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
.preset-current { grid-column:1/-1; margin:10px 2px 0; color:var(--muted); font-size:12px; }
.preset-current .ok { color:#9fbf8a; margin-left:6px; }
.preset-current .warn { color:#d58c75; margin-left:6px; }

.target-size-picker {
  display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px;
  padding:10px 14px; border:1px solid #34372f; background:#0d0f0d; border-radius:2px; margin-bottom:12px;
}
.target-size-picker label {
  display:flex; align-items:center; gap:8px; font-size:11px; text-transform:uppercase;
  letter-spacing:.1em; color:var(--muted);
}
.target-size-picker .stepper { display:flex; align-items:center; gap:8px; }
.target-size-picker .stepper button { padding:2px 10px; font:700 14px Cinzel; line-height:1.4; }
.target-size-picker .stepper strong { font:700 16px Cinzel; color:var(--pale); min-width:1.4em; text-align:center; }
.target-mismatch-note {
  flex:1 1 260px; margin:0; font-size:11px; line-height:1.5; color:#d58c75;
}

.composition-summary {
  display:flex; flex-wrap:wrap; gap:10px 18px; align-items:center;
  padding:12px 14px; border:1px solid #34372f; background:#0d0f0d; border-radius:2px; margin-bottom:16px;
}
.summary-stat { display:flex; flex-direction:column; gap:2px; }
.summary-stat span { font-size:9px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); }
.summary-stat strong { font:700 18px Cinzel; color:var(--pale); }
.summary-stat strong.loy { color:#9fbf8a; }
.summary-stat strong.her { color:#d58c75; }
.summary-stat strong.bad { text-decoration:underline; text-decoration-color:#d58c75; }
.parity-note { flex:1 1 220px; color:var(--muted); font-size:11px; line-height:1.55; margin:0; }
.parity-note.bad { color:#d58c75; }
.parity-note span { display:block; }

.faction-columns { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
.faction-group h3 {
  display:flex; justify-content:space-between; align-items:baseline;
  font:700 14px Cinzel; letter-spacing:.06em; margin:0 0 8px; color:var(--gold2);
}
.faction-group h3 small { color:var(--muted); font-size:10px; font-weight:500; letter-spacing:.08em; }
.faction-group ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px; }

.role-row {
  border:1px solid #2a2c25; background:#0c0e0c; border-radius:2px; padding:9px 11px;
  transition:border-color .12s;
}
.role-row.selected { border-color:#4a4434; background:#11100a; }
.role-head { display:flex; align-items:center; gap:8px; }
.role-name { flex:1; display:flex; align-items:center; gap:8px; font-size:13px; color:var(--pale); }
.tier { font-size:9px; letter-spacing:.1em; color:var(--muted); border:1px solid #34372f; padding:1px 5px; border-radius:2px; }
.role-count { display:flex; align-items:center; gap:7px; }
.count-btn {
  width:24px; height:24px; border:1px solid #43463d; background:#171916; color:var(--pale);
  font:700 14px Inter; cursor:pointer; padding:0; border-radius:2px; line-height:1;
}
.count-btn:hover:not(:disabled) { border-color:var(--gold); color:var(--gold2); }
.count-btn:disabled { opacity:.4; cursor:not-allowed; }
.count-display { min-width:14px; text-align:center; font:600 13px Inter; color:var(--pale); }
.role-toggle {
  background:none; border:0; color:var(--muted); font-size:10px; text-transform:uppercase;
  letter-spacing:.08em; cursor:pointer; padding:2px 4px;
}
.role-toggle:hover { color:var(--gold2); }
.role-detail { margin-top:8px; padding-top:8px; border-top:1px dashed #2a2c25; }
.role-detail p { margin:4px 0; font-size:11.5px; line-height:1.55; color:#bdbcae; }
.role-detail p span { color:var(--muted); font-size:9px; text-transform:uppercase; letter-spacing:.12em; margin-right:5px; }
.threshold-note { color:var(--gold2) !important; font-size:10.5px !important; }

.roster-preview {
  margin-top:18px; padding:13px 14px; border:1px solid #34372f; background:#0d0f0d; border-radius:2px;
}
.roster-preview h4 { font:700 13px Cinzel; letter-spacing:.06em; margin:0 0 9px; color:var(--gold2); }
.roster-chips { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:6px; }
.roster-chip {
  display:inline-flex; align-items:center; gap:5px; padding:5px 9px;
  border:1px solid #43463d; background:#171916; color:var(--pale);
  font-size:11px; border-radius:2px; cursor:pointer;
}
.roster-chip.loyalist { border-color:#43503a; }
.roster-chip.heretic { border-color:#5a3a36; color:#e2b3ac; }
.roster-chip span { color:var(--muted); font-weight:700; }
.roster-chip:hover span { color:#d58c75; }
.empty-roster { color:var(--muted); font-size:12px; margin:0; }
.roster-actions { display:flex; gap:8px; margin-top:10px; }
.roster-actions .small { padding:6px 10px; font-size:9px; }

.validation-errors, .validation-warnings {
  margin-top:14px; padding:11px 13px; border-radius:2px; border:1px solid;
}
.validation-errors { border-color:#5a3a36; background:#1a1110; }
.validation-warnings { border-color:#4a4434; background:#15140d; }
.validation-heading { font-size:9px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); margin:0 0 6px; }
.validation-errors p { color:#e2b3ac; font-size:12px; margin:3px 0; }
.warn-soft { color:#cfc7a8; font-size:12px; margin:3px 0; display:flex; gap:7px; align-items:flex-start; }
.warn-soft.acked { opacity:.55; }
.ack-mark { color:var(--gold); font-weight:700; }
.err-soft_unacknowledged { color:#cfc7a8; }

.nonhost-note { color:var(--muted); font-size:13px; line-height:1.6; margin:0; max-width:640px; }
.full-row { width:100%; }

.sim-panel { margin-top:20px; padding-top:18px; border-top:1px dashed #34372f; }
.sim-panel-head { display:flex; flex-direction:column; gap:4px; margin-bottom:12px; }
.sim-panel-head h3 { font:700 14px Cinzel; letter-spacing:.06em; margin:0; color:var(--gold2); }
.sim-hint { color:var(--muted); font-size:11.5px; line-height:1.5; margin:0; max-width:640px; }
.sim-controls { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
.sim-games-field { display:flex; flex-direction:column; gap:6px; margin:0; text-transform:uppercase; font-size:10px; letter-spacing:.1em; color:var(--muted); }
.sim-games-field input { width:90px; padding:9px 10px; font-size:13px; text-align:center; }
.sim-controls button { padding:11px 16px; font-size:10px; }
.sim-error { margin-top:10px; padding:10px 12px; border:1px solid #5a3a36; background:#1a1110; color:#e2b3ac; font-size:12px; border-radius:2px; }
</style>