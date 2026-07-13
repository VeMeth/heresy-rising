<template>
  <div class="hand">
    <div
      v-for="card in cards"
      :key="card.id"
      class="hand-card"
      :class="{
        resource: card.type === 'resource',
        action: card.type === 'action',
        disabled: disabled || isCardDisabled(card)
      }"
      :title="disabledReason(card)"
      :aria-disabled="disabled || isCardDisabled(card)"
      @click="!disabled && !isCardDisabled(card) && playCard(card.id)"
      @touchstart="!disabled && !isCardDisabled(card) && handleTouchStart(card.id)"
      @touchend="!disabled && !isCardDisabled(card) && handleTouchEnd(card.id)"
    >
      <div class="card-content">
        <div v-if="card.name" class="card-name">{{ card.name }}</div>
        <div v-else class="card-name-spacer"></div>
        <div v-if="card.symbols && card.symbols.length > 0" class="card-symbols">
          <SymbolIcon
            v-for="symbol in card.symbols"
            :key="symbol"
            :symbol="symbol"
          />
        </div>
        <div v-else class="card-symbols-spacer"></div>
        <div v-if="card.effect" class="card-effect">{{ card.effect }}</div>
        <div v-else class="card-effect-spacer"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SymbolIcon from './SymbolIcon.vue';

const props = defineProps({
  cards: {
    type: Array,
    default: () => []
  },
  disabled: {
    type: Boolean,
    default: false
  },
  phase: {
    type: String,
    default: ''
  },
  targetCard: {
    type: Object,
    default: null
  },
  symbolsRemaining: {
    type: Array,
    default: () => []
  },
  activeEvent: {
    type: String,
    default: null
  },
  pendingChoice: {
    type: Object,
    default: null
  },
  activeCurses: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['play-card']);
const touchActiveCard = ref(null);

function playCard(cardId) {
  emit('play-card', { cardId });
}

function handleTouchStart(cardId) {
  touchActiveCard.value = cardId;
}

function handleTouchEnd(cardId) {
  if (touchActiveCard.value === cardId) {
    playCard(cardId);
  }
  touchActiveCard.value = null;
}

const EVENT_STOPPERS = new Set(['Cancel', 'Holy Hand Grenade']);
const TYPE_SPECIFIC_ACTIONS = new Map([
  ['Fireball', 'Monster'],
  ['Snipe', 'Person'],
  ['Backstab', 'Person'],
  ['Intimidate', 'Person'],
  ['Smite', 'Monster'],
  ['Vanish', 'Obstacle'],
  ['Mighty Leap', 'Obstacle']
]);

function activeCurseRules() {
  return new Set(props.activeCurses.map(curse => curse.rule));
}

function matchingResourceSymbols(card) {
  const cardSymbols = card.symbols || [];
  const remaining = props.symbolsRemaining || [];
  if (card.name === 'Magic Bomb') {
    return [...new Set(remaining)];
  }
  return cardSymbols.filter(symbol => remaining.includes(symbol));
}

function eventIsResolving() {
  const target = props.targetCard;
  return props.phase === 'dungeon'
    && target?.type === 'Challenge'
    && target.subtype === 'Event'
    && props.activeEvent === target.name;
}

function cardDisabledReason(card) {
  if (!card) return 'Card unavailable';
  if (props.pendingChoice) return 'Resolve the Event choice first';
  if (!props.targetCard) return 'No current target';
  if (props.phase !== 'dungeon' && props.phase !== 'boss') return 'Cards cannot be played now';

  const curseRules = activeCurseRules();
  if (curseRules.has('noBlackBorderCards') && card.type === 'action') {
    return 'Blocked by Sheepified!';
  }
  if (curseRules.has('noPause') && ['Stop Time', 'Divine Shield'].includes(card.name)) {
    return 'Blocked by Clock Blocked';
  }

  if (eventIsResolving() && !EVENT_STOPPERS.has(card.name)) {
    return 'Only Cancel or Holy Hand Grenade can stop an Event';
  }

  const target = props.targetCard;
  if (card.name === 'Holy Hand Grenade') return '';

  if (props.phase === 'boss') {
    if (card.name === 'Magic Bomb') return matchingResourceSymbols(card).length ? '' : 'No matching boss symbols';
    if (card.type === 'resource') return matchingResourceSymbols(card).length ? '' : 'No matching boss symbols';
    if (card.type === 'action' && TYPE_SPECIFIC_ACTIONS.has(card.name)) {
      return 'Type-specific actions do not work on bosses';
    }
    return '';
  }

  if (target.type === 'Challenge' && target.subtype === 'Event') {
    return EVENT_STOPPERS.has(card.name) ? '' : 'Only Cancel or Holy Hand Grenade can stop Events';
  }

  if (target.type === 'Challenge' && target.subtype === 'MiniBoss') {
    if (card.name === 'Magic Bomb') return matchingResourceSymbols(card).length ? '' : 'No matching symbols';
    if (card.type === 'resource') return matchingResourceSymbols(card).length ? '' : 'No matching symbols';
    if (card.type === 'action' && TYPE_SPECIFIC_ACTIONS.has(card.name)) {
      return 'Type-specific actions do not work on Mini-Bosses';
    }
    return '';
  }

  if (card.name === 'Magic Bomb') return matchingResourceSymbols(card).length ? '' : 'No matching symbols';

  if (card.type === 'action' && TYPE_SPECIFIC_ACTIONS.has(card.name)) {
    return target.cardType === TYPE_SPECIFIC_ACTIONS.get(card.name) ? '' : `Only works on ${TYPE_SPECIFIC_ACTIONS.get(card.name)} cards`;
  }

  if (card.name === 'Cancel') return 'Cancel only works on Events';
  return '';
}

function isCardDisabled(card) {
  return !!cardDisabledReason(card);
}

function disabledReason(card) {
  if (props.disabled) return 'Cards cannot be played now';
  return cardDisabledReason(card) || card.effect || card.name || 'Playable';
}
</script>

<style scoped>
.hand {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
  padding: 0.5rem;
}

.hand-card {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 140px;
  border-radius: 10px;
  cursor: pointer;
  background: linear-gradient(145deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05));
  border: 2px solid rgba(255,255,255,0.3);
  transition: all 0.2s ease;
  overflow: hidden;
  touch-action: manipulation;
  min-width: var(--touch-optimal-card-width);
  min-height: var(--touch-optimal-card-height);
}

