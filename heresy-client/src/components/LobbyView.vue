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
              <span class="avatar mini" v-bind="sealAttrs(m.author)">{{ sealText(m.author) }}</span>
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
          <span v-else>{{ players.length }}/{{ rules.MAX_PLAYERS }}</span>
        </header>
        <ul class="lobby-players compact">
          <li v-for="p in players" :key="p.playerCode" :class="{offline:liveMode && !p.connected}">
            <span class="avatar" v-bind="sealAttrs(p.name)">{{ sealText(p.name) }}</span>
            <div><strong>{{ p.name }}</strong><small>{{ p.isHost ? 'Commander' : (liveMode && p.connected === false) ? 'Vox lost' : (p.ready ? 'Ready' : 'Awaiting') }}</small></div>
            <i v-if="liveMode" class="presence" :class="{online:p.connected}" :title="p.connected ? 'Online' : 'Disconnected'"></i>
            <span class="ready" :class="{yes:p.ready}">{{ p.ready?'READY':'…' }}</span>
            <span class="kick-slot">
              <button v-if="isHost && !p.isHost" class="kick-btn" :title="'Remove ' + p.name" :aria-label="'Remove ' + p.name" @click="confirmKick(p)">×</button>
            </span>
          </li>
        </ul>
        <p v-if="players.length < rules.MIN_PLAYERS" class="notice">At least {{ rules.MIN_PLAYERS }} operatives are required.</p>
        <button class="secondary wide ready-in-ops" :class="{selected:me?.ready}" :disabled="busy" @click="$emit('ready')">{{ me?.ready?'Stand down':'Mark ready' }}</button>
      </article>

      <article class="panel setup-card params-cell">
        <header><h2>Operation parameters</h2><span>{{ game.mode==='async'?'ASYNC':'LIVE' }}</span></header>
        <div class="params-row">
          <div class="preset"><strong>{{ players.length }}-operative conclave</strong><p>Sealed at launch; revealed privately per dossier.</p></div>

          <div v-if="isHost" class="param-fields">
            <div class="param-group">
              <span class="eyebrow">Pacing</span>
              <div class="pacing-tiles">
                <label class="pacing-tile">
                  <span class="tile-label">Drift</span>
                  <input v-model.number="setup.maxDrift" type="number" min="1" :max="phases.MAX_DRIFT_CEILING" @input="scheduleSave">
                  <span class="tile-steppers">
                    <button type="button" class="tile-step step-up" tabindex="-1" aria-label="Increase drift" @click.prevent="bumpDrift(1)">▲</button>
                    <button type="button" class="tile-step step-down" tabindex="-1" aria-label="Decrease drift" @click.prevent="bumpDrift(-1)">▼</button>
                  </span>
                </label>
                <template v-if="game.mode==='async'">
                  <label class="pacing-tile wide">
                    <span class="tile-label">Day starts (UTC)</span>
                    <input type="time" v-model="dayStartTimeUTC" @change="scheduleSave">
                  </label>
                </template>
                <template v-else>
                  <label class="pacing-tile">
                    <span class="tile-label">Day</span>
                    <input v-model.number="dayMinutes" type="number" :min="phaseMinFloor" :max="phaseMinCeiling" @input="scheduleSave">
                    <span class="tile-steppers">
                      <button type="button" class="tile-step step-up" tabindex="-1" aria-label="Increase day length" @click.prevent="bumpDayMinutes(1)">▲</button>
                      <button type="button" class="tile-step step-down" tabindex="-1" aria-label="Decrease day length" @click.prevent="bumpDayMinutes(-1)">▼</button>
                    </span>
                  </label>
                  <label class="pacing-tile">
                    <span class="tile-label">Night</span>
                    <input v-model.number="nightMinutes" type="number" :min="phaseMinFloor" :max="phaseMinCeiling" @input="scheduleSave">
                    <span class="tile-steppers">
                      <button type="button" class="tile-step step-up" tabindex="-1" aria-label="Increase night length" @click.prevent="bumpNightMinutes(1)">▲</button>
                      <button type="button" class="tile-step step-down" tabindex="-1" aria-label="Decrease night length" @click.prevent="bumpNightMinutes(-1)">▼</button>
                    </span>
                  </label>
                </template>
              </div>
              <p v-if="game.mode==='async'" class="day-start-hint">{{ dayStartLocalPreview }}. Day and night are locked at {{ Math.round(phases.ASYNC_PHASE_MS / 3600000) }}h each.</p>
            </div>

            <div class="param-group">
              <span class="eyebrow">Disclosure</span>
              <label class="anon-toggle">
                <input type="checkbox" v-model="setup.anonymized" @change="scheduleSave"> Anonymized mode
                <span class="info-tip" :class="{open: openTip==='anon'}">
                  <button type="button" class="info-trigger" @click.stop="toggleTip('anon')" @keydown.esc="closeTip(); $event.target.blur()" :aria-expanded="openTip==='anon'" aria-label="About anonymized mode" aria-describedby="tip-anon">i</button>
                  <span id="tip-anon" role="tooltip" class="info-tooltip">Player names are replaced with notable Warhammer 40k characters once the game starts.</span>
                </span>
              </label>
              <label class="anon-toggle">
                <input type="checkbox" v-model="setup.warpTaintVisible" @change="scheduleSave"> Warp taint display
                <span class="info-tip" :class="{open: openTip==='warp'}">
                  <button type="button" class="info-trigger" @click.stop="toggleTip('warp')" @keydown.esc="closeTip(); $event.target.blur()" :aria-expanded="openTip==='warp'" aria-label="About warp taint display" aria-describedby="tip-warp">i</button>
                  <span id="tip-warp" role="tooltip" class="info-tooltip">Shows each operative their own last-sensed drift zone gauge in the dossier. Off hides the gauge entirely — the hint is still sent, just not rendered.</span>
                </span>
              </label>
              <label class="reveal-select">
                Death reveal
                <span class="reveal-select-control">
                  <select v-model="setup.deathReveal" @change="scheduleSave"><option value="role">Full role</option><option value="alignment">Alignment only</option></select>
                  <span class="info-tip" :class="{open: openTip==='reveal'}">
                    <button type="button" class="info-trigger" @click.stop="toggleTip('reveal')" @keydown.esc="closeTip(); $event.target.blur()" :aria-expanded="openTip==='reveal'" aria-label="About death reveal" aria-describedby="tip-reveal">i</button>
                    <span id="tip-reveal" role="tooltip" class="info-tooltip">What the conclave learns when a tortured suspect dies under interrogation. Full role names their dossier; alignment only says Loyalist or Heretic. A lynch reveals neither either way — buying that information is what torture is for.</span>
                  </span>
                </span>
              </label>
            </div>

            <p class="save-indicator" :class="{visible: justSaved}">Saved</p>
          </div>

          <div v-else class="param-readonly">
            <div class="param-group">
              <span class="eyebrow">Pacing</span>
              <div class="pacing-tiles">
                <div class="pacing-tile"><span class="tile-label">Drift</span><strong>{{ setup.maxDrift }}</strong></div>
                <template v-if="game.mode==='async'">
                  <div class="pacing-tile wide"><span class="tile-label">Day starts</span><strong>{{ dayStartTimeUTC }} UTC</strong></div>
                </template>
                <template v-else>
                  <div class="pacing-tile"><span class="tile-label">Day</span><strong>{{ dayMinutes }}m</strong></div>
                  <div class="pacing-tile"><span class="tile-label">Night</span><strong>{{ nightMinutes }}m</strong></div>
                </template>
              </div>
              <p v-if="game.mode==='async'" class="day-start-hint">{{ dayStartLocalPreview }}</p>
            </div>
            <div class="param-group">
              <span class="eyebrow">Disclosure</span>
              <div class="readonly-row"><span>Anonymized</span><strong>{{ setup.anonymized ? 'On' : 'Off' }}</strong></div>
              <div class="readonly-row"><span>Warp taint</span><strong>{{ setup.warpTaintVisible ? 'On' : 'Off' }}</strong></div>
              <div class="readonly-row"><span>Death reveal</span><strong>{{ setup.deathReveal === 'alignment' ? 'Alignment' : 'Full role' }}</strong></div>
            </div>
          </div>
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
                <button type="button" class="ghost small" @click="setTargetPlayerCount(targetPlayerCount-1)" :disabled="targetPlayerCount <= rules.MIN_PLAYERS">−</button>
                <strong>{{ targetPlayerCount }}</strong>
                <button type="button" class="ghost small" @click="setTargetPlayerCount(targetPlayerCount+1)" :disabled="targetPlayerCount >= rules.MAX_PLAYERS">+</button>
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
                    <p><span>Ability:</span> {{ roleAbilityForLobby(r, targetPlayerCount) }}</p>
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
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { validateComposition } from '../server-composition-validator.js';
import { validRoles, hardRules, presetFlavor, roleThresholds, roleAbilityForLobby } from '../compositionData.js';
import { buildSealMap, fallbackSeal, sealVars } from '../seals.js';
import { settings } from '../settings.js';
import { socket, ensureConnected, getPlayerCode } from '../socket.js';
import SimResultsPanel from './SimResultsPanel.vue';
import phases from '@game_data/phases.json';
import rules from '@game_data/rules.json';

