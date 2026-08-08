<script setup>
// -----------------------------------------------------------------------
// TracePanel — presentational only. Renders the Trace object App.vue
// hands down after a resolve; never calls the API.
//
// The engine has no instrumentation, so everything below is a
// reconstruction from side channels. The single most important job of
// this panel is to keep that reconstruction legible: a developer must
// never mistake a `derived-*` re-derivation for something the engine
// actually said. See style.css for the shared --conf-* / .conf-badge
// vocabulary this panel draws on for every confidence-carrying fact.
// -----------------------------------------------------------------------

import { ref, computed, watch } from 'vue';

const props = defineProps({
  trace: { type: Object, default: null },
  // Full session roster, so codes appearing inside the trace (actorCode,
  // playerCode, drift-ledger keys...) can be shortened for display the same
  // way the rest of the board does. trace.js never touches player codes
  // itself — this panel resolves them client-side against props.players,
  // the roster App.vue already holds, rather than growing the trace payload
  // with a redundant lookup table.
  players: { type: Array, default: () => [] },
});

// full playerCode -> shortCode ('p1', 'p3', ...), built once per roster
// change. Falls back to the raw code for anything not found (e.g. a code
// referenced in trace data that isn't in the current roster snapshot).
const shortCodeByCode = computed(() => {
  const m = new Map();
  for (const p of props.players || []) {
    const full = p.playerCode ?? p.code;
    if (full) m.set(full, p.shortCode ?? full);
  }
  return m;
});

function short(code) {
  if (code === null || code === undefined) return code;
  return shortCodeByCode.value.get(code) ?? code;
}

// Free-text fields (station notes, action/drift `why` prose, station-0's
// reconstructed inputs) interpolate full player codes straight into a
// sentence — e.g. "f4843666-...-p2 died with death_cause=murder and is the
// bodyguard of the named target f4843666-...-p1". `short()` only handles a
// value that IS a code; this handles a string that CONTAINS one or more.
// Built as a single alternation over every code in the current roster so a
// whole paragraph shortens in one pass, applied only where free text is
// rendered (never to evidence-chip tooltips or the raw stream table, which
// stay byte-true to the underlying data on purpose).
const codeMatcher = computed(() => {
  const codes = [...shortCodeByCode.value.keys()];
  if (!codes.length) return null;
  const escaped = codes.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'g');
});

function shortenText(text) {
  if (typeof text !== 'string') return text;
  const re = codeMatcher.value;
  if (!re) return text;
  return text.replace(re, (m) => shortCodeByCode.value.get(m) ?? m);
}

// --- collapse state -----------------------------------------------------
// Stations/actions/drift rows are individually collapsible. State resets
// whenever a new trace arrives (fresh resolve), with stations that ran or
// carry evidence starting expanded, everything else starting collapsed.

const expandedStations = ref(new Set());
const expandedActions = ref(new Set());
const expandedDrift = ref(new Set());
const streamOpen = ref(false);

watch(
  () => props.trace,
  (t) => {
    streamOpen.value = false;
    expandedActions.value = new Set();
    expandedDrift.value = new Set();
    const next = new Set();
    if (t && Array.isArray(t.stations)) {
      t.stations.forEach((s, i) => {
        if (s.ran || (s.evidence && s.evidence.length)) next.add(i);
      });
    }
    expandedStations.value = next;
  },
  { immediate: true },
);

function toggleStation(i) {
  const next = new Set(expandedStations.value);
  next.has(i) ? next.delete(i) : next.add(i);
  expandedStations.value = next;
}

function toggleAction(i) {
  const next = new Set(expandedActions.value);
  next.has(i) ? next.delete(i) : next.add(i);
  expandedActions.value = next;
}

function toggleDrift(code) {
  const next = new Set(expandedDrift.value);
  next.has(code) ? next.delete(code) : next.add(code);
  expandedDrift.value = next;
}

// --- derived helpers ------------------------------------------------------

