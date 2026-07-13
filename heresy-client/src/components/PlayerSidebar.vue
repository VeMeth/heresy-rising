<template>
  <aside
    class="sidebar"
    :class="{
      'mobile-collapsed': phase !== 'lobby' && !targetMode,
      'mobile-target-picker': phase !== 'lobby' && targetMode
    }"
  >
    <header class="sidebar-header">
      <h3>Players ({{ players.length }}/6)</h3>
      <span v-if="me?.isHost" class="host-badge">Host</span>
    </header>

    <ul class="player-list">
      <li
        v-for="player in players"
        :key="player.id"
        :class="{
          you: player.id === youId,
          host: player.isHost,
          ready: player.ready && phase === 'lobby',
          targeting: targetMode,
          selectable: isTargetable(player.id),
          selected: isSelectedTarget(player.id),
          unavailable: targetMode && !isTargetable(player.id)
        }"
        @click="handlePlayerClick(player.id)"
      >
        <div class="player-portrait-row">
          <div
            class="profile-avatar"
            :class="{ 'has-picture': !!profileBadgeSrc(player) }"
            :title="player.preferredAchievement || player.name"
          >
            <img
              v-if="profileBadgeSrc(player)"
              :src="profileBadgeSrc(player)"
              :alt="player.preferredAchievement"
              loading="lazy"
            />
            <span v-else>{{ playerInitial(player) }}</span>
          </div>
          <div v-if="player.hero" class="player-avatar hero-avatar" :style="heroImage(player)" :title="heroName(player.hero)"></div>
          <div v-if="player.secondHero" class="player-avatar hero-avatar second-avatar" :style="secondHeroImage(player)" :title="heroName(player.secondHero)"></div>
        </div>
        <div class="player-info">
          <strong class="player-name">{{ player.name }}</strong>
          <div class="player-details">
            <span v-if="player.hero" class="player-hero" :style="heroLabelStyle(player.hero)">{{ heroName(player.hero) }}</span>
            <span v-else class="player-hero-spacer"></span>
            <span v-if="player.secondHero" class="player-hero second" :style="heroLabelStyle(player.secondHero)">{{ heroName(player.secondHero) }}</span>
            <span v-else-if="phase !== 'lobby'" class="player-hero-spacer"></span>
            <span v-if="player.ready && phase === 'lobby'" class="ready-badge">Ready</span>
          </div>
          <div v-if="phase !== 'lobby'" class="pile-row" aria-label="Card piles">
            <span
              v-for="flight in flyingCardsByPlayer(player.id)"
              :key="flight.id"
              class="flying-card"
              :class="flight.tone"
              :style="flight.style"
              aria-hidden="true"
            ></span>
            <div
              v-for="pile in pileSummaries(player)"
              :key="pile.key"
              class="card-pile"
              :class="[pile.key, pile.state, { active: pileAnimations[`${player.id}:${pile.key}`] }]"
              :title="`${pile.label}: ${pile.count}`"
            >
              <span class="pile-stack" aria-hidden="true">
                <span class="pile-card one"></span>
                <span class="pile-card two"></span>
                <span class="pile-card three"></span>
              </span>
              <span class="pile-meta">
                <span class="pile-label">{{ pile.label }}</span>
                <strong class="pile-count">{{ pile.count }}</strong>
              </span>
              <span v-if="pile.state === 'empty'" class="empty-flash">out</span>
            </div>
          </div>
          <!-- Global Hit Counter -->
          <div v-if="phase !== 'lobby'" class="hit-counter" aria-label="Total hits">
            <span class="hit-total" :title="`Total symbols played: ${getPlayerTotalHits(player.id)}`">
              {{ getPlayerTotalHits(player.id) }} hits
            </span>
          </div>
        </div>
        <button
          v-if="canKickPlayers && player.id !== youId"
          type="button"
          class="kick-btn"
          @click.stop="$emit('kick', player.id)"
        >
          Kick
        </button>
      </li>
    </ul>
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, watch } from 'vue';