const props = defineProps({
  game: { type: Object, required: true },
  me: Object,
  busy: Boolean,
  compositionErrors: { type: Array, default: () => [] },
  messages: { type: Array, default: () => [] },
  hasMore: { type: Boolean, default: true },
});
const emit = defineEmits(['ready', 'start', 'configure', 'leave', 'clear-errors', 'send', 'history', 'kick']);

const players = computed(() => props.game.players || []);
const isHost = computed(() => props.me?.isHost);
const playerCount = computed(() => players.value.length);
const canStart = computed(() => playerCount.value >= rules.MIN_PLAYERS && players.value.every(p => p.ready));
const presetCounts = Array.from({ length: rules.MAX_PLAYERS - rules.MIN_PLAYERS + 1 }, (_, i) => rules.MIN_PLAYERS + i);

const setup = reactive({ maxDrift: 20, dayMs: phases.SYNC_DAY_MS, nightMs: phases.SYNC_NIGHT_MS, anonymized: false, warpTaintVisible: false, deathReveal: 'role', dayStartMinuteUtc: phases.DEFAULT_DAY_START_MINUTE_UTC });
watch(() => props.game.maxDrift, v => { if (v) setup.maxDrift = v; }, { immediate: true });
watch(() => props.game.dayMs, v => { if (v) setup.dayMs = v; }, { immediate: true });
watch(() => props.game.nightMs, v => { if (v) setup.nightMs = v; }, { immediate: true });
watch(() => props.game.anonymized, v => { setup.anonymized = !!v; }, { immediate: true });
watch(() => props.game.warpTaintVisible, v => { setup.warpTaintVisible = !!v; }, { immediate: true });
watch(() => props.game.deathReveal, v => { if (v) setup.deathReveal = v; }, { immediate: true });
watch(() => props.game.dayStartMinuteUtc, v => { if (v != null) setup.dayStartMinuteUtc = v; }, { immediate: true });
const phaseMinFloor = computed(() => Math.ceil(phases.PHASE_MS_FLOOR_CONFIGURE / 60000));
const phaseMinCeiling = computed(() => Math.floor(phases.PHASE_MS_CEILING / 60000));
const dayMinutes = computed({ get: () => Math.round(setup.dayMs / 60000), set: v => { const n = Math.round(Number(v) || 0); if (n >= 1) setup.dayMs = n * 60000; } });
const nightMinutes = computed({ get: () => Math.round(setup.nightMs / 60000), set: v => { const n = Math.round(Number(v) || 0); if (n >= 1) setup.nightMs = n * 60000; } });
// Async mode: day/night are locked at 12h, so the only thing the host
// tunes is a wall-clock day-start time. <input type="time"> works in
// "HH:MM" strings; setup.dayStartMinuteUtc stores minutes since UTC
// midnight (what the server wants), so this wraps the conversion both ways.
const dayStartTimeUTC = computed({
  get: () => `${String(Math.floor(setup.dayStartMinuteUtc / 60)).padStart(2, '0')}:${String(setup.dayStartMinuteUtc % 60).padStart(2, '0')}`,
  set: v => { const [h, m] = String(v || '00:00').split(':').map(Number); setup.dayStartMinuteUtc = Math.max(0, Math.min(1439, (h || 0) * 60 + (m || 0))); }
});
// Local-time preview: the browser already knows the viewer's own timezone
// (Intl/Date default to it), so this needs no IP geolocation or "which
// country" lookup — just render the same UTC moment through the local
// clock. Today's date is a placeholder; only the time-of-day is shown.
const dayStartLocalPreview = computed(() => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(setup.dayStartMinuteUtc / 60), setup.dayStartMinuteUtc % 60));
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${time} your local time (${tz})`;
});

// Auto-save: debounce so a burst of edits (typing a number, or a checkbox
// flip landing mid-keystroke) becomes one 'configure' emit, not one per
// change. Bound to @input/@change on the fields themselves rather than a
// watch(setup, ...) — that would also fire from the sync watches above
// writing server state back into `setup`, looping a save right back out.
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { emit('configure', { ...setup }); }, 600);
}

// Pacing tile hover steppers — same clamps the number inputs' own
// min/max already enforce, just reachable without focusing the field first.
function bumpDrift(delta) {
  const next = Math.min(phases.MAX_DRIFT_CEILING, Math.max(1, Math.round(setup.maxDrift || 0) + delta));
  if (next !== setup.maxDrift) { setup.maxDrift = next; scheduleSave(); }
}
function bumpDayMinutes(delta) {
  const next = Math.min(phaseMinCeiling.value, Math.max(phaseMinFloor.value, dayMinutes.value + delta));
  if (next !== dayMinutes.value) { dayMinutes.value = next; scheduleSave(); }
}
function bumpNightMinutes(delta) {
  const next = Math.min(phaseMinCeiling.value, Math.max(phaseMinFloor.value, nightMinutes.value + delta));
  if (next !== nightMinutes.value) { nightMinutes.value = next; scheduleSave(); }
}

// "Saved" flash: fires off the server's own confirmed values, not the
// local edit, so it only lights up once the change has actually round-tripped.
// Non-immediate (default) — skips the initial mount sync above and only
// reacts to real subsequent changes. Must be the multi-source array-of-
// getters form, NOT a single getter returning `[a,b,c,d]` — the latter
// builds a fresh array literal on every reactive rerun, which Vue then
// compares by reference (always "changed"), so it would refire on every
// unrelated game:state broadcast (someone readying up, joining, chatting)
// instead of only when these four values actually change.
const justSaved = ref(false);
let savedFlashTimer = null;
watch([() => props.game.maxDrift, () => props.game.dayMs, () => props.game.nightMs, () => props.game.anonymized, () => props.game.warpTaintVisible, () => props.game.deathReveal, () => props.game.dayStartMinuteUtc], () => {
  justSaved.value = true;
  if (savedFlashTimer) clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => { justSaved.value = false; }, 2500);
});

// (i) tooltips for the setting hints that used to sit permanently on screen
// as <p> paragraphs. Click/tap toggles `openTip` (touch, and an explicit
// dismiss target); CSS also reveals on :focus-within (keyboard tab) and
// :hover (mouse) regardless of this state. aria-describedby on the trigger
// keeps the text available to screen readers on focus no matter which of
// those is what showed it. Escape blurs the trigger (dropping :focus-within)
// and clears `openTip`, so it's dismissable from the keyboard too. A single
// id at a time is open — these are never meant to stack.
const openTip = ref(null);
function toggleTip(id) { openTip.value = openTip.value === id ? null : id; }
function closeTip() { openTip.value = null; }
function onDocClickForTips(e) {
  if (openTip.value && !(e.target instanceof Element && e.target.closest('.info-tip'))) closeTip();
}
onMounted(() => document.addEventListener('click', onDocClickForTips));

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
  targetPlayerCount.value = Math.max(rules.MIN_PLAYERS, Math.min(rules.MAX_PLAYERS, Math.round(Number(n) || playerCount.value)));
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
  if (n < rules.MIN_PLAYERS) return;
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
  if (saveTimer) clearTimeout(saveTimer);
  if (savedFlashTimer) clearTimeout(savedFlashTimer);
  document.removeEventListener('click', onDocClickForTips);
});

// Operative seals — same mark the player carries in-game, so the roster you
// read in the lobby is the roster you recognise once the chamber is sealed.
const sealMap = computed(() => buildSealMap(players.value.map(p => p.name), settings.sealStyle));
function sealFor(name) { return sealMap.value.get(name) || fallbackSeal(name, settings.sealStyle); }
function sealAttrs(name) { const s = sealFor(name); return { 'data-seal-kind': s.kind, 'data-seal': s.pattern, class: s.text.length > 1 ? 'seal-mono' : null, style: sealVars(s) }; }
function sealText(name) { return sealFor(name).text; }
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
  align-items: flex-start;
  gap: 18px;
  padding: 16px 20px 20px;
  flex-wrap: wrap;
}
.params-cell .preset { flex: 1 1 260px; min-width: 0; }
.params-cell .preset p { font-size: 11px; }
.params-cell .param-fields {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  min-width: 0;
}
.params-cell .param-fields label {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 0;
  width: 100%;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: .1em;
  color: var(--muted);
  white-space: nowrap;
}
.params-cell .param-fields input {
  width: 80px;
  padding: 8px 10px;
  font-size: 13px;
  text-align: center;
}
/* Pacing: Drift / Day min / Night min (or Day starts, async) read as a row
   of instrument tiles rather than a stack of form rows — the numbers are
   the thing the host is scanning for, so they get the same weight as the
   composition panel's faction-count stats below (Cinzel, large, gold). */
.params-cell .param-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid #262922;
  background: #0c0e0c;
  border-radius: 2px;
  min-width: 0;
}
.params-cell .pacing-tiles {
  display: flex;
  gap: 6px;
  min-width: 0;
}
/* Specificity note: .param-fields label (below) carries an element
   selector, which outranks a plain .pacing-tile class rule — so this is
   qualified with .params-row (the ancestor shared by both the host
   .param-fields tiles and the read-only .param-readonly tiles) to win
   regardless of source order. Bit me twice already; don't drop the
   qualifier or narrow it back down to just .param-fields. */
.params-cell .params-row .pacing-tile {
  position: relative;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: 9px 4px 11px;
  border: 1px solid #34372f;
  background: #0d0f0d;
  border-radius: 2px;
  text-align: center;
  margin: 0;
  width: auto;
  min-width: 0;
  white-space: normal;
}
.params-cell .params-row .pacing-tile.wide { flex: 1.7 1 0; }
.params-cell .pacing-tile .tile-label {
  font-size: 8.5px;
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--muted);
  white-space: normal;
}
/* Reserve room so the centered label doesn't sit under the hover steppers
   in the corner — only the three tiles that have steppers get the offset. */
.params-cell .pacing-tile:has(.tile-steppers) .tile-label {
  padding-right: 13px;
}
.params-cell .pacing-tile strong {
  font: 700 20px Cinzel;
  color: var(--gold2);
  letter-spacing: .02em;
}
.params-cell .param-fields .pacing-tile input {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: center;
  font: 700 21px Cinzel;
  color: var(--gold2);
  -moz-appearance: textfield;
}
.params-cell .param-fields .pacing-tile input[type="time"] {
  font-size: 15px;
}
.params-cell .param-fields .pacing-tile input::-webkit-outer-spin-button,
.params-cell .param-fields .pacing-tile input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.params-cell .param-fields .pacing-tile input:focus {
  outline: none;
}
.params-cell .param-fields .pacing-tile:focus-within {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px #b69a5c22;
}
/* Increment/decrement affordance for the number tiles — hidden until the
   tile is hovered or the input inside it has focus, so the tile reads as
   a clean stat display the rest of the time. The native spinner is
   suppressed above (webkit-appearance:none) in favour of these, but
   arrow-key stepping on the input itself still works either way. */
.params-cell .param-fields .pacing-tile .tile-steppers {
  position: absolute;
  top: 5px;
  right: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease;
}
.params-cell .param-fields .pacing-tile:hover .tile-steppers,
.params-cell .param-fields .pacing-tile:focus-within .tile-steppers {
  opacity: 1;
  pointer-events: auto;
}
.params-cell .tile-step {
  width: 13px;
  height: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 0;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.params-cell .tile-step::before {
  content: "";
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
}
.params-cell .tile-step.step-up::before { border-bottom: 5px solid var(--muted); }
.params-cell .tile-step.step-down::before { border-top: 5px solid var(--muted); }
.params-cell .tile-step:hover::before,
.params-cell .tile-step:focus-visible::before {
  border-bottom-color: var(--gold2);
  border-top-color: var(--gold2);
}
.params-cell .tile-step:focus-visible {
  outline: none;
}
.params-cell .readonly-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11.5px;
  color: var(--muted);
}
.params-cell .readonly-row strong {
  color: var(--pale);
  font-weight: 600;
}
.params-cell .save-indicator {
  margin: 0;
  padding: 9px 0;
  height: 34px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  align-self: flex-end;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: #9fbf8a;
  opacity: 0;
  transition: opacity .3s ease;
  pointer-events: none;
}
.params-cell .save-indicator.visible { opacity: 1; }
.params-cell .param-fields .anon-toggle {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  width: 100%;
  cursor: pointer;
}
/* Custom mark instead of the OS checkbox — everything else in this UI
   (buttons, selects, role rows) is hand-styled, so the one native browser
   control stood out. appearance:none turns the input into a plain box we
   draw ourselves; the check is a clip-path wedge revealed on :checked. */
.params-cell .anon-toggle input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  display: inline-grid;
  place-content: center;
  border: 1px solid #4a4d43;
  background: #0d0f0d;
  border-radius: 2px;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
}
.params-cell .anon-toggle input[type="checkbox"]::after {
  content: "";
  width: 8px;
  height: 8px;
  background: var(--gold2);
  clip-path: polygon(14% 44%, 0 65%, 45% 100%, 100% 16%, 82% 0%, 43% 62%);
  transform: scale(0);
  transition: transform .12s ease;
}
.params-cell .anon-toggle input[type="checkbox"]:checked {
  border-color: var(--gold);
  background: #1d1b13;
}
.params-cell .anon-toggle input[type="checkbox"]:checked::after {
  transform: scale(1);
}
.params-cell .anon-toggle input[type="checkbox"]:focus-visible {
  outline: none;
  border-color: var(--gold);
  box-shadow: 0 0 0 2px #b69a5c22;
}
.params-cell .param-fields select {
  width: auto;
  min-width: 128px;
  padding: 7px 26px 7px 8px;
  font: 500 12px Inter;
  border: 1px solid #3a3c34;
  background-color: #0d0f0d;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) center, calc(100% - 10px) center;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  appearance: none;
  -webkit-appearance: none;
  color: var(--pale);
  border-radius: 2px;
  cursor: pointer;
  text-transform: none;
  letter-spacing: normal;
}
.params-cell .param-fields select:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px #b69a5c22;
  outline: none;
}
.params-cell .param-fields .reveal-select {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.params-cell .reveal-select-control {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.params-cell .reveal-select-control select {
  /* flex-grow:0 — this used to be 1 1 auto, which stretched the select to
     fill the full group width. That made it read as a big boxy banner next
     to the compact checkbox rows above it in the same group. Content-sized
     (falling back to select's own min-width) matches their visual weight. */
  flex: 0 1 auto;
  min-width: 0;
}

/* (i) tooltip trigger — replaces the permanently-on-screen hint paragraphs.
   The trigger is a real <button> (focusable, Enter/Space activates it like
   any button). Visibility of .info-tooltip is driven three ways: the click
   toggle (.open, for touch and as an explicit on/off), :focus-within (tab
   to it with a keyboard), and :hover (mouse). It stays in the accessibility
   tree at all times (opacity, not display/visibility) so aria-describedby
   on the trigger reads its text to screen readers on focus regardless of
   which of those applies. */
.info-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
}
.info-trigger {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 1px solid #52564a;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  font: italic 700 10px/1 Georgia, serif;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.info-trigger:hover,
.info-trigger:focus-visible {
  border-color: var(--gold);
  color: var(--gold2);
  outline: none;
}
.info-tooltip {
  position: absolute;
  z-index: 20;
  top: calc(100% + 7px);
  right: 0;
  width: 220px;
  max-width: 70vw;
  padding: 9px 11px;
  background: #14150f;
  border: 1px solid #43463d;
  border-radius: 2px;
  box-shadow: 0 12px 30px #0009;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
  text-transform: none;
  letter-spacing: normal;
  white-space: normal;
  font-weight: 500;
  opacity: 0;
  pointer-events: none;
  transform: translateY(2px);
  transition: opacity .12s ease, transform .12s ease;
}
.info-tip.open .info-tooltip,
.info-tip:focus-within .info-tooltip,
.info-tip:hover .info-tooltip {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.params-cell .day-start-hint {
  width: 100%;
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--muted);
  text-transform: none;
  letter-spacing: normal;
}

/* Each label/input pair is a full-width row (label left, control right) at
   every width — see .param-fields above. The wide-screen sidebar just gets
   a couple of extra polish tweaks once there's room to spare. */
@media (min-width: 1301px) {
  .params-cell .save-indicator { width: 100%; justify-content: flex-end; align-self: stretch; }
}
.params-cell .param-readonly {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
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