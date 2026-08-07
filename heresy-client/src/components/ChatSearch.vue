<template>
  <Teleport to="body">
    <div v-if="open" class="search-backdrop" @click="emit('close')">
      <div
        class="search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search the vox"
        @click.stop
      >
        <header class="search-head">
          <div>
            <span class="eyebrow">Vox Search</span>
            <h2>SEARCH THE VOX</h2>
          </div>
          <button class="ghost search-close" type="button" aria-label="Close search" @click="emit('close')">&times;</button>
        </header>

        <div class="search-query-row">
          <input
            ref="queryInput"
            v-model="query"
            type="search"
            maxlength="200"
            class="search-query-input"
            placeholder="Search the vox&hellip;"
            aria-label="Search query"
          />
          <span class="search-count">{{ resultCountLabel }}</span>
        </div>

        <div v-if="hasAnyFilterControl" class="search-filter-row">
          <select v-if="showAuthorFilter" v-model="authorFilter" class="search-select" aria-label="Filter by author">
            <option value="">All Authors</option>
            <option v-for="a in authorOptions" :key="a" :value="a">{{ a }}</option>
          </select>
          <select v-if="showDayFilter" v-model="dayFilter" class="search-select" aria-label="Filter by day">
            <option value="">All Days</option>
            <option v-for="r in dayOptions" :key="r" :value="r">Day {{ r }}</option>
          </select>
          <select v-if="showChannelFilter" v-model="channelFilter" class="search-select" aria-label="Filter by channel">
            <option value="">All Channels</option>
            <option v-for="c in channelOptions" :key="c" :value="c">{{ channelLabel(c) }}</option>
          </select>
          <div v-if="showKindChips" class="search-chip-row">
            <button
              v-for="k in availableKinds"
              :key="k.key"
              type="button"
              class="search-chip"
              :class="{ active: isKindOn(k.key) }"
              @click="toggleKind(k.key)"
            >{{ k.label }}</button>
          </div>
          <button
            v-if="showBookmarkChip"
            type="button"
            class="search-chip"
            :class="{ active: bookmarkedOnly }"
            @click="bookmarkedOnly = !bookmarkedOnly"
          >Bookmarked</button>
          <button v-if="hasActiveFilters" type="button" class="ghost search-clear" @click="clearFilters">Clear</button>
        </div>

        <div class="search-body">
          <p v-if="busy" class="empty-state">Indexing the vox&hellip;</p>
          <p v-else-if="!showResults" class="empty-state">Type at least 2 characters, or choose a filter, to search the vox.</p>
          <p v-else-if="!displayed.length" class="empty-state">No hits found{{ hasActiveFilters ? ' — try widening the filters.' : ' for that term.' }}</p>
          <template v-else>
            <ul class="search-results">
              <li v-for="(m, i) in displayed" :key="m.id">
                <button
                  type="button"
                  class="search-hit-row"
                  :class="{ active: i === activeIndex }"
                  :ref="el => setRowRef(el, i)"
                  @click="jumpTo(m)"
                  @mouseenter="activeIndex = i"
                >
                  <span class="search-hit-head">
                    <strong>{{ m.author }}</strong>
                    <span class="search-hit-stamp">{{ stampFor(m) }}</span>
                    <span class="search-hit-channel">{{ channelLabel(m.channel) }}</span>
                    <time>{{ formatTime(m.createdAt) }}</time>
                  </span>
                  <span class="search-hit-excerpt">
                    <!-- Message bodies are fully player-controlled text. Never use
                         v-html here — rendering the excerpt as real template nodes
                         lets Vue's own text interpolation escape every segment, so
                         there is no HTML-injection sink even for a hostile body. -->
                    <template v-for="(seg, si) in rowSegments(m)" :key="si">
                      <mark v-if="seg.hit">{{ seg.text }}</mark>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                  </span>
                </button>
              </li>
            </ul>
            <p v-if="fullMatches.length > displayed.length" class="search-more">Showing {{ displayed.length }} of {{ fullMatches.length }}</p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, reactive, ref, watch } from 'vue';
import { parseQuery, matches, highlightSegments, excerpt, stampFor } from '../chatSearch.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  index: { type: Array, default: () => [] },
  bookmarks: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'jump', 'hits']);

const CHANNEL_LABELS = { public: 'Conclave', faction: 'Cabal', graveyard: 'Graveyard', private: 'Private' };
const CHANNEL_ORDER = ['public', 'faction', 'graveyard', 'private'];
const KIND_META = [
  { key: 'player', label: 'Players' },
  { key: 'system', label: 'Log' },
  { key: 'vote', label: 'Votes' },
  { key: 'admin', label: 'Admin' },
];

function channelLabel(c) { return CHANNEL_LABELS[c] || c; }
function formatTime(t) { return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }

const query = ref('');
const queryInput = ref(null);
const authorFilter = ref('');
const dayFilter = ref('');
const channelFilter = ref('');
const bookmarkedOnly = ref(false);
const kindOff = reactive({});
const activeIndex = ref(0);

