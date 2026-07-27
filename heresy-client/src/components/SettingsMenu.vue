<template>
  <div class="settings-menu" ref="rootEl">
    <button
      ref="triggerEl"
      type="button"
      class="settings-trigger"
      aria-label="Player settings"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <svg class="gear-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M19 12h2.2M16.95 16.95l1.56 1.56M12 19v2.2M7.05 16.95l-1.56 1.56M5 12H2.8M7.05 7.05 5.49 5.49M12 5V2.8M16.95 7.05l1.56-1.56" />
      </svg>
    </button>
    <!-- Teleported to <body> rather than left as a positioned descendant of
         .masthead: the masthead has `overflow: hidden` (it clips an oversized
         rose-window watermark), which would clip this popover down to the
         header's own 74px height. Anchored instead with fixed coordinates
         computed from the trigger button's own rect (see computePosition). -->
    <Teleport to="body">
      <Transition name="settings-pop">
        <div
          v-if="open"
          ref="popoverEl"
          class="settings-popover"
          :style="popoverStyle"
          role="dialog"
          aria-modal="false"
          aria-label="Operative seal settings"
        >
          <h3 class="settings-heading">Operative seal</h3>
          <ul class="seal-style-list">
            <li v-for="style in SEAL_STYLES" :key="style.id">
              <button
                type="button"
                class="seal-style-option"
                :class="{ selected: settings.sealStyle === style.id }"
                @click="setSealStyle(style.id)"
              >
                <span class="seal-preview" aria-hidden="true">
                  <span
                    v-for="name in PREVIEW_NAMES"
                    :key="name"
                    class="seal-swatch"
                    v-bind="previewAttrs(style.id, name)"
                  >{{ previewText(style.id, name) }}</span>
                </span>
                <span class="seal-style-copy">
                  <strong>{{ style.name }}</strong>
                  <small>{{ style.blurb }}</small>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { SEAL_STYLES, buildSealMap, sealVars } from '../seals.js';
import { settings, setSealStyle } from '../settings.js';

const open = ref(false);
const rootEl = ref(null);
const triggerEl = ref(null);
const popoverEl = ref(null);
const popoverStyle = ref({});

// Deliberately three same-initial names — this is the whole point of the
// preview: it has to show what the choice actually buys, and "ordinary" vs
// "coloured" vs "coloured + letters" only differ visibly once two operatives
// would otherwise look alike.
const PREVIEW_NAMES = ['Sabine', 'Sevatar', 'Sanguinius'];

function previewMap(styleId) {
  return buildSealMap(PREVIEW_NAMES, styleId);
}
function previewAttrs(styleId, name) {
  const s = previewMap(styleId).get(name);
  return { 'data-seal-kind': s.kind, 'data-seal': s.pattern, class: s.text.length > 1 ? 'seal-mono' : null, style: sealVars(s) };
}
function previewText(styleId, name) {
  return previewMap(styleId).get(name)?.text || '';
}

// Right edge pinned to the trigger button's own right edge (via a `right`
// offset from the viewport, not a `left`) so the popover stays right-aligned
// under the button regardless of its own rendered width.
function computePosition() {
  const btn = triggerEl.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  popoverStyle.value = {
    top: `${rect.bottom + 12}px`,
    right: `${window.innerWidth - rect.right}px`,
  };
}

function toggle() {
  open.value = !open.value;
  if (open.value) nextTick(computePosition);
}
function close() {
  open.value = false;
}
function onDocClick(e) {
  if (!open.value) return;
  // Teleported out of rootEl, so the popover's own subtree has to be
  // checked separately — otherwise every click on a style option would read
  // as "outside" and close the menu before setSealStyle ever fires.
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
.settings-menu {
  position: relative;
  display: inline-flex;
}
.settings-trigger {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #43463d;
  background: #171916;
  color: var(--gold2);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.settings-trigger:hover {
  border-color: var(--gold);
  color: var(--gold2);
  filter: brightness(1.17);
}
.settings-trigger:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.gear-icon {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.settings-popover {
  position: fixed;
  z-index: 20;
  width: min(360px, calc(100vw - 32px));
  background: linear-gradient(145deg, rgba(27, 29, 24, 0.98), rgba(15, 17, 14, 0.98));
  border: 1px solid var(--gold);
  box-shadow: 0 18px 50px #0007;
  padding: 18px;
  border-radius: 2px;
}
.settings-heading {
  margin: 0 0 14px;
  font: 700 13px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--gold2);
}
.seal-style-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.seal-style-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid #34372f;
  background: #0d0f0d;
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  color: var(--pale);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.seal-style-option:hover {
  border-color: rgba(182, 154, 92, 0.45);
}
.seal-style-option:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.seal-style-option.selected {
  border-color: var(--gold);
  background: #1d1b13;
  box-shadow: inset 0 0 0 1px var(--gold);
}
.seal-preview {
  display: flex;
  gap: 5px;
  flex: 0 0 auto;
}
.seal-swatch {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  font: 700 13px Cinzel, serif;
}
.seal-swatch.seal-mono {
  font-size: 9px;
  letter-spacing: 0;
}
.seal-style-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.seal-style-copy strong {
  font: 700 12px Cinzel, serif;
  letter-spacing: 0.04em;
  color: var(--gold2);
}
.seal-style-copy small {
  font-size: 11px;
  line-height: 1.45;
  color: var(--muted);
}

.settings-pop-enter-active,
.settings-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.settings-pop-enter-from,
.settings-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .settings-pop-enter-active,
  .settings-pop-leave-active {
    transition: none;
  }
}
</style>