function streamEntry(idx) {
  return props.trace?.stream?.[idx] ?? null;
}

// Renders whatever src-specific fields a stream entry carries
// (type/payload, body/meta, value, ...) without hardcoding every src kind.
function payloadOf(entry) {
  if (!entry) return '';
  const known = new Set(['seq', 'src', 'station', 'confidence']);
  const rest = {};
  for (const k of Object.keys(entry)) {
    if (!known.has(k)) rest[k] = entry[k];
  }
  return JSON.stringify(rest);
}

const driftEntries = computed(() => {
  if (!props.trace?.drift) return [];
  return Object.entries(props.trace.drift).map(([code, d]) => ({ code, ...d }));
});

const integrity = computed(() => props.trace?.integrity ?? null);

function verdictClass(v) {
  switch (v) {
    case 'landed':
      return 'verdict--landed';
    case 'blocked-by-trap':
    case 'redirected-to-bodyguard':
    case 'absorbed-by-protect':
      return 'verdict--intercepted';
    case 'gated-by-drift':
    case 'silent-crippled':
      return 'verdict--suppressed';
    case 'no-op':
      return 'verdict--noop';
    default:
      return 'verdict--unknown';
  }
}
</script>

<template>
  <div class="trace-panel">
    <h2>Trace</h2>

    <p v-if="!trace" class="empty-hint">
      No resolution yet. Trace appears here after Resolve.
    </p>

    <template v-else>
      <div class="trace-meta mono">
        {{ trace.label }} · {{ trace.gameCode }} · {{ trace.phaseResolved }} round
        {{ trace.round }} · {{ trace.durationMs }}ms · contract
        {{ trace.engineContractHash }}
      </div>

      <!-- Integrity -->
      <div
        v-if="integrity"
        class="integrity-banner"
        :class="integrity.ok ? 'integrity--ok' : 'integrity--bad'"
      >
        <div class="integrity-banner__head">
          <strong>{{ integrity.ok ? 'Integrity OK' : 'INTEGRITY VIOLATION' }}</strong>
          <span class="integrity-flags mono">
            monotonic:{{ integrity.monotonic }} · streamComplete:{{ integrity.streamComplete }}
            · verdictsAgreeWithRows:{{ integrity.verdictsAgreeWithRows }}
          </span>
        </div>
        <ul v-if="!integrity.ok && integrity.violations?.length" class="integrity-violations">
          <li v-for="(v, i) in integrity.violations" :key="i" class="mono">
            [{{ v.kind }}] seq {{ v.seq }} — {{ v.detail }}
          </li>
        </ul>
      </div>
      <div
        v-if="integrity && integrity.contractHashMatches === false"
        class="integrity-banner integrity--warn"
      >
        <strong>Engine contract hash changed</strong> — this trace's derivation
        logic was not validated against the current engine. Treat every
        derived claim below as suspect.
      </div>

      <!-- Deaths -->
      <section class="trace-section">
        <h3>Deaths</h3>
        <p v-if="!trace.deaths?.length" class="empty-hint">No deaths this resolution.</p>
        <ul v-else class="deaths-list">
          <li v-for="(d, i) in trace.deaths" :key="i">
            <span class="mono player-code" :title="d.playerCode">{{ short(d.playerCode) }}</span>
            — {{ d.cause }}
            <span class="text-dim">· station {{ d.station }}</span>
            <span v-if="d.attributedTo" class="text-dim" :title="d.attributedTo">· by {{ short(d.attributedTo) }}</span>
            <span class="conf-badge" :class="'conf-' + d.confidence">{{ d.confidence }}</span>
          </li>
        </ul>
      </section>

      <!-- Stations -->
      <section class="trace-section">
        <h3>Stations</h3>
        <div
          v-for="(s, i) in trace.stations"
          :key="s.n ?? i"
          class="station"
          :class="{
            'station--quiet': !s.ran && !(s.evidence && s.evidence.length),
            'station--inputs': s.n === 0,
          }"
        >
          <button type="button" class="station__head" @click="toggleStation(i)">
            <span class="station__caret">{{ expandedStations.has(i) ? '▾' : '▸' }}</span>
            <span class="mono station__n">{{ s.n }}</span>
            <span class="station__name">{{ s.name }}</span>
            <span v-if="s.n === 0" class="station__badge">reconstructed inputs</span>
            <span v-if="!s.ran" class="text-faint">did not run</span>
            <span v-else class="text-dim">{{ (s.evidence || []).length }} evidence</span>
          </button>

          <div v-if="expandedStations.has(i)" class="station__body">
            <div v-if="s.inputs && Object.keys(s.inputs).length" class="station__inputs">
              <div v-for="(val, key) in s.inputs" :key="key" class="mono kv">
                <span class="text-dim">{{ key }}</span>:
                <span>{{ shortenText(typeof val === 'object' && val !== null ? JSON.stringify(val) : val) }}</span>
              </div>
            </div>

            <ul v-if="s.notes?.length" class="station__notes">
              <li v-for="(n, ni) in s.notes" :key="ni">{{ shortenText(n) }}</li>
            </ul>

            <ul v-if="s.unobserved?.length" class="station__unobserved">
              <li v-for="(u, ui) in s.unobserved" :key="ui">
                <span class="conf-badge conf-unobservable">unobservable</span>
                <span class="conf-unobservable">{{ u }}</span>
              </li>
            </ul>

            <div v-if="s.evidence?.length" class="station__evidence">
              <span class="text-dim">evidence:</span>
              <span
                v-for="idx in s.evidence"
                :key="idx"
                class="mono evidence-chip"
                :title="payloadOf(streamEntry(idx))"
              >
                #{{ idx }} {{ streamEntry(idx)?.src }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Actions -->
      <section class="trace-section">
        <h3>Actions</h3>
        <p v-if="!trace.actions?.length" class="empty-hint">No actions this resolution.</p>
        <table v-else class="actions-table">
          <thead>
            <tr>
              <th>Actor</th>
              <th>Verb</th>
              <th>Target</th>
              <th>Verdict</th>
              <th>Conf</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(a, i) in trace.actions" :key="i">
              <tr
                class="action-row"
                :class="{ 'action-row--mismatch': a.mismatch }"
                @click="toggleAction(i)"
              >
                <td class="mono">
                  {{ a.actorName || short(a.actorCode) }}
                  <span class="text-faint" :title="a.actorCode">{{ short(a.actorCode) }}</span>
                </td>
                <td>
                  {{ a.kind }}<span v-if="a.variant" class="text-dim">/{{ a.variant }}</span>
                </td>
                <td class="mono">
                  <span :title="a.targetCode">{{ short(a.targetCode) }}</span>
                  <span
                    v-if="a.effectiveVictim && a.effectiveVictim !== a.targetCode"
                    class="text-warn"
                    :title="a.effectiveVictim"
                  >
                    → actually {{ short(a.effectiveVictim) }}
                  </span>
                </td>
                <td>
                  <span class="verdict-chip" :class="verdictClass(a.verdict)">{{ a.verdict }}</span>
                </td>
                <td>
                  <span class="conf-badge" :class="'conf-' + a.confidence">{{ a.confidence }}</span>
                </td>
                <td class="text-faint">{{ expandedActions.has(i) ? '▾' : '▸' }}</td>
              </tr>
              <tr v-if="a.mismatch" class="action-mismatch-row">
                <td colspan="6">
                  ⚠ MISMATCH — derived verdict disagreed with the row diff: {{ a.mismatch }}
                </td>
              </tr>
              <tr v-if="expandedActions.has(i)" class="action-detail-row">
                <td colspan="6">
                  <div v-if="a.why" class="mono">{{ shortenText(a.why) }}</div>
                  <div v-if="a.trapScope" class="text-dim">trapScope: {{ a.trapScope }}</div>
                  <div v-if="a.driftCharged?.length" class="text-dim">
                    drift:
                    <span v-for="(dc, di) in a.driftCharged" :key="di" class="mono drift-chip">
                      {{ dc.delta > 0 ? '+' : '' }}{{ dc.delta }} ({{ dc.reason }})
                    </span>
                  </div>
                  <div v-if="a.evidence?.length" class="text-dim mono">
                    evidence: #{{ a.evidence.join(', #') }}
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <!-- Drift ledger -->
      <section class="trace-section">
        <h3>Drift</h3>
        <p v-if="!driftEntries.length" class="empty-hint">No drift changes this resolution.</p>
        <div v-for="d in driftEntries" :key="d.code" class="drift-row">
          <button type="button" class="drift-row__head" @click="toggleDrift(d.code)">
            <span class="mono" :title="d.code">{{ short(d.code) }}</span>
            <span class="mono num">{{ d.before }} → {{ d.after }}</span>
            <span class="mono num" :class="d.net >= 0 ? 'text-warn' : 'text-ok'">
              ({{ d.net >= 0 ? '+' : '' }}{{ d.net }})
            </span>
            <span class="text-dim">zone {{ d.zoneBefore }} → {{ d.zoneAfter }}</span>
            <span v-if="d.clamped" class="clamped-flag" title="A clamp ate into a real delta — summing this player's listed deltas will NOT reproduce the before→after change shown here. Expand for which delta(s).">
              CLAMPED
            </span>
          </button>
          <div v-if="expandedDrift.has(d.code)" class="drift-row__body">
            <div v-for="(delta, di) in d.deltas" :key="di" class="mono drift-delta">
              seq {{ delta.seq }} · station {{ delta.station }} ·
              <span :class="delta.delta >= 0 ? 'text-warn' : 'text-ok'">
                {{ delta.delta >= 0 ? '+' : '' }}{{ delta.delta }}
              </span>
              ({{ delta.before }}→{{ delta.after }}) — {{ delta.reason }}
              <span class="conf-badge" :class="'conf-' + delta.confidence">{{ delta.confidence }}</span>
              <span
                v-if="delta.clamped"
                class="clamped-flag clamped-flag--inline"
                title="This individual delta hit the 0/max bound — before/after shown here already reflects the clamp."
              >
                clamped
              </span>
            </div>
            <div v-if="d.zoneCrossings?.length" class="text-dim">
              zone crossings:
              <span v-for="(zc, zi) in d.zoneCrossings" :key="zi" class="mono">
                seq{{ zc.seq }} {{ zc.from }}→{{ zc.to }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Raw stream -->
      <section class="trace-section">
        <button type="button" class="stream-toggle" @click="streamOpen = !streamOpen">
          {{ streamOpen ? '▾' : '▸' }} Raw stream ({{ trace.stream?.length || 0 }})
        </button>
        <table v-if="streamOpen" class="stream-table mono">
          <thead>
            <tr>
              <th>seq</th>
              <th>src</th>
              <th>station</th>
              <th>conf</th>
              <th>payload</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in trace.stream" :key="i">
              <td class="num">{{ e.seq }}</td>
              <td>{{ e.src }}</td>
              <td>{{ e.station }}</td>
              <td><span class="conf-badge" :class="'conf-' + e.confidence">{{ e.confidence }}</span></td>
              <td class="stream-payload">{{ payloadOf(e) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.trace-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.trace-meta {
  color: var(--text-dim);
  font-size: 11px;
  word-break: break-all;
}

.text-dim {
  color: var(--text-dim);
}

.text-faint {
  color: var(--text-faint);
}

.text-warn {
  color: var(--warn);
}

.text-ok {
  color: var(--ok);
}

/* --- integrity ------------------------------------------------------- */

.integrity-banner {
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0.5rem 0.65rem;
  font-size: 12px;
}

.integrity--ok {
  border-color: var(--ok);
  background: var(--ok-bg);
  color: var(--ok);
}

.integrity--bad {
  border-color: var(--bad);
  background: var(--bad-bg);
  color: var(--bad);
  font-weight: 600;
}

.integrity--warn {
  border-color: var(--warn);
  background: var(--warn-bg);
  color: var(--warn);
}

.integrity-banner__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.integrity-flags {
  font-size: 10px;
  color: inherit;
  opacity: 0.85;
}

.integrity-violations {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
  font-size: 11px;
}

/* --- sections ---------------------------------------------------------- */

.trace-section h3 {
  margin: 0 0 0.4rem;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
}

.deaths-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 12px;
}

.deaths-list li {
  margin-bottom: 0.2rem;
}

.player-code {
  color: var(--accent);
}

/* --- stations ---------------------------------------------------------- */

.station {
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--border);
  border-radius: 2px;
  margin-bottom: 0.3rem;
  background: var(--bg-panel-alt);
}

.station--quiet {
  opacity: 0.55;
}

.station--inputs {
  border-left-color: var(--accent-dim);
}

.station__head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: none;
  padding: 0.35rem 0.55rem;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.station__head:hover {
  background: var(--bg-raised);
}

.station__caret {
  color: var(--text-faint);
  width: 0.8em;
}

.station__n {
  color: var(--text-faint);
  min-width: 1.4em;
}

.station__name {
  flex: 1;
}

.station__badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--accent);
  border: 1px solid var(--accent-dim);
  border-radius: 2px;
  padding: 0.05rem 0.35rem;
}