const parsedTerms = computed(() => parseQuery(query.value).terms);

// ── Filter option lists — each control only shows up when the index
// actually offers more than one value to pick between. ─────────────────
const authorOptions = computed(() => [...new Set(props.index.map(m => m.author).filter(Boolean))].sort());
const dayOptions = computed(() => [...new Set(props.index.map(m => m.round).filter(r => r != null))].sort((a, b) => a - b));
const channelOptions = computed(() => {
  const present = new Set(props.index.map(m => m.channel));
  return CHANNEL_ORDER.filter(c => present.has(c));
});
const availableKinds = computed(() => KIND_META.filter(k => props.index.some(m => m.kind === k.key)));
const bookmarkIdSet = computed(() => new Set(props.bookmarks.map(b => b.messageId)));
const showBookmarkChip = computed(() => props.bookmarks.length > 0 && props.index.some(m => bookmarkIdSet.value.has(m.id)));

const showAuthorFilter = computed(() => authorOptions.value.length > 1);
const showDayFilter = computed(() => dayOptions.value.length > 1);
const showChannelFilter = computed(() => channelOptions.value.length > 1);
const showKindChips = computed(() => availableKinds.value.length > 1);
const hasAnyFilterControl = computed(() =>
  showAuthorFilter.value || showDayFilter.value || showChannelFilter.value || showKindChips.value || showBookmarkChip.value
);

function isKindOn(key) { return !kindOff[key]; }
function toggleKind(key) { kindOff[key] = !kindOff[key]; }

const hasActiveFilters = computed(() =>
  authorFilter.value !== '' ||
  dayFilter.value !== '' ||
  channelFilter.value !== '' ||
  bookmarkedOnly.value ||
  availableKinds.value.some(k => kindOff[k.key])
);

function clearFilters() {
  authorFilter.value = '';
  dayFilter.value = '';
  channelFilter.value = '';
  bookmarkedOnly.value = false;
  for (const k of Object.keys(kindOff)) delete kindOff[k];
}

// A blank query with no filter engaged would otherwise just render the
// entire chat log — show a hint instead. Any active filter (even with a
// short/blank query) is a deliberate choice, so it's allowed through.
const showResults = computed(() => !props.busy && (query.value.trim().length >= 2 || hasActiveFilters.value));

function passesFilters(m) {
  if (authorFilter.value !== '' && m.author !== authorFilter.value) return false;
  if (dayFilter.value !== '' && m.round !== dayFilter.value) return false;
  if (channelFilter.value !== '' && m.channel !== channelFilter.value) return false;
  if (kindOff[m.kind]) return false;
  if (bookmarkedOnly.value && !bookmarkIdSet.value.has(m.id)) return false;
  return true;
}

const fullMatches = computed(() => {
  if (!showResults.value) return [];
  const terms = parsedTerms.value;
  return props.index.filter(m => passesFilters(m) && matches(m, terms));
});
const sortedMatches = computed(() => [...fullMatches.value].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
const displayed = computed(() => sortedMatches.value.slice(0, 200));

const resultCountLabel = computed(() => {
  if (props.busy || !showResults.value) return '';
  const n = fullMatches.value.length;
  return `${n} hit${n === 1 ? '' : 's'}`;
});

function rowSegments(m) {
  const text = excerpt(m.body || '', parsedTerms.value);
  return highlightSegments(text, parsedTerms.value);
}

watch(displayed, () => { activeIndex.value = 0; });

// The outline shown in the live feed is reserved for an actual search term
// — filters alone customise this panel's list but shouldn't blanket-outline
// the feed on their own. Empty whenever the panel is closed or the query
// is blank, matching the full (uncapped) match set otherwise.
function currentHitIds() {
  if (!props.open || !query.value.trim()) return new Set();
  return new Set(fullMatches.value.map(m => m.id));
}
watch(() => props.open, () => emit('hits', currentHitIds()), { immediate: true });
watch(fullMatches, () => emit('hits', currentHitIds()));
watch(query, () => emit('hits', currentHitIds()));

function jumpTo(m) {
  emit('jump', { messageId: m.id, channel: m.channel });
}

// Row DOM refs for keyboard scroll-into-view. Rebuilt every update since
// v-for indices are the only stable handle we need them by.
let rowEls = [];
onBeforeUpdate(() => { rowEls = []; });
function setRowRef(el, i) { if (el) rowEls[i] = el; }

watch(activeIndex, async (i) => {
  await nextTick();
  rowEls[i]?.scrollIntoView({ block: 'nearest' });
});

// Autofocus the query box on open — same pattern as PlayerDossier.vue.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  activeIndex.value = 0;
  nextTick(() => queryInput.value?.focus());
}, { immediate: true });