const props = defineProps({
  players: {
    type: Array,
    required: true
  },
  youId: {
    type: String,
    required: true
  },
  hostId: {
    type: String,
    required: true
  },
  phase: {
    type: String,
    default: 'lobby'
  },
  targetMode: {
    type: Boolean,
    default: false
  },
  targetPlayerIds: {
    type: Array,
    default: () => []
  },
  selectedTargetPlayerIds: {
    type: Array,
    default: () => []
  },
  playerSymbolTotals: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['kick', 'select-player']);

const me = computed(() => props.players.find(p => p.id === props.youId));
const previousPileCounts = new Map();
const pileAnimations = reactive({});
const flyingCards = reactive([]);
const animationTimers = new Map();
const flightTimers = new Map();
let flightId = 0;

const canKickPlayers = computed(() => {
  return me.value?.isHost && props.phase === 'lobby';
});

const heroes = {
  barbarian: 'Barbarian',
  gladiator: 'Gladiator',
  sorceress: 'Sorceress',
  wizard: 'Wizard',
  paladin: 'Paladin',
  valkyrie: 'Valkyrie',
  huntress: 'Huntress',
  ranger: 'Ranger',
  ninja: 'Ninja',
  thief: 'Thief',
  druid: 'Druid',
  shaman: 'Shaman'
};

const achievementBadges = {
  'First Run': 'First-Run.png',
  'Regular Delver': 'Regular-Delver.png',
  'Dungeon Addict': 'Dungeon-Addict.png',
  'Table Veteran': 'Table-Veteran.png',
  'Five-Minute Menace': 'Five-Minute-Menace.png',
  'Needs A New Hobby': 'Needs-A-New-Hobby.png',
  'Dungeon Fossil': 'Dungeon-Fossil.png',
  'First Win': 'First-Win.png',
  'Winning Habit': 'Winning-Habit.png',
  'Dungeon Cleaner': 'Dungeon Cleaner.png',
  'Boss Farmer': 'Boss-Farmer.png',
  'Legendary Party Member': 'Legendary-Party-Member.png',
  'Unreasonably Competent': 'Unreasonably-Competent.png',
  'Crown Hoarder': 'Crown-Hoarder.png',
  'Card Tosser': 'Card-Tosser.png',
  'Card Machine': 'Card-Machine.png',
  'Deck Grinder': 'Deck-Grinder.png',
  'Card Storm': 'Card-Storm.png',
  'Shuffle Demon': 'Shuffle-Demon.png',
  'Card Singularity': 'Card-Singularity.png',
  'The Whole Deck': 'The-Whole-Deck.png'
};

const heroColors = {
  barbarian: '#f44336',
  gladiator: '#f44336',
  sorceress: '#2196f3',
  wizard: '#2196f3',
  paladin: '#ffc107',
  valkyrie: '#ffc107',
  huntress: '#4caf50',
  ranger: '#4caf50',
  ninja: '#9c27b0',
  thief: '#9c27b0',
  druid: '#8bc34a',
  shaman: '#8bc34a'
};

function heroName(heroId) {
  return heroes[heroId] || 'Unknown';
}

function heroLabelStyle(heroId) {
  const color = heroColors[heroId] || '#c7cdef';
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: `${color}1f`
  };
}

function playerInitial(player) {
  return (player.name || 'P').trim().charAt(0).toUpperCase() || 'P';
}

function profileBadgeSrc(player) {
  const badgeFile = achievementBadges[player.preferredAchievement];
  return badgeFile ? `/badges/${encodeURIComponent(badgeFile)}` : '';
}

function isTargetable(playerId) {
  return props.targetMode && props.targetPlayerIds.includes(playerId);
}

function isSelectedTarget(playerId) {
  return props.targetMode && props.selectedTargetPlayerIds.includes(playerId);
}

function handlePlayerClick(playerId) {
  if (!isTargetable(playerId)) return;
  emit('select-player', playerId);
}

