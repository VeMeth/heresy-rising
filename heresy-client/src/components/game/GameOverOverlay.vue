<template>
  <div class="overlay" @click="$emit('dismiss')">
    <div class="modal" @click.stop>
      <h1 v-if="outcome === 'victory'" class="title victory">Victory!</h1>
      <h1 v-else class="title defeat">Defeat</h1>

      <p v-if="outcome === 'victory'" class="message">
        You have conquered all {{ totalDungeons }} dungeons and defeated the final boss!
      </p>
      <p v-else class="message">
        The timer ran out. Better luck next time!
      </p>

      <div class="summary-grid">
        <div>
          <span>Bosses Defeated</span>
          <strong>{{ summary?.bossesDefeated ?? 0 }}</strong>
        </div>
        <div>
          <span>Dungeon Reached</span>
          <strong>{{ summary?.dungeonReached ?? 1 }}</strong>
        </div>
      </div>

      <div class="mvp-list">
        <div>
          <span>Most Cards Played</span>
          <strong>{{ mvpCardsText }}</strong>
        </div>
        <div>
          <span>Most Symbols Contributed</span>
          <strong>{{ mvpSymbolsText }}</strong>
        </div>
      </div>

      <div class="actions">
        <button class="secondary" @click="copyResult">
          Copy Result
        </button>
        <button class="primary" @click="$emit('dismiss')">
          Return to Conclave
        </button>
      </div>
      <p v-if="copied" class="copied">Copied for Telegram.</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  outcome: {
    type: String,
    required: true,
    validator: value => ['victory', 'defeat'].includes(value)
  },
  // Base game has 5 dungeons (guide §17). With the Kickstarter Booster
  // the run goes up to 7. Default to 5; GameView can override.
  totalDungeons: {
    type: Number,
    default: 5,
    validator: value => Number.isInteger(value) && value > 0
  },
  summary: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['dismiss']);

const copied = ref(false);

const mvpCardsText = computed(() => {
  const player = props.summary?.mostCards;
  if (!player) return 'No cards played';
  return `${player.name} (${player.cardsPlayed} card${player.cardsPlayed === 1 ? '' : 's'})`;
});

const mvpSymbolsText = computed(() => {
  const player = props.summary?.mostSymbols;
  if (!player) return 'No symbols matched';
  return `${player.name} (${player.symbolsContributed} symbol${player.symbolsContributed === 1 ? '' : 's'})`;
});

const resultText = computed(() => {
  const outcome = props.outcome === 'victory' ? 'Victory' : 'Defeat';
  const lines = [
    `Heresy Rising ${outcome}`,
    `Bosses defeated: ${props.summary?.bossesDefeated ?? 0}`,
    `Dungeon reached: ${props.summary?.dungeonReached ?? 1}`,
    `Most cards played: ${mvpCardsText.value}`,
    `Most symbols contributed: ${mvpSymbolsText.value}`
  ];
  return lines.join('\n');
});

async function copyResult() {
  try {
    await navigator.clipboard.writeText(resultText.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (error) {
    window.prompt('Copy result:', resultText.value);
  }
}
</script>

<style scoped>
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: linear-gradient(145deg, rgba(15, 20, 50, 0.95), rgba(30, 40, 80, 0.95));
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 3rem 4rem;
  text-align: center;
  max-width: 560px;
  width: 90%;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
}

.title {
  font-size: 3rem;
  margin: 0 0 1rem 0;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15rem;
}

.title.victory {
  color: #ffd700;
  text-shadow: 0 0 40px rgba(255, 215, 0, 0.5);
}

.title.defeat {
  color: #f44336;
  text-shadow: 0 0 40px rgba(244, 67, 54, 0.5);
}

.message {
  font-size: 1.1rem;
  color: #c7cdef;
  margin: 0 0 2rem 0;
  line-height: 1.6;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.summary-grid div,
.mvp-list div {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  padding: 0.85rem;
}

.summary-grid span,
.mvp-list span {
  display: block;
  color: #a3b5f9;
  font-size: 0.8rem;
  margin-bottom: 0.35rem;
}

.summary-grid strong {
  font-size: 1.4rem;
}

.mvp-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  text-align: left;
}

.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

.primary,
.secondary {
  border: none;
  border-radius: 10px;
  padding: 1rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  transition: all 0.2s ease;
}

.primary {
  background: linear-gradient(130deg, #4b60ff, #303f9f);
}

.secondary {
  background: rgba(255, 255, 255, 0.12);
}

.primary:hover,
.secondary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(75, 96, 255, 0.5);
}

.copied {
  color: #9ad0ff;
  margin: 1rem 0 0;
}

@media (max-width: 640px) {
  .modal {
    padding: 2rem 1.25rem;
  }

  .title {
    font-size: 2.1rem;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
