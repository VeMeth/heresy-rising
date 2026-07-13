<template>
  <div class="dungeon-card" :class="[card.type.toLowerCase(), card.cardType?.toLowerCase() || card.subtype?.toLowerCase()]" :style="cardBackgroundStyle">
    <div class="card-header">
      <span class="card-type">{{ card.type }} - {{ card.cardType || card.subtype }}</span>
      <h3 class="card-name">{{ card.name }}</h3>
    </div>
    
    <div v-if="card.symbols && card.symbols.length > 0" class="card-symbols">
      <div
        v-for="(symbol, index) in card.symbols"
        :key="`${index}-${symbol}`"
        class="symbol"
        :class="{
          defeated: isSymbolDefeated(index),
          remaining: !isSymbolDefeated(index)
        }"
      >
        <SymbolIcon :symbol="symbol" />
      </div>
    </div>
    
    <div v-else class="card-description">
      <p>{{ card.effect || 'No description' }}</p>
    </div>
  </div>
</template>

<script setup>
import SymbolIcon from './SymbolIcon.vue';
import { computed } from 'vue';

const props = defineProps({
  card: {
    type: Object,
    required: true
  },
  symbolsRemaining: {
    type: Array,
    default: () => []
  },
  phase: {
    type: String,
    default: 'dungeon'
  }
});

// Check if the symbol at a specific index has been defeated
// For each symbol instance, count how many of that symbol appear up to this index,
// and compare with how many remain. If fewer remain than appear up to this index,
// this specific instance has been matched and defeated.
const isSymbolDefeated = (index) => {
  const symbol = props.card.symbols[index];
  // How many of this symbol appear in the card up to and including this index
  const countUpToIndex = props.card.symbols.slice(0, index + 1).filter(s => s === symbol).length;
  // How many of this symbol are still needed (in symbolsRemaining)
  const countRemaining = props.symbolsRemaining.filter(s => s === symbol).length;
  // How many of this symbol have been matched
  const originalCount = props.card.symbols.filter(s => s === symbol).length;
  const countMatched = originalCount - countRemaining;
  // This instance is defeated if it's within the matched count
  return countUpToIndex <= countMatched;
};

// Generate background style for the card
// For Door cards (Monster, Obstacle, Person), try to load a background image
const cardBackgroundStyle = computed(() => {
  const card = props.card;
  const cardName = card.name;
  
  // Only try to load background images for Door cards
  if (card.type === 'Door' && cardName) {
    // Generate image path: lowercase, spaces to hyphens, remove special chars
    // Pattern matches: ghost.png, a-creature-of-ill-repute.png, etc.
    const imageName = cardName.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    
    // Try PNG first (current format), then JPG, then WebP
    const extensions = ['.png', '.jpg', '.webp'];
    
    // Build URLs to try
    const imageUrls = extensions.map(ext => `/cards/${imageName}${ext}`);
    
    // Return background image style - browser will handle 404 gracefully
    // CSS gradient will show through if image doesn't exist
    return {
      backgroundImage: imageUrls.map(url => `url(${url})`).join(', '),
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    };
  }
  
  // For non-Door cards (Challenge, Boss, etc.), return empty object
  return {};
});
</script>

<style scoped>
.dungeon-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05));
  border: 2px solid rgba(255,255,255,0.2);
  min-width: 280px;
  color: #fff;
  position: relative;
  overflow: hidden;
}

/* Background image overlay for readability */
.dungeon-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.dungeon-card[style*="background-image"]::before {
  opacity: 0.7;
}

.dungeon-card.monster {
  border-color: #f44336;
  background: linear-gradient(145deg, rgba(244,67,54,0.2), rgba(244,67,54,0.05));
}

.dungeon-card.obstacle {
  border-color: #ff9800;
  background: linear-gradient(145deg, rgba(255,152,0,0.2), rgba(255,152,0,0.05));
}

.dungeon-card.person {
  border-color: #2196f3;
  background: linear-gradient(145deg, rgba(33,150,243,0.2), rgba(33,150,243,0.05));
}

.dungeon-card.challenge {
  border-color: #9c27b0;
}

.dungeon-card.miniboss {
  border-color: #ff5722;
  background: linear-gradient(145deg, rgba(255,87,34,0.3), rgba(255,87,34,0.1));
}

/* Ensure text is readable over background images */
.card-header {
  position: relative;
  z-index: 1;
  text-align: center;
  margin-bottom: 1rem;
}

.card-type {
  font-size: 0.75rem;
  color: #c7cdef;
  text-transform: uppercase;
  letter-spacing: 0.1rem;
}

.card-name {
  font-size: 1.5rem;
  margin: 0.25rem 0 0 0;
  font-weight: 700;
  letter-spacing: 0.05rem;
}

.card-symbols {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
  padding: 1rem 0;
  position: relative;
  z-index: 1;
}

.symbol {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  transition: all 0.2s ease;
}

.symbol.remaining {
  background: rgba(76, 175, 80, 0.3);
  border: 1px solid #81c784;
}

.symbol.defeated {
  opacity: 0.5;
  background: rgba(120, 120, 120, 0.3);
  position: relative;
}

.symbol.defeated::after {
  content: '✗';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  color: #f44336;
  font-weight: bold;
  text-shadow: 0 0 4px #000;
}

.card-description {
  text-align: center;
  padding: 1rem;
  color: #e0e0e0;
  font-size: 0.9rem;
  position: relative;
  z-index: 1;
}

@media (max-width: 768px) {
  .dungeon-card {
    min-width: 0;
    padding: 1.25rem;
  }
  .card-name {
    font-size: 1.25rem;
  }
  .card-symbols {
    gap: 0.5rem;
    padding: 0.75rem 0;
  }
  .symbol {
    width: 44px;
    height: 44px;
  }
  .symbol.remaining {
    background: rgba(76, 175, 80, 0.3);
    border: 1px solid #81c784;
  }
  .symbol.defeated::after {
    font-size: 20px;
  }
  .card-description {
    font-size: 0.8rem;
    padding: 0.75rem;
  }
}

@media (max-width: 480px) {
  .dungeon-card {
    padding: 1rem;
  }
  .card-type {
    font-size: 0.65rem;
  }
  .card-name {
    font-size: 1rem;
  }
  .symbol {
    width: 40px;
    height: 40px;
  }
  .symbol.defeated::after {
    font-size: 18px;
  }
  .card-description {
    font-size: 0.7rem;
    padding: 0.5rem;
  }
}
</style>
