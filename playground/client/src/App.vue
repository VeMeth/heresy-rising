<script setup>
// ---------------------------------------------------------------------
// App.vue is the ONLY place that talks to the playground server. Every
// component under ./components is purely presentational: it receives
// props and emits events, and never imports api.js or calls fetch
// itself. If a component needs fresh data, it asks App.vue for it via
// an event; App.vue mutates state by calling the API, then re-fetches
// GET /api/session/:id and hands the new state back down as props.
//
// This file is deliberately "dumb re-fetch after every mutation" rather
// than optimistic/local patching. The playground is a debug tool, not a
// perf-sensitive UI — correctness and simplicity win.
// ---------------------------------------------------------------------

import { ref, reactive, computed, onMounted } from 'vue';
import * as api from './api.js';

import SetupPanel from './components/SetupPanel.vue';   // T7/T8/T9 — built by another agent
import RosterTable from './components/RosterTable.vue'; // T7/T8/T9 — built by another agent
import ActionPanel from './components/ActionPanel.vue'; // T7/T8/T9 — built by another agent
import VotePanel from './components/VotePanel.vue';     // T7/T8/T9 — built by another agent
import TracePanel from './components/TracePanel.vue';   // T7/T8/T9 — built by another agent
import FogView from './components/FogView.vue';         // T7/T8/T9 — built by another agent

// --- global request gate + error banner --------------------------------

const busy = ref(false);
const error = ref(null);

async function run(fn) {
  busy.value = true;
  error.value = null;
  try {
    return await fn();
  } catch (e) {
    error.value = e?.message || String(e);
    return null;
  } finally {
    busy.value = false;
  }
}

function dismissError() {
  error.value = null;
}

// --- static reference data (loaded once) --------------------------------

const roles = ref([]);       // GET /api/roles -> [{id, name, faction, ...}]
const scenarios = ref([]);   // GET /api/scenarios -> [{name, ...}]

// --- session state --------------------------------------------------
//
// Shape of GET /api/session/:id, as consumed here:
//   {
//     id: string,
//     game: { phase, night, day, seed, maxDrift, flags, ... },
//     players: [
//       { code, name, role, faction, drift, alive, crippleTier, flags, ... }
//     ],
//     actions: [ { actorCode, targetCode, variant, data, faction } ],
//     votes: [ { voterCode, choice, justification } ],
//   }
//
// This whole object is treated as omniscient/debug state and rendered
// as-is in the Board column. The Trace column is the one place fog
// (per-seat visibility) is reconstructed, via GET /api/session/:id/view/:code.

const sessionId = ref(null);
const game = ref(null);
const players = ref([]);
const actions = ref([]);
const votes = ref([]);

const hasSession = computed(() => !!sessionId.value);

async function refreshSession() {
  if (!sessionId.value) return;
  const session = await api.getSession(sessionId.value);
  game.value = session.game ?? null;
  players.value = session.players ?? [];
  actions.value = session.actions ?? [];
  votes.value = session.votes ?? [];
}

// --- trace (resolve output) --------------------------------------------

const trace = ref(null);     // most recent Trace, or null before first resolve
const prevTrace = ref(null); // the trace before that, kept around cheaply

// --- fog / "view as" state --------------------------------------------

const selectedFogPlayer = ref(null);
const fogView = ref(null); // GET /api/session/:id/view/:code result, or null

async function refreshFogView() {
  if (!sessionId.value || !selectedFogPlayer.value) {
    fogView.value = null;
    return;
  }
  fogView.value = await api.getView(sessionId.value, selectedFogPlayer.value);
}

function handleSelectFogPlayer(playerCode) {
  selectedFogPlayer.value = playerCode;
  run(refreshFogView);
}

// --- lifecycle ----------------------------------------------------------

onMounted(() => {
  run(async () => {
    const [rolesRes, scenariosRes] = await Promise.all([
      api.getRoles(),
      api.getScenarios(),
    ]);
    roles.value = rolesRes ?? [];
    scenarios.value = scenariosRes ?? [];
  });
});

// --- SetupPanel handlers --------------------------------------------

function handleCreate({ players: rosterPlayers, roster, seed, options }) {
  run(async () => {
    const session = await api.createSession({ players: rosterPlayers, roster, seed, options });
    sessionId.value = session.id;
    trace.value = null;
    prevTrace.value = null;
    selectedFogPlayer.value = null;
    fogView.value = null;
    await refreshSession();
  });
}

function handleSaveScenario(name) {
  run(async () => {
    await api.saveScenario({ name, sessionId: sessionId.value });
    scenarios.value = await api.getScenarios();
  });
}

function handleLoadScenario(name) {
  run(async () => {
    if (sessionId.value) {
      await api.loadScenario(sessionId.value, name);
    }
    await refreshSession();
  });
}