.station__body {
  padding: 0.4rem 0.6rem 0.6rem 1.3rem;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.station__inputs {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.station__notes,
.station__unobserved {
  margin: 0;
  padding-left: 1.1rem;
}

.station__unobserved li {
  font-style: italic;
  color: var(--conf-unobservable);
  list-style: none;
  margin-left: -1.1rem;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.station__evidence {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  font-size: 11px;
}

.evidence-chip {
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.05rem 0.35rem;
  color: var(--text-dim);
}

/* --- actions table ------------------------------------------------------ */

.actions-table {
  font-size: 12px;
}

.action-row {
  cursor: pointer;
}

.action-row:hover {
  background: var(--bg-raised);
}

.action-row--mismatch {
  outline: 1px solid var(--bad);
}

.action-mismatch-row td {
  color: var(--bad);
  background: var(--bad-bg);
  font-weight: 600;
  white-space: normal;
}

.action-detail-row td {
  background: var(--bg-panel-alt);
  white-space: normal;
  padding: 0.5rem 0.75rem;
}

.drift-chip {
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0 0.3rem;
  margin-right: 0.25rem;
}

.verdict-chip {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 0.05rem 0.4rem;
  border-radius: 2px;
  border: 1px solid currentColor;
}

.verdict--landed {
  color: var(--ok);
}

.verdict--intercepted {
  color: var(--accent);
}

.verdict--suppressed {
  color: var(--warn);
}

.verdict--noop {
  color: var(--text-faint);
}

.verdict--unknown {
  color: var(--bad);
}

/* --- drift ledger --------------------------------------------------- */

.drift-row {
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  margin-bottom: 0.3rem;
  background: var(--bg-panel-alt);
}

.drift-row__head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: transparent;
  border: none;
  padding: 0.35rem 0.55rem;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.drift-row__head:hover {
  background: var(--bg-raised);
}

.clamped-flag {
  font-size: 10px;
  color: var(--warn);
  border: 1px dashed var(--warn);
  border-radius: 2px;
  padding: 0 0.3rem;
}

.clamped-flag--inline {
  margin-left: 0.35rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.drift-row__body {
  padding: 0.3rem 0.6rem 0.5rem 1.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 11px;
}

/* --- raw stream ------------------------------------------------------ */

.stream-toggle {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.stream-table {
  margin-top: 0.4rem;
  font-size: 11px;
}

.stream-payload {
  white-space: normal;
  word-break: break-all;
  color: var(--text-dim);
}
</style>