function pileSummaries(player) {
  return [
    { key: 'draw', label: 'Draw', count: player.deckCount ?? 0 },
    { key: 'hand', label: 'Hand', count: player.handCount ?? 0 },
    { key: 'discard', label: 'Discard', count: player.discardCount ?? 0 }
  ].map(pile => ({
    ...pile,
    state: pile.count === 0 ? 'empty' : pile.count <= 3 ? 'low' : 'stocked'
  }));
}

function markPileChanged(playerId, pileKey) {
  const key = `${playerId}:${pileKey}`;
  pileAnimations[key] = false;
  requestAnimationFrame(() => {
    pileAnimations[key] = true;
  });

  if (animationTimers.has(key)) {
    clearTimeout(animationTimers.get(key));
  }
  animationTimers.set(key, setTimeout(() => {
    pileAnimations[key] = false;
    animationTimers.delete(key);
  }, 520));
}

function flyingCardsByPlayer(playerId) {
  return flyingCards.filter(card => card.playerId === playerId);
}

function pilePosition(pileKey) {
  return {
    draw: 16.67,
    hand: 50,
    discard: 83.33
  }[pileKey] ?? 50;
}

// Get symbol totals for a player
function getPlayerTotals(playerId) {
  const totals = props.playerSymbolTotals[playerId] || {};
  const symbols = ['sword', 'shield', 'arrow', 'scroll', 'jump'];
  return symbols.map(sym => ({
    symbol: sym,
    count: totals[sym] || 0
  })).filter(s => s.count > 0);
}

// Calculate total hits across all symbols for a player
function getPlayerTotalHits(playerId) {
  const totals = props.playerSymbolTotals[playerId] || {};
  return Object.values(totals).reduce((sum, count) => sum + count, 0);
}

function spawnFlyingCard(playerId, fromPile, toPile, count = 1) {
  if (!fromPile || !toPile || fromPile === toPile) return;
  const id = ++flightId;
  const offset = Math.min(3, Math.max(1, count)) - 1;
  const card = {
    id,
    playerId,
    tone: toPile,
    style: {
      '--from-x': `${pilePosition(fromPile)}%`,
      '--to-x': `${pilePosition(toPile)}%`,
      '--arc': `${-18 - offset * 4}px`,
      '--spin': `${fromPile === 'discard' ? -10 : 10}deg`,
      '--spin-end': `${fromPile === 'discard' ? -15 : 15}deg`
    }
  };
  flyingCards.push(card);

  const timerId = setTimeout(() => {
    const index = flyingCards.findIndex(item => item.id === id);
    if (index !== -1) flyingCards.splice(index, 1);
    flightTimers.delete(id);
  }, 700);
  flightTimers.set(id, timerId);
}

function addPileTravelAnimations(playerId, previous, current) {
  const delta = {
    draw: current.draw - previous.draw,
    hand: current.hand - previous.hand,
    discard: current.discard - previous.discard
  };

  if (delta.draw < 0 && delta.hand >= 0) {
    spawnFlyingCard(playerId, 'draw', 'hand', Math.abs(delta.draw));
  }
  if (delta.hand < 0 && delta.discard > 0) {
    spawnFlyingCard(playerId, 'hand', 'discard', delta.discard);
  }
  if (delta.discard < 0 && delta.hand > 0) {
    spawnFlyingCard(playerId, 'discard', 'hand', delta.hand);
  }
  if (delta.discard < 0 && delta.draw > 0) {
    spawnFlyingCard(playerId, 'discard', 'draw', delta.draw);
  }
  if (delta.hand < 0 && delta.discard <= 0 && delta.draw <= 0) {
    spawnFlyingCard(playerId, 'hand', 'discard', Math.abs(delta.hand));
  }
  if (delta.draw > 0 && delta.discard <= 0 && delta.hand <= 0) {
    spawnFlyingCard(playerId, 'discard', 'draw', delta.draw);
  }
}