function handleSnapshot(label) {
  run(async () => {
    await api.snapshot(sessionId.value, label);
  });
}

function handleRewind() {
  run(async () => {
    await api.rewind(sessionId.value);
    await refreshSession();
  });
}

function handleExportTest(name) {
  run(async () => {
    await api.exportTest(sessionId.value, name);
  });
}

// --- RosterTable handlers --------------------------------------------

function handleUpdatePlayer({ playerCode, updates }) {
  run(async () => {
    await api.updatePlayer(sessionId.value, playerCode, updates);
    await refreshSession();
  });
}

function handleUpdateGame({ updates }) {
  run(async () => {
    await api.updateGame(sessionId.value, updates);
    await refreshSession();
  });
}

// --- ActionPanel handlers --------------------------------------------

// The engine's submitAction() returns `{kind, targetCode, silent:true}` when a
// crippled actor submits protect/bodyguard/drift-hint/warp-read: the call looks
// accepted but NO hr_actions row is written (heresyGameManager.js:1210). At
// resolve time that is byte-identical to a genuine sleep, so the trace can only
// ever label it `derived-input`. This ack is the one and only moment the drop is
// directly observable — so we keep it, keyed by actor, and hand it to
// ActionPanel. Discarding this response would throw away the evidence for good.
const silentDrops = ref({});

function handleSubmitAction({ actorCode, targetCode, variant, data, faction }) {
  run(async () => {
    const result = await api.submitAction(sessionId.value, { actorCode, targetCode, variant, data, faction });
    if (result && result.silent) {
      silentDrops.value = { ...silentDrops.value, [actorCode]: { kind: result.kind, targetCode: result.targetCode, at: Date.now() } };
    } else {
      const { [actorCode]: _dropped, ...rest } = silentDrops.value;
      silentDrops.value = rest;
    }
    await refreshSession();
  });
}

function handleRetractAction({ actorCode }) {
  run(async () => {
    await api.retractAction(sessionId.value, actorCode);
    const { [actorCode]: _dropped, ...rest } = silentDrops.value;
    silentDrops.value = rest;
    await refreshSession();
  });
}

// --- VotePanel handlers --------------------------------------------

function handleSubmitVote({ voterCode, choice, justification }) {
  run(async () => {
    await api.submitVote(sessionId.value, { voterCode, choice, justification });
    await refreshSession();
  });
}

function handleRetractVote({ voterCode }) {
  run(async () => {
    await api.retractVote(sessionId.value, voterCode);
    await refreshSession();
  });
}

// --- Resolve ----------------------------------------------------------

function handleResolve() {
  run(async () => {
    const result = await api.resolve(sessionId.value);
    prevTrace.value = trace.value;
    trace.value = result;
    await refreshSession();
    if (selectedFogPlayer.value) {
      await refreshFogView();
    }
  });
}
</script>

<template>
  <div class="app-shell">
    <div v-if="error" class="error-banner" role="alert">
      <span class="error-banner__text">{{ error }}</span>
      <button class="error-banner__dismiss" type="button" @click="dismissError">Dismiss</button>
    </div>

    <div class="columns">
      <section class="column column--setup" aria-label="Setup">
        <SetupPanel
          :roles="roles"
          :busy="busy"
          :scenarios="scenarios"
          :session-id="sessionId"
          @create="handleCreate"
          @save-scenario="handleSaveScenario"
          @load-scenario="handleLoadScenario"
          @snapshot="handleSnapshot"
          @rewind="handleRewind"
          @export-test="handleExportTest"
        />
      </section>

      <section class="column column--board" aria-label="Board">
        <template v-if="hasSession">
          <RosterTable
            :players="players"
            :roles="roles"
            :game="game"
            :busy="busy"
            @update-player="handleUpdatePlayer"
            @update-game="handleUpdateGame"
          />
          <ActionPanel
            :players="players"
            :roles="roles"
            :game="game"
            :actions="actions"
            :silent-drops="silentDrops"
            :busy="busy"
            @submit-action="handleSubmitAction"
            @retract-action="handleRetractAction"
          />
          <VotePanel
            :players="players"
            :game="game"
            :votes="votes"
            :busy="busy"
            @submit-vote="handleSubmitVote"
            @retract-vote="handleRetractVote"
          />
          <button
            class="resolve-button"
            type="button"
            :disabled="busy"
            @click="handleResolve"
          >
            Resolve {{ game?.phase === 'day' ? 'day' : 'night' }}
          </button>
        </template>
        <p v-else class="empty-hint">Create a session in the Setup column to begin.</p>
      </section>

      <section class="column column--trace" aria-label="Trace">
        <TracePanel :trace="trace" :players="players" />
        <FogView
          :players="players"
          :view="fogView"
          :selected="selectedFogPlayer"
          @select="handleSelectFogPlayer"
        />
      </section>
    </div>
  </div>
</template>
