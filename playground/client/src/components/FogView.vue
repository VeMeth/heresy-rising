<script setup>
// -----------------------------------------------------------------------
// FogView — presentational only. Renders the "view as seat X" fog state
// App.vue fetches from GET /api/session/:id/view/:code; never calls the
// API itself. Selecting a seat just emits `select` and waits for App.vue
// to hand back a new `view` prop.
//
// Purpose: leak-checking. A dev needs to see, at a glance, exactly what a
// player's real client would show them — including what is deliberately
// withheld. Absence of a fact (no role key, no faction key) must read as
// clearly as its presence, not as a blank cell that looks like a bug.
// -----------------------------------------------------------------------

const props = defineProps({
  players: { type: Array, default: () => [] },
  view: { type: Object, default: null },
  selected: { type: String, default: null },
});

const emit = defineEmits(['select']);

function isHidden(val) {
  return val === undefined || val === null;
}

// Generic [key, value] pairs for sub-objects whose exact shape the
// contract doesn't pin down (me / myAction / votes[] / privateMessages[]).
function entries(obj) {
  return obj && typeof obj === 'object' ? Object.entries(obj) : [];
}

function fmt(val) {
  if (val === undefined) return '—';
  if (val === null) return 'null';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// full playerCode -> shortCode, for spots this view carries a bare code
// string with no player object attached (atRiskTargets) — the `players`
// prop is the full session roster App.vue already holds, which always
// carries shortCode (see api.js buildPlayers()/buildView()).
function shortFor(code) {
  return props.players.find((p) => p.code === code || p.playerCode === code)?.shortCode ?? code;
}
</script>

<template>
  <div class="fog-view">
    <h2>Fog / View as</h2>

    <div class="seat-picker">
      <button
        v-for="p in players"
        :key="p.code"
        type="button"
        class="seat-btn mono"
        :class="{ 'seat-btn--active': p.code === selected }"
        :title="p.code"
        @click="emit('select', p.code)"
      >
        {{ p.shortCode ?? p.code }}
      </button>
      <p v-if="!players.length" class="empty-hint">No players yet.</p>
    </div>

    <p v-if="!view" class="empty-hint">
      Select a seat above to see exactly what that player's client would show.
    </p>

    <template v-else>
      <section class="fog-section">
        <h3>Me</h3>
        <p v-if="!view.me" class="empty-hint">No `me` in this view.</p>
        <div v-else class="kv-grid mono">
          <template v-for="pair in entries(view.me)" :key="pair[0]">
            <span class="text-dim">{{ pair[0] }}</span>
            <span>{{ fmt(pair[1]) }}</span>
          </template>
        </div>
      </section>

      <section class="fog-section">
        <h3>
          Voting
          <span
            class="conf-badge"
            :class="view.votingEnabled ? 'conf-observed' : 'conf-unobservable'"
          >
            {{ view.votingEnabled ? 'enabled' : 'disabled' }}
          </span>
        </h3>
      </section>

      <section class="fog-section">
        <h3>Players ({{ (view.players || []).length }})</h3>
        <table class="fog-players-table">
          <thead>
            <tr>
              <th>code</th>
              <th>name</th>
              <th>alive</th>
              <th>role</th>
              <th>faction</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in view.players || []" :key="p.code">
              <td class="mono" :title="p.code">{{ p.shortCode ?? p.code }}</td>
              <td>{{ p.name }}</td>
              <td>{{ p.alive === false ? 'dead' : 'alive' }}</td>
              <td>
                <span v-if="isHidden(p.role)" class="fog-hidden" title="Not visible to this seat">hidden</span>
                <span v-else>{{ p.role }}</span>
              </td>
              <td>
                <span v-if="isHidden(p.faction)" class="fog-hidden" title="Not visible to this seat">hidden</span>
                <span v-else>{{ p.faction }}</span>
              </td>
            </tr>
            <tr v-if="!(view.players || []).length">
              <td colspan="5" class="empty-hint">No players in this view.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="fog-section">
        <h3>My action</h3>
        <p v-if="!view.myAction" class="empty-hint">No action submitted.</p>
        <div v-else class="kv-grid mono">
          <template v-for="pair in entries(view.myAction)" :key="pair[0]">
            <span class="text-dim">{{ pair[0] }}</span>
            <span>{{ fmt(pair[1]) }}</span>
          </template>
        </div>
      </section>

      <section class="fog-section">
        <h3>Votes ({{ (view.votes || []).length }})</h3>
        <p v-if="!(view.votes || []).length" class="empty-hint">No votes visible.</p>
        <div v-for="(vt, i) in view.votes || []" :key="i" class="kv-grid mono fog-list-item">
          <template v-for="pair in entries(vt)" :key="pair[0]">
            <span class="text-dim">{{ pair[0] }}</span>
            <span>{{ fmt(pair[1]) }}</span>
          </template>
        </div>
      </section>

      <section class="fog-section">
        <h3>Private messages ({{ (view.privateMessages || []).length }})</h3>
        <p v-if="!(view.privateMessages || []).length" class="empty-hint">None.</p>
        <div v-for="(m, i) in view.privateMessages || []" :key="i" class="kv-grid mono fog-list-item">
          <template v-for="pair in entries(m)" :key="pair[0]">
            <span class="text-dim">{{ pair[0] }}</span>
            <span>{{ fmt(pair[1]) }}</span>
          </template>
        </div>
      </section>

      <section class="fog-section">
        <h3>At-risk targets</h3>
        <p v-if="!(view.atRiskTargets || []).length" class="empty-hint">None visible.</p>
        <div v-else class="chip-row">
          <span v-for="code in view.atRiskTargets" :key="code" class="mono chip" :title="code">{{ shortFor(code) }}</span>
        </div>
      </section>

      <p class="fog-note">
        <code>drift</code> is redacted entirely for a seat's own view — not rendered here by design.
      </p>
    </template>
  </div>
</template>

<style scoped>
.fog-view {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.text-dim {
  color: var(--text-dim);
}

.seat-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.seat-btn {
  font-size: 11px;
  padding: 0.2rem 0.5rem;
}

.seat-btn--active {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--bg);
}

.fog-section h3 {
  margin: 0 0 0.3rem;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.kv-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.6rem;
  font-size: 12px;
}

.fog-list-item {
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  padding: 0.3rem 0.5rem;
  margin-bottom: 0.25rem;
  background: var(--bg-panel-alt);
}

.fog-players-table {
  font-size: 12px;
}

.fog-hidden {
  color: var(--text-faint);
  font-style: italic;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.chip {
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.05rem 0.4rem;
  font-size: 11px;
  color: var(--text-dim);
}

.fog-note {
  color: var(--text-faint);
  font-size: 11px;
  font-style: italic;
  margin: 0.2rem 0 0;
}
</style>