watch(
  () => props.players.map(player => ({
    id: player.id,
    draw: player.deckCount ?? 0,
    hand: player.handCount ?? 0,
    discard: player.discardCount ?? 0
  })),
  (players) => {
    const currentPlayerIds = new Set(players.map(player => player.id));
    for (const player of players) {
      const previous = previousPileCounts.get(player.id);
      if (previous) {
        for (const pileKey of ['draw', 'hand', 'discard']) {
          if (previous[pileKey] !== player[pileKey]) {
            markPileChanged(player.id, pileKey);
          }
        }
        addPileTravelAnimations(player.id, previous, player);
      }
      previousPileCounts.set(player.id, {
        draw: player.draw,
        hand: player.hand,
        discard: player.discard
      });
    }

    for (const playerId of previousPileCounts.keys()) {
      if (!currentPlayerIds.has(playerId)) {
        previousPileCounts.delete(playerId);
      }
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  for (const timerId of animationTimers.values()) {
    clearTimeout(timerId);
  }
  animationTimers.clear();
  for (const timerId of flightTimers.values()) {
    clearTimeout(timerId);
  }
  flightTimers.clear();
  flyingCards.splice(0, flyingCards.length);
});

function heroImage(player) {
  const heroId = player.hero;
  if (heroId) {
    return {
      backgroundImage: `url(/${heroId}.jpg)`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    };
  }
  const color = heroColors[player.hero];
  if (color) {
    return { backgroundColor: color };
  }
  return { backgroundColor: '#666' };
}

function secondHeroImage(player) {
  const heroId = player.secondHero;
  if (heroId) {
    return {
      backgroundImage: `url(/${heroId}.jpg)`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    };
  }
  const color = heroColors[player.secondHero];
  if (color) {
    return { backgroundColor: color };
  }
  return { backgroundColor: '#666' };
}
</script>

<style scoped>
.sidebar {
  background: rgba(7, 11, 37, 0.85);
  border-radius: 12px;
  padding: 1rem;
  min-width: 250px;
  color: #f3f5ff;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-header h3 {
  margin: 0;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.08rem;
}

.host-badge {
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: #ff9800;
  color: #000;
  font-weight: 700;
  text-transform: uppercase;
}

.player-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.player-list li {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
  border: 1px solid transparent;
  min-height: 72px;
}

.player-list li:hover {
  background: rgba(255, 255, 255, 0.1);
}

.player-list li.you {
  background: rgba(75, 96, 255, 0.2);
}

.player-list li.ready {
  border-left: 3px solid #4caf50;
}

.player-list li.targeting {
  opacity: 0.45;
}

.player-list li.selectable {
  cursor: pointer;
  opacity: 1;
  border-color: rgba(255, 235, 59, 0.9);
  background: rgba(255, 235, 59, 0.14);
  box-shadow:
    0 0 0 1px rgba(255, 235, 59, 0.25),
    0 0 18px rgba(255, 235, 59, 0.45);
  animation: targetGlow 1.2s ease-in-out infinite alternate;
}

.player-list li.selectable:hover {
  transform: translateY(-1px);
  background: rgba(255, 235, 59, 0.22);
  box-shadow:
    0 0 0 1px rgba(255, 235, 59, 0.45),
    0 0 24px rgba(255, 235, 59, 0.65);
}

.player-list li.selected {
  border-color: rgba(76, 175, 80, 0.95);
  background: rgba(76, 175, 80, 0.22);
  box-shadow:
    0 0 0 1px rgba(76, 175, 80, 0.45),
    0 0 26px rgba(76, 175, 80, 0.62);
}

.player-list li.unavailable {
  cursor: not-allowed;
}

@keyframes targetGlow {
  from {
    box-shadow:
      0 0 0 1px rgba(255, 235, 59, 0.22),
      0 0 14px rgba(255, 235, 59, 0.34);
  }
  to {
    box-shadow:
      0 0 0 1px rgba(255, 235, 59, 0.45),
      0 0 24px rgba(255, 235, 59, 0.58);
  }
}

.player-portrait-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 0 0 auto;
}

.profile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 215, 106, 0.42);
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd76a, #ff693f);
  color: #1d1230;
  font-weight: 800;
  overflow: hidden;
  flex: 0 0 auto;
}