function onKeydown(e) {
  if (!props.open) return;
  if (e.key === 'Escape') { emit('close'); return; }
  if (e.key === 'ArrowDown') {
    if (!displayed.value.length) return;
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, displayed.value.length - 1);
    return;
  }
  if (e.key === 'ArrowUp') {
    if (!displayed.value.length) return;
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }
  if (e.key === 'Enter') {
    const row = displayed.value[activeIndex.value];
    if (row) { e.preventDefault(); jumpTo(row); }
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.search-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(6, 7, 6, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: search-fade-in 0.12s ease;
}
@keyframes search-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.search-panel {
  position: relative;
  width: 100%;
  max-width: 720px;
  height: 82vh;
  max-height: 780px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(145deg, rgba(27, 29, 24, 0.98), rgba(15, 17, 14, 0.98));
  border: 1px solid var(--line);
  box-shadow: 0 24px 80px #0008;
}

.search-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--line);
}
.search-head h2 {
  font: 700 18px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 4px 0 0;
  color: var(--pale);
}
.search-close {
  padding: 4px 10px;
  font-size: 16px;
  line-height: 1;
}

.search-query-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--line);
}
.search-query-input {
  flex: 1;
  min-width: 0;
  background: #0d0f0d;
  border: 1px solid #3a3c34;
  color: var(--pale);
  padding: 10px 12px;
  font: 500 14px Inter, sans-serif;
  border-radius: 2px;
  outline: none;
}
.search-query-input:focus { border-color: var(--gold); }
.search-count {
  flex: none;
  font: 700 10px Cinzel, serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold);
  white-space: nowrap;
}

.search-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: #0e100e;
}
/* style.css sets a global `input,select,textarea{width:100%}`. Scoped rules
   out-specify it, but this one never set `width`, so the selects each claimed
   a full row and the filter row stacked instead of sitting inline. Reset the
   width and let flex-basis do the sizing — they share a row on desktop and
   wrap to their own lines only when the panel is genuinely too narrow. */
.search-select {
  flex: 1 1 130px;
  width: auto;
  min-width: 110px;
  background: #0d0f0d;
  border: 1px solid #3a3c34;
  color: var(--pale);
  font: 500 11px Inter, sans-serif;
  padding: 7px 8px;
  border-radius: 2px;
  outline: none;
}
.search-select:focus { border-color: var(--gold); }

.search-chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.search-chip {
  background: #171916;
  border: 1px solid #43463d;
  color: var(--muted);
  font: 700 9px Inter, sans-serif;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 6px 10px;
  border-radius: 2px;
  cursor: pointer;
}
.search-chip:hover { border-color: var(--gold); }
.search-chip.active {
  color: var(--gold2);
  border-color: var(--gold);
  background: #241f10;
}
.search-clear {
  padding: 6px 10px;
  font-size: 9px;
  margin-left: auto;
}

.search-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.search-results {
  list-style: none;
  margin: 0;
  padding: 12px 20px;
  overflow-y: auto;
  flex: 1;
}
.empty-state {
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  padding: 40px 20px;
}

.search-hit-row {
  display: block;
  width: 100%;
  text-align: left;
  background: #1d201b;
  border: 1px solid #2f322b;
  border-left: 2px solid transparent;
  color: #d1cfc4;
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border-radius: 2px;
}
.search-hit-row:hover { border-color: var(--gold); }
.search-hit-row.active {
  border-color: var(--gold);
  border-left-color: var(--gold);
  background: #23261d;
  box-shadow: inset 0 0 0 1px rgba(182, 154, 92, 0.25);
}
.search-hit-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.search-hit-head strong {
  font: 700 11px Inter, sans-serif;
  color: var(--pale);
}
.search-hit-stamp {
  font: 700 9px Cinzel, serif;
  letter-spacing: 0.08em;
  color: var(--gold);
  text-transform: uppercase;
}
.search-hit-channel {
  font: 700 9px Inter, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.search-hit-head time {
  margin-left: auto;
  font-size: 9px;
  color: var(--muted);
}
.search-hit-excerpt {
  display: block;
  margin-top: 6px;
  font: 13px/1.55 Georgia, serif;
  color: #d1cfc4;
  white-space: pre-wrap;
  word-break: break-word;
}
/* Not browser-default yellow — a dark gold wash to match the rest of the
   chrome, with square corners like everything else in this panel. */
.search-hit-excerpt mark {
  background: rgba(182, 154, 92, 0.28);
  color: var(--gold2);
  border-radius: 0;
  padding: 0 1px;
}

.search-more {
  text-align: center;
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 10px 0 4px;
}

@media (prefers-reduced-motion: reduce) {
  .search-backdrop { animation: none; }
}

@media (max-width: 850px) {
  .search-backdrop { padding: 0; }
  .search-panel {
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .search-query-row,
  .search-filter-row {
    padding-left: 16px;
    padding-right: 16px;
  }
  .search-results {
    padding-left: 14px;
    padding-right: 14px;
  }
}
</style>
