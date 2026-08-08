<script setup>
// Presentational only — see ActionPanel.vue's header comment for the same
// rule. This panel never calls the API; App.vue owns submitVote/retractVote.

import { computed, reactive } from 'vue';

const props = defineProps({
  players: { type: Array, default: () => [] },
  game: { type: Object, default: null },
  votes: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['submit-vote', 'retract-vote']);

// game_data/rules.json — day.FIRST_VOTING_ROUND / STAND_DOWN_MAJORITY /
// EXECUTION_THRESHOLD. Mirrored here as display-only constants: this panel
// never resolves a vote, it only tells the developer what the engine would
// compare the tally against. The trace remains the source of truth for what
// actually happens.
const FIRST_VOTING_ROUND = 2;
const STAND_DOWN_MAJORITY = 0.5;
const EXECUTION_THRESHOLD = 0.6;

const livingPlayers = computed(() => (props.players || []).filter(p => p.alive));

const phase = computed(() => props.game?.phase ?? null);
const isDayPhase = computed(() => phase.value === 'day');

// The playground's session game object isn't fully pinned down in this
// component's contract (App.vue's own comment lists `{ phase, night, day,
// seed, maxDrift, flags, ... }`, not a unified `round` like the full
// engine's `g.round`). Day 1/2/3... is tracked by `game.day` there, so
// that's what gets compared against FIRST_VOTING_ROUND; `game.round` is
// read first in case the server that lands ends up exposing a unified
// counter instead.
const currentRound = computed(() => props.game?.round ?? props.game?.day ?? 0);

const votingOpen = computed(() => isDayPhase.value && currentRound.value >= FIRST_VOTING_ROUND);

const closedReason = computed(() => {
  if (!phase.value) return 'No active session.';
  if (!isDayPhase.value) return `Voting only happens during the day phase (current phase: ${phase.value}).`;
  if (currentRound.value < FIRST_VOTING_ROUND) {
    return `Day ${currentRound.value || 1} has no vote — introduce yourselves and observe.`;
  }
  return null;
});

function voteFor(code) {
  return (props.votes || []).find(v => v.voterCode === code) ?? null;
}

function nameFor(code) {
  if (code === 'skip') return 'Skip';
  const p = (props.players || []).find(x => x.code === code);
  return p ? `${p.name} (${p.shortCode ?? p.code})` : code;
}

// --- per-row draft form state ---------------------------------------------

const drafts = reactive({});
function draftFor(code) {
  if (!drafts[code]) drafts[code] = { choice: '', justification: '' };
  return drafts[code];
}

function submit(p) {
  const d = draftFor(p.code);
  if (!d.choice) return;
  emit('submit-vote', {
    voterCode: p.code,
    choice: d.choice,
    justification: d.justification || undefined,
  });
}

function retract(p) {
  emit('retract-vote', { voterCode: p.code });
}

// --- tally / thresholds -----------------------------------------------

const tally = computed(() => {
  const counts = new Map();
  for (const v of props.votes || []) {
    counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
  }
  return counts;
});

const standDownCount = computed(() => tally.value.get('skip') || 0);
const totalVotesCast = computed(() => (props.votes || []).length);

const aliveCount = computed(() => livingPlayers.value.length);
// Strict majority: the smallest integer count that is > half of alive.
const standDownThreshold = computed(() => Math.floor(aliveCount.value / 2) + 1);
const executionThreshold = computed(() => Math.ceil(aliveCount.value * EXECUTION_THRESHOLD));

const candidateTally = computed(() =>
  livingPlayers.value
    .map(p => ({ code: p.code, shortCode: p.shortCode ?? p.code, name: p.name, count: tally.value.get(p.code) || 0 }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count)
);
</script>

<template>
  <div class="vote-panel">
    <h2>Votes — {{ phase ?? 'no session' }}</h2>

    <p v-if="closedReason" class="empty-hint">{{ closedReason }}</p>

    <template v-if="votingOpen">
      <table class="vote-table">
        <thead>
          <tr>
            <th>Seat</th>
            <th>Voter</th>
            <th>Choice</th>
            <th>Justification</th>
            <th>Current</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in livingPlayers" :key="p.code">
            <td class="mono" :title="p.code">{{ p.shortCode ?? p.code }}</td>
            <td>{{ p.name }}</td>
            <td>
              <select v-model="draftFor(p.code).choice" :disabled="busy">
                <option value="" disabled>choice…</option>
                <option value="skip">skip (stand down)</option>
                <option v-for="t in livingPlayers" :key="t.code" :value="t.code">
                  {{ t.name }} ({{ t.shortCode ?? t.code }})
                </option>
              </select>
            </td>
            <td>
              <input
                v-model="draftFor(p.code).justification"
                :disabled="busy"
                class="justification-input"
                placeholder="optional justification"
              />
            </td>
            <td>
              <span v-if="voteFor(p.code)" class="mono">
                {{ nameFor(voteFor(p.code).choice) }}
                <span v-if="voteFor(p.code).justification" class="empty-hint">
                  — {{ voteFor(p.code).justification }}
                </span>
              </span>
              <span v-else class="empty-hint">none</span>
            </td>
            <td>
              <button type="button" :disabled="busy || !draftFor(p.code).choice" @click="submit(p)">
                Submit
              </button>
              <button v-if="voteFor(p.code)" type="button" :disabled="busy" @click="retract(p)">
                Retract
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="tally">
        <h2>Tally</h2>
        <p class="num tabular-nums">
          Stand-down: {{ standDownCount }} / {{ standDownThreshold }} needed
          ({{ aliveCount }} alive, &gt;{{ (STAND_DOWN_MAJORITY * 100).toFixed(0) }}%)
        </p>
        <p class="num tabular-nums">
          Execution threshold: {{ executionThreshold }}
          ({{ aliveCount }} alive, ceil({{ (EXECUTION_THRESHOLD * 100).toFixed(0) }}%))
        </p>
        <p v-if="!totalVotesCast" class="empty-hint">No votes cast yet.</p>
        <ul v-else class="tally-list">
          <li v-for="row in candidateTally" :key="row.code" class="num tabular-nums">
            <span class="mono" :title="row.code">{{ row.shortCode }}</span> {{ row.name }} —
            {{ row.count }} / {{ executionThreshold }}
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vote-table th,
.vote-table td {
  vertical-align: top;
}

.justification-input {
  width: 12rem;
}

.tally {
  margin-top: 0.75rem;
}

.tally-list {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
}

.tally-list li {
  white-space: nowrap;
}
</style>