.profile-avatar.has-picture {
  width: 48px;
  height: 48px;
  border-color: transparent;
  border-radius: 0;
  background: transparent;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.player-avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
  background-size: cover;
  background-position: center;
  position: relative;
  overflow: hidden;
}

.player-avatar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 8px;
}

.player-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.player-name {
  display: block;
  font-size: 0.9rem;
  margin-bottom: 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.7rem;
  color: #a3b5f9;
}

.player-hero {
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0.08rem 0.35rem;
  font-weight: 700;
  line-height: 1.25;
}

.player-hero-spacer {
  min-width: 40px;
  display: inline-block;
}

.ready-badge {
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: rgba(76, 175, 80, 0.3);
  color: #81c784;
  font-weight: 600;
}

.pile-row {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
  width: 100%;
  overflow: visible;
  min-height: 40px;
}

.card-pile {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  min-height: 40px;
  padding: 0.3rem 0.35rem;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.24);
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
  overflow: hidden;
}

.card-pile.draw {
  --pile-color: #64b5f6;
}

.card-pile.hand {
  --pile-color: #ffca28;
}

.card-pile.discard {
  --pile-color: #ef5350;
}

.card-pile.low {
  border-color: color-mix(in srgb, var(--pile-color) 48%, transparent);
}

.card-pile.empty {
  border-color: rgba(244, 67, 54, 0.72);
  background: rgba(244, 67, 54, 0.11);
}

.card-pile.active {
  animation: pileChange 0.52s ease-out;
}

.pile-stack {
  position: relative;
  width: 28px;
  height: 32px;
  display: block;
}

.pile-card {
  position: absolute;
  width: 18px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.02)),
    var(--pile-color);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
}

.pile-card.one {
  left: 1px;
  top: 6px;
  opacity: 0.5;
}

.pile-card.two {
  left: 5px;
  top: 3px;
  opacity: 0.72;
}

.pile-card.three {
  left: 9px;
  top: 0;
}

.card-pile.empty .pile-card {
  opacity: 0.2;
  filter: grayscale(0.7);
}

.pile-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.05;
}

.pile-label {
  font-size: 0.55rem;
  color: #9ea9d8;
  text-transform: uppercase;
  letter-spacing: 0.03rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pile-count {
  font-size: 0.9rem;
  color: #f7f8ff;
  min-width: 18px;
  text-align: right;
}

.empty-flash {
  position: absolute;
  right: 0.25rem;
  bottom: 0.15rem;
  font-size: 0.48rem;
  color: #ffcdd2;
  text-transform: uppercase;
  letter-spacing: 0.04rem;
}

.flying-card {
  position: absolute;
  left: var(--from-x);
  top: 50%;
  z-index: 3;
  width: 18px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.04)),
    #ffca28;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: cardFlight 0.68s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

.flying-card.draw {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.04)),
    #64b5f6;
}

.flying-card.hand {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.04)),
    #ffca28;
}

.flying-card.discard {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.04)),
    #ef5350;
}

@keyframes cardFlight {
  0% {
    left: var(--from-x);
    opacity: 0;
    transform: translate(-50%, -50%) translateY(0) scale(0.72) rotate(0deg);
  }
  18% {
    opacity: 1;
  }
  55% {
    transform: translate(-50%, -50%) translateY(var(--arc)) scale(1.02) rotate(var(--spin));
  }
  100% {
    left: var(--to-x);
    opacity: 0;
    transform: translate(-50%, -50%) translateY(0) scale(0.72) rotate(var(--spin-end));
  }
}

@keyframes pileChange {
  0% {
    transform: translateY(0) scale(1);
    box-shadow: 0 0 0 rgba(255, 255, 255, 0);
  }
  35% {
    transform: translateY(-2px) scale(1.04);
    box-shadow: 0 0 18px color-mix(in srgb, var(--pile-color) 58%, transparent);
  }
  100% {
    transform: translateY(0) scale(1);
    box-shadow: 0 0 0 rgba(255, 255, 255, 0);
  }
}

