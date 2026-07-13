<template>
  <button
    class="ability-button"
    :class="{ disabled }"
    :disabled="disabled"
    @click="$emit('use')"
  >
    <span class="ability-name">{{ hero.ability.name }}</span>
    <span class="ability-description">{{ hero.ability.description }}</span>
    <span class="ability-cost">Cost: Discard 3 cards</span>
  </button>
</template>

<script setup>
const props = defineProps({
  hero: {
    type: Object,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['use']);
</script>

<style scoped>
.ability-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 2rem;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  background: linear-gradient(130deg, #9c27b0, #673ab7);
  color: #fff;
  transition: all 0.2s ease;
  font-family: inherit;
}

.ability-button:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(156, 39, 176, 0.5);
}

.ability-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
}

.ability-name {
  font-size: 1.25rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1rem;
}

.ability-description {
  font-size: 0.9rem;
  color: #e0e0e0;
}

.ability-cost {
  font-size: 0.75rem;
  color: #ffeb3b;
  font-weight: 600;
}
</style>
