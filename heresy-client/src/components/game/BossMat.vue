<template>
  <div class="boss-mat" :style="bossBackgroundStyle">
    <div class="boss-header">
      <span class="boss-label">Boss {{ boss.number }}</span>
      <h2 class="boss-name">{{ boss.name }}</h2>
    </div>
    
    <div class="boss-symbols">
      <div
        v-for="(symbol, index) in boss.symbols"
        :key="`${index}-${symbol}`"
        class="boss-symbol"
        :class="{
          defeated: isSymbolDefeated(index),
          remaining: !isSymbolDefeated(index)
        }"
      >
        <SymbolIcon :symbol="symbol" />
      </div>
    </div>
    
    <div class="boss-stats">
      <span class="stat">Door Cards: {{ boss.doorCardCount }}</span>
      <span class="stat">Required Symbols: {{ boss.symbols.length }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import SymbolIcon from './SymbolIcon.vue';

const props = defineProps({
  boss: {
    type: Object,
    required: true
  },
  symbolsRemaining: {
    type: Array,
    default: () => []
  }
});

// Generate background style for the boss
const bossBackgroundStyle = computed(() => {
  const bossName = props.boss.name;
  
  // Generate image path: lowercase, spaces to hyphens
  // Keep most characters except for unsafe ones
  const imageName = bossName.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[:"?*|<>]/g, '');  // Only remove truly problematic filesystem characters
  
  // Try PNG first, then JPG, then WebP
  const extensions = ['.png', '.jpg', '.webp'];
  const imageUrls = extensions.map(ext => `/cards/${imageName}${ext}`);
  
  // Return background image style - browser will handle 404 gracefully
  // CSS gradient will show through if image doesn't exist
  return {
    backgroundImage: imageUrls.map(url => `url(${url})`).join(', '),
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  };
});

// Check if the symbol at a specific index has been defeated
// For each symbol instance, count how many of that symbol appear up to this index,
// and compare with how many remain. If fewer remain than appear up to this index,
// this specific instance has been matched and defeated.
const isSymbolDefeated = (index) => {
  const symbol = props.boss.symbols[index];
  // How many of this symbol appear in the boss up to and including this index
  const countUpToIndex = props.boss.symbols.slice(0, index + 1).filter(s => s === symbol).length;
  // How many of this symbol are still needed (in symbolsRemaining)
  const countRemaining = props.symbolsRemaining.filter(s => s === symbol).length;
  // How many of this symbol have been matched
  const originalCount = props.boss.symbols.filter(s => s === symbol).length;
  const countMatched = originalCount - countRemaining;
  // This instance is defeated if it's within the matched count
  return countUpToIndex <= countMatched;
};
</script>

<style scoped>
.boss-mat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(244,67,54,0.3), rgba(244,67,54,0.1));
  border: 3px solid #f44336;
  min-width: 320px;
  color: #fff;
}

.boss-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.boss-label {
  font-size: 0.85rem;
  color: #ffcc00;
  text-transform: uppercase;
  letter-spacing: 0.15rem;
}

.boss-name {
  font-size: 2rem;
  margin: 0.5rem 0 0 0;
  font-weight: 700;
  text-shadow: 0 0 20px rgba(255, 200, 0, 0.5);
}

.boss-symbols {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  justify-content: center;
  padding: 1.5rem 0;
}

.boss-symbol {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
  transition: all 0.2s ease;
}

.boss-symbol.remaining {
  background: rgba(255, 255, 255, 0.35);
  border: 2px solid #ffeb3b;
}

.boss-symbol.defeated {
  opacity: 0.5;
  background: rgba(120, 120, 120, 0.3);
  position: relative;
}

.boss-symbol.defeated::after {
  content: '✗';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 28px;
  color: #ffeb3b;
  font-weight: bold;
  text-shadow: 0 0 4px #000;
}

.boss-stats {
  display: flex;
  gap: 1.5rem;
  margin-top: 1rem;
}

.stat {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  font-size: 0.9rem;
  color: #e0e0e0;
}

@media (max-width: 768px) {
  .boss-mat {
    min-width: 0;
    padding: 1.5rem;
  }
  .boss-name {
    font-size: 1.5rem;
  }
  .boss-symbols {
    gap: 0.75rem;
    padding: 1rem 0;
  }
  .boss-symbol {
    width: 48px;
    height: 48px;
  }
  .boss-symbol.defeated::after {
    font-size: 24px;
  }
  .boss-stats {
    flex-direction: column;
    gap: 0.75rem;
  }
  .stat {
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .boss-mat {
    padding: 1rem;
  }
  .boss-label {
    font-size: 0.75rem;
  }
  .boss-name {
    font-size: 1.25rem;
  }
  .boss-symbol {
    width: 44px;
    height: 44px;
  }
  .boss-symbol.defeated::after {
    font-size: 20px;
  }
  .stat {
    font-size: 0.7rem;
    padding: 0.35rem 0.6rem;
  }
}
</style>
