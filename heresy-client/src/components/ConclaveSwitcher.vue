<template>
  <div v-if="games.length" class="conclave-switcher" ref="rootEl">
    <button
      ref="triggerEl"
      type="button"
      class="switcher-trigger"
      aria-label="Switch conclave"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <svg class="conclave-icon" aria-hidden="true"><use href="#hr-conclave" /></svg>
      <span class="switcher-label">{{ currentCode || 'My conclaves' }}</span>
      <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
    <!-- Teleported for the same reason as SettingsMenu's popover: .masthead
         has overflow:hidden for its rose-window watermark, which would clip
         this down to the header's own height if left as a positioned
         descendant. -->
    <Teleport to="body">
      <Transition name="switcher-pop">
        <div
          v-if="open"
          ref="popoverEl"
          class="switcher-popover"
          :style="popoverStyle"
          role="dialog"
          aria-modal="false"
          aria-label="Your conclaves"
        >
          <h3 class="switcher-heading">Your conclaves</h3>
          <p v-if="fetchError" class="switcher-error">{{ fetchError }}</p>
          <ul v-else class="conclave-list">
            <li v-for="g in games" :key="g.code">
              <button
                type="button"
                class="conclave-option"
                :class="{ current: g.code === currentCode, ended: g.status === 'ended' }"
                @click="pick(g)"
              >
                <svg class="option-glyph" aria-hidden="true"><use :href="glyphFor(g)" /></svg>
                <span class="option-copy">
                  <strong>{{ g.code }}</strong>
                  <small>{{ statusLabel(g) }} · {{ countLabel(g) }}</small>
                </span>
                <span v-if="g.code === currentCode" class="current-badge">Current</span>
              </button>
            </li>
          </ul>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ensureConnected, emitWithAck, getPlayerCode } from '../socket.js';

const props = defineProps({ currentCode: { type: String, default: '' } });
const emit = defineEmits(['switch']);

const open = ref(false);
const games = ref([]);
const fetchError = ref('');
const rootEl = ref(null);
const triggerEl = ref(null);
const popoverEl = ref(null);
const popoverStyle = ref({});

const POPOVER_WIDTH = 340; // matches the CSS width below; used before the popover has rendered once to measure itself

async function refresh() {
  try {
    await ensureConnected();
    const res = await emitWithAck('game:list-mine', { playerCode: getPlayerCode() });
    games.value = res?.games || [];
    fetchError.value = '';
  } catch (e) {
    // Keep whatever list we already had (e.g. a brief disconnect shouldn't
    // make the switcher vanish); only surface an error inside the popover.
    fetchError.value = e.message || 'Unable to load your conclaves.';
  }
}

// Refetch whenever the active game changes (create/join/spectate/start/leave
// all flow through this prop from App.vue) — this is also what makes the
// switcher appear the moment a player's first game exists, since it starts
// hidden with an empty list.
watch(() => props.currentCode, refresh);

function statusLabel(g) {
  if (g.status === 'ended') return `Ended · ${g.winner ? pretty(g.winner) + ' victory' : 'concluded'}`;
  if (g.phase === 'lobby') return 'Lobby';
  if (g.phase === 'night') return `Night ${g.round}`;
  if (g.phase === 'day') return `Day ${g.round}${g.dayStage === 'response' ? ' · torture' : ''}`;
  return pretty(g.phase);
}
function countLabel(g) {
  return g.status === 'ended' ? `${g.playerCount} operatives` : `${g.aliveCount}/${g.playerCount} alive`;
}
function pretty(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}
function glyphFor(g) {
  if (g.status === 'ended') return '#hr-verdict';
  if (g.phase === 'night') return '#hr-night';
  if (g.phase === 'day') return '#hr-day';
  return '#hr-conclave';
}

function pick(g) {
  close();
  if (g.code === props.currentCode) return;
  emit('switch', g.code);
}

function computePosition() {
  const btn = triggerEl.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const width = popoverEl.value?.getBoundingClientRect().width || POPOVER_WIDTH;
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  popoverStyle.value = { top: `${rect.bottom + 12}px`, left: `${left}px` };
}

function toggle() {
  open.value = !open.value;
  if (open.value) {
    refresh(); // fresh list every time it's opened
    nextTick(computePosition);
  }
}
function close() {
  open.value = false;
}
function onDocClick(e) {
  if (!open.value) return;
  if (rootEl.value?.contains(e.target)) return;
  if (popoverEl.value?.contains(e.target)) return;
  close();
}
function onKeydown(e) {
  if (e.key === 'Escape' && open.value) close();
}
function onResize() {
  if (open.value) computePosition();
}

onMounted(() => {
  refresh();
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onResize);
});
</script>

<style scoped>
.conclave-switcher {
  grid-column: 2;
  display: inline-flex;
}
.switcher-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #43463d;
  background: #171916;
  color: var(--gold2);
  border-radius: 2px;
  cursor: pointer;
  font: 700 11px Cinzel, serif;
  letter-spacing: 0.08em;
  transition: border-color 0.15s ease, color 0.15s ease;
  max-width: min(46vw, 320px);
}
.switcher-trigger:hover {
  border-color: var(--gold);
  filter: brightness(1.17);
}
.switcher-trigger:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.conclave-icon {
  width: 14px;
  height: 14px;
  flex: none;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.4;
}
.switcher-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
}
.chevron {
  width: 12px;
  height: 12px;
  flex: none;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.7;
}

.switcher-popover {
  position: fixed;
  z-index: 20;
  width: min(340px, calc(100vw - 32px));
  max-height: min(420px, calc(100vh - 100px));
  overflow-y: auto;
  background: linear-gradient(145deg, rgba(27, 29, 24, 0.98), rgba(15, 17, 14, 0.98));
  border: 1px solid var(--gold);
  box-shadow: 0 18px 50px #0007;
  padding: 18px;
  border-radius: 2px;
}
.switcher-heading {
  margin: 0 0 14px;
  font: 700 13px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--gold2);
}
.switcher-error {
  margin: 0;
  font-size: 12px;
  color: #d99b95;
}
.conclave-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.conclave-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #34372f;
  background: #0d0f0d;
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  color: var(--pale);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.conclave-option:hover {
  border-color: rgba(182, 154, 92, 0.45);
}
.conclave-option:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.conclave-option.current {
  border-color: var(--gold);
  background: #1d1b13;
  box-shadow: inset 0 0 0 1px var(--gold);
  cursor: default;
}
.conclave-option.ended {
  opacity: 0.6;
}
.conclave-option.ended.current {
  opacity: 0.85;
}
.option-glyph {
  width: 18px;
  height: 18px;
  flex: none;
  stroke: var(--gold);
  fill: none;
  stroke-width: 1.4;
}
.conclave-option.ended .option-glyph {
  stroke: #8d5a4e;
}
.option-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.option-copy strong {
  font: 700 13px Cinzel, serif;
  letter-spacing: 0.06em;
  color: var(--gold2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-copy small {
  font-size: 10.5px;
  color: var(--muted);
}
.current-badge {
  flex: none;
  font: 700 8px Inter, sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gold);
  border: 1px solid rgba(182, 154, 92, 0.5);
  border-radius: 2px;
  padding: 3px 6px;
}

.switcher-pop-enter-active,
.switcher-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.switcher-pop-enter-from,
.switcher-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .switcher-pop-enter-active,
  .switcher-pop-leave-active {
    transition: none;
  }
}

@media (max-width: 850px) {
  .switcher-trigger {
    max-width: 34vw;
  }
  .switcher-label {
    max-width: 20vw;
  }
}
</style>
