<template>
  <div class="symbol-select-modal-overlay" @click="handleOverlayClick">
    <div class="symbol-select-modal" @click.stop>
      <h3>Choose Wild Card Symbol</h3>
      <div class="symbol-select-buttons">
        <button
          v-for="symbol in availableSymbols"
          :key="symbol"
          class="symbol-select-button"
          @click="selectSymbol(symbol)"
          :title="capitalizeFirst(symbol)"
        >
          <SymbolIcon :symbol="symbol" />
          <span class="symbol-name">{{ capitalizeFirst(symbol) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SymbolIcon from './SymbolIcon.vue';

const props = defineProps({
  availableSymbols: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['select', 'cancel']);

function handleOverlayClick() {
  emit('cancel');
}

function selectSymbol(symbol) {
  emit('select', symbol);
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
</script>

<style scoped>
.symbol-select-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

}

.symbol-select-modal {
  background: linear-gradient(145deg, rgba(45, 45, 60, 0.95), rgba(35, 35, 50, 0.95));
  border-radius: 16px;
  padding: 1.5rem;
  border: 2px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  min-width: 300px;
  max-width: 90vw;
  text-align: center;
}

.symbol-select-modal h3 {
  color: #fff;
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
  text-transform: uppercase;
  letter-spacing: 0.1rem;
}

.symbol-select-buttons {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
}

.symbol-select-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #fff;
  font-size: 0.85rem;
  min-width: 60px;
}

.symbol-select-button:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.symbol-select-button:active {
  transform: translateY(0);
  background: rgba(255, 255, 255, 0.3);
}

.symbol-name {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05rem;
  opacity: 0.9;
}

.symbol-select-button .symbol-icon {
  width: 28px;
  height: 28px;
}

@media (max-width: 480px) {
  .symbol-select-modal {
    padding: 1rem;
    margin: 0 1rem;
  }
  
  .symbol-select-buttons {
    gap: 0.5rem;
  }
  
  .symbol-select-button {
    min-width: 50px;
    padding: 0.4rem 0.6rem;
  }
  
  .symbol-name {
    font-size: 0.6rem;
  }
}
</style>