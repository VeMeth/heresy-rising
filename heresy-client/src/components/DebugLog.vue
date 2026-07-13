<template>
  <div class="debug-log">
    <button class="copy-btn" @click="copyLog">📋 Copy Log</button>
    <div class="log-content" ref="logContent">
      <div v-for="(entry, i) in history" :key="i" class="log-entry">
        {{ formatEntry(entry) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, watch } from 'vue';

const history = ref([]);
const logContent = ref(null);
const socket = inject('socket');
const room = inject('room');

// Build a human-readable dump of the structured card-event log so a player
// can paste the entire session (history + every card movement) into chat for
// the operator to verify all interactions.
function formatCardEvent(e) {
  const t = new Date(e.t).toISOString().slice(11, 23);
  const who = e.playerName || e.thiefName || e.fromName || e.heroId || '-';
  let line = `[${t}] [${e.kind}] ${who}`;
  if (e.card?.name) line += ` card=${e.card.name}(${e.card.id})`;
  if (e.cards && e.cards.length) {
    const names = e.cards.map(c => `${c.name}(${c.id})`).join(',');
    line += ` cards=[${names}]`;
  }
  if (e.count) line += ` count=${e.count}`;
  if (e.reason) line += ` reason=${e.reason}`;
  if (e.phase) line += ` phase=${e.phase}`;
  if (e.from) line += ` from=${e.from}`;
  if (e.to) line += ` to=${e.to}`;
  if (e.remainingDeck !== undefined) line += ` remainingDeck=${e.remainingDeck}`;
  if (e.handSize !== undefined) line += ` handSize=${e.handSize}`;
  if (e.hero) line += ` hero=${e.hero}`;
  if (e.secondHero) line += ` secondHero=${e.secondHero}`;
  if (e.mode) line += ` mode=${e.mode}`;
  if (e.targetCard?.name) line += ` target=${e.targetCard.name}`;
  if (e.symbolsRemainingBefore) line += ` symbolsRemainingBefore=[${e.symbolsRemainingBefore.join(',')}]`;
  if (e.victimName) line += ` victim=${e.victimName}`;
  if (e.thiefName) line += ` thief=${e.thiefName}`;
  if (e.toName) line += ` toPlayer=${e.toName}`;
  if (e.pile) line += ` pile=${e.pile}`;
  if (e.recycled) line += ` recycled=${e.recycled}`;
  // Ability fields
  if (e.ability) line += ` ability=${e.ability}`;
  if (e.cost) line += ` cost=${e.cost}`;
  if (e.discardedCards) line += ` discarded=[${e.discardedCards.map(c => c.name).join(',')}]`;
  // Dungeon / boss lifecycle fields
  if (e.dungeon) line += ` dungeon=${e.dungeon}`;
  if (e.bossId) line += ` bossId=${e.bossId}`;
  if (e.bossName) line += ` bossName=${e.bossName}`;
  if (e.bossNumber) line += ` bossNumber=${e.bossNumber}`;
  if (e.cardId) line += ` cardId=${e.cardId}`;
  if (e.cardType) line += ` cardType=${e.cardType}`;
  if (e.cardSubtype) line += ` cardSubtype=${e.cardSubtype}`;
  if (e.symbolCount) line += ` symbols=${e.symbolCount}`;
  if (e.cardName && !e.card?.name) line += ` cardName=${e.cardName}`;
  if (e.eventName) line += ` event=${e.eventName}`;
  if (e.effect) line += ` effect=${e.effect}`;
  if (e.pausedBy) line += ` pausedBy=${e.pausedBy}`;
  if (e.wasPausedBy) line += ` wasPausedBy=${e.wasPausedBy}`;
  if (e.isHost !== undefined) line += ` isHost=${e.isHost}`;
  if (e.slot) line += ` slot=${e.slot}`;
  if (e.roomCode) line += ` room=${e.roomCode}`;
  if (e.startingDungeon !== undefined) line += ` startingDungeon=${e.startingDungeon}`;
  if (e.isTwoPlayerMode !== undefined) line += ` 2p=${e.isTwoPlayerMode}`;
  if (e.playerCount !== undefined) line += ` players=${e.playerCount}`;
  if (e.deckSize) line += ` deckSize=${e.deckSize}`;
  if (e.deckComposition) line += ` deck=[${e.deckComposition.map(c => c.name).join(',')}]`;
  if (e.team) line += ` team=[${e.team.map(p => p.name).join(',')}]`;
  if (e.bossesDefeated !== undefined) line += ` bossesDefeated=${e.bossesDefeated}`;
  if (e.reason) line += ` reason=${e.reason}`;
  if (e.cardsPlayed) line += ` cardsPlayed=${e.cardsPlayed}`;
  return line;
}

// Fetch the detailed card-event log from the server and copy it to the
// clipboard alongside the rendered history. This is the primary way a player
// feeds the operator a full session trace for verification.
function copyLog() {
  if (!socket) return;
  socket.emit('debug:get-log', {}, (res) => {
    if (!res || !res.ok) {
      console.error('Failed to fetch debug log:', res?.error);
      return;
    }
    const d = res.data;
    const header = [
      `# Heresy Rising full debug log`,
      `# room:    ${d.roomCode}`,
      `# players: ${d.players.map(p => `${p.name}(${p.hero}${p.secondHero ? '+' + p.secondHero : ''})`).join(', ')}`,
      `# card events: ${d.log.length}  |  history events: ${(d.history || []).length}`,
      `# generated: ${new Date().toISOString()}`,
      ``
    ].join('\n');

    const historySection = d.history && d.history.length
      ? `# --- Game history (${d.history.length} events) ---\n${d.history.map(formatEntry).join('\n')}\n\n`
      : `# --- Game history ---
(no history entries)\n\n`;

    const cardSection = `# --- Card / game-event log (${d.log.length} entries) ---\n${d.log.map(formatCardEvent).join('\n')}\n`;

    navigator.clipboard.writeText(header + historySection + cardSection);
  });
}

// Format a single history entry with children for context
function formatEntry(entry, depth = 0) {
  const indent = '  '.repeat(depth);
  const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
  let line = `${indent}[${timestamp}]`;

  if (entry.prefix) { line += ` ${entry.prefix}`; }
  if (entry.cardName) { line += ` ${entry.cardName}`; }
  if (entry.message) { line += ` ${entry.message}`; }

  if (entry.children && entry.children.length > 0) {
    for (const child of entry.children) {
      line += '\n' + formatEntry(child, depth + 1);
    }
  }

  return line;
}

// Keep displayed history live — room.history is a reactive array updated in-place
watch(() => room.value?.history, (h) => {
  if (h) history.value = [...h];
}, { deep: true, immediate: true });
</script>

<style scoped>
.debug-log {
  position: fixed;
  bottom: 10px;
  left: 10px;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 8px;
  padding: 8px;
  max-width: 300px;
  max-height: 200px;
  overflow-y: auto;
}

.copy-btn {
  background: #4a5568;
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  margin-bottom: 4px;
}

.copy-btn:hover {
  background: #2d3748;
}

.log-content {
  font-size: 10px;
  color: #a0aec0;
  font-family: monospace;
}

.log-entry {
  padding: 2px 0;
  border-bottom: 1px solid #2d3748;
}

@media (max-width: 768px) {
  .copy-btn {
    display: none;
  }
  .debug-log {
    display: none;
  }
}
</style>