.hand-card:active:not(.disabled) {
  transform: scale(0.95);
}

.hand-card:hover:not(.disabled) {
  transform: translateY(-5px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
  border-color: #4b60ff;
}

.hand-card.disabled {
  cursor: not-allowed;
  opacity: 0.42;
  transform: none;
  filter: grayscale(0.75);
}

.hand-card.resource {
  border-color: #81c784;
  background: linear-gradient(145deg, rgba(76,175,80,0.2), rgba(76,175,80,0.05));
}

.hand-card.action {
  border-color: #ff9800;
  background: linear-gradient(145deg, rgba(255,152,0,0.2), rgba(255,152,0,0.05));
}

.card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  text-align: center;
  width: 100%;
}

.card-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05rem;
  line-height: 1.2;
  min-height: 16px;
}

.card-name-spacer {
  min-height: 16px;
}

.card-symbols {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  justify-content: center;
  min-height: 20px;
}

.card-symbols-spacer {
  min-height: 20px;
}

.card-effect {
  font-size: 0.65rem;
  color: #c7cdef;
  line-height: 1.3;
  max-width: 100%;
  min-height: 14px;
}

.card-effect-spacer {
  min-height: 14px;
}

@media (max-width: 768px) {
  .hand-card {
    width: var(--touch-optimal-card-width);
    height: var(--touch-optimal-card-height);
  }
  .card-name {
    font-size: 0.85rem;
  }
  .card-effect {
    font-size: 0.75rem;
  }
}

@media (max-width: 480px) {
  .hand-card {
    width: calc(var(--touch-optimal-card-width) * 0.9);
    height: calc(var(--touch-optimal-card-height) * 0.9);
    min-width: var(--touch-min-card);
    min-height: calc(var(--touch-min-card) * 1.5);
  }
  .hand {
    gap: 0.5rem;
    padding: 0.25rem;
  }
  .card-name {
    font-size: 0.75rem;
  }
  .card-effect {
    font-size: 0.6rem;
  }
}
</style>