.kick-btn {
  border: none;
  padding: 0.35rem 0.6rem;
  border-radius: 4px;
  background: rgba(244, 67, 54, 0.2);
  color: #ef5350;
  font-size: 0.7rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.kick-btn:hover {
  background: rgba(244, 67, 54, 0.4);
}

.second-avatar {
  width: 30px;
  height: 30px;
  margin-left: 0;
  border: 2px solid rgba(255, 255, 255, 0.3);
  z-index: 1;
}

.hit-counter {
  margin-top: 0.4rem;
}

.hit-total {
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #c7cdef;
  font-weight: 500;
  font-size: 0.7rem;
}

@media (max-width: 768px) {
  .sidebar.mobile-collapsed {
    display: none;
  }

  .sidebar.mobile-target-picker {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 120;
    max-height: min(48vh, 360px);
    overflow-y: auto;
    border-radius: 12px 12px 0 0;
    box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.45);
  }

  .sidebar {
    min-width: 0;
    width: 100%;
    max-height: none;
    border-radius: 12px;
    padding: 0.75rem;
  }
  .sidebar-header h3 {
    font-size: 0.9rem;
  }
  .player-list {
    flex-direction: row;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
    scroll-snap-type: x proximity;
  }
  .player-list li {
    flex: 0 0 min(280px, 86vw);
    padding: 0.4rem;
    scroll-snap-align: start;
    min-height: 60px;
  }
  .player-avatar {
    width: 28px;
    height: 28px;
  }
  .profile-avatar,
  .profile-avatar.has-picture {
    width: 38px;
    height: 38px;
  }
  .second-avatar {
    width: 28px;
    height: 28px;
    margin-left: 0;
  }
  .player-name {
    font-size: 0.8rem;
  }
  .player-details {
    font-size: 0.6rem;
    flex-wrap: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pile-row {
    gap: 0.25rem;
  }
  .card-pile {
    grid-template-columns: 22px minmax(0, 1fr);
    min-height: 34px;
    padding: 0.25rem;
  }
  .pile-stack {
    width: 22px;
    height: 26px;
  }
  .pile-card {
    width: 15px;
    height: 20px;
  }
  .flying-card {
    width: 15px;
    height: 20px;
  }
  .pile-card.two {
    left: 4px;
  }
  .pile-card.three {
    left: 7px;
  }
  .pile-label {
    font-size: 0.48rem;
  }
  .pile-count {
    font-size: 0.76rem;
  }
  .empty-flash {
    display: none;
  }
  .kick-btn {
    padding: 0.2rem 0.4rem;
    font-size: 0.6rem;
    min-width: auto;
  }
}

@media (max-width: 480px) {
  .sidebar {
    padding: 0.5rem;
  }
  .sidebar-header {
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
  }
  .sidebar-header h3 {
    font-size: 0.8rem;
  }
  .host-badge {
    font-size: 0.6rem;
    padding: 0.15rem 0.35rem;
  }
  .player-list li {
    flex-basis: min(260px, 88vw);
    gap: 0.5rem;
    padding: 0.35rem;
    min-height: 56px;
  }
  .player-avatar {
    width: 24px;
    height: 24px;
  }
  .second-avatar {
    width: 24px;
    height: 24px;
    margin-left: 0;
  }
  .player-name {
    font-size: 0.75rem;
  }
  .player-details {
    font-size: 0.5rem;
  }
  .pile-row {
    grid-template-columns: repeat(3, minmax(42px, 1fr));
    min-height: 28px;
  }
  .card-pile {
    display: flex;
    justify-content: space-between;
    min-height: 28px;
    padding: 0.2rem 0.25rem;
  }
  .pile-stack {
    display: none;
  }
  .flying-card {
    width: 13px;
    height: 18px;
  }
  .pile-label {
    font-size: 0.45rem;
  }
  .pile-count {
    font-size: 0.68rem;
    min-width: 14px;
    text-align: right;
  }
  .ready-badge {
    padding: 0.1rem 0.3rem;
    font-size: 0.5rem;
  }
  .kick-btn {
    display: none;
  }
}
</style>
