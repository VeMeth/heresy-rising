<template>
  <div class="history-panel">
    <div class="history-header">
      <span class="history-label">Game History</span>
    </div>
    <div class="history-list-container" ref="historyListRef">
      <div
        v-for="(entry, index) in displayHistory"
        :key="`${entry.timestamp || index}-${entry.message || entry.cardName || ''}`"
        class="history-entry"
        :class="getEntryClass(entry)"
      >
        <div class="entry-main">
          <span class="entry-time">{{ formatTime(entry.timestamp) }}</span>
          <span class="entry-icon">
            <SymbolIcon :symbol="getEntryIcon(entry)" class="icon-small" />
          </span>
          <span class="entry-content">
            <template v-if="entry.prefix">{{ entry.prefix }} </template>
            <template v-if="entry.cardName">
              <span class="card-name">{{ entry.cardName }}</span>
              <span v-if="entry.symbols?.length" class="card-symbols">
                (
                <SymbolIcon
                  v-for="(sym, i) in entry.symbols"
                  :key="i"
                  :symbol="sym"
                  class="icon-tiny"
                />
                )
              </span>
            </template>
            <template v-else-if="entry.message">{{ entry.message }}</template>
          </span>
        </div>

        <div v-if="entry.children?.length" class="children-list">
          <div
            v-for="(child, childIdx) in entry.children"
            :key="`child-${child.timestamp || childIdx}-${child.message || ''}`"
            class="child-entry"
          >
            <span class="child-time">{{ formatTime(child.timestamp) }}</span>
            <span class="child-icon">
              <SymbolIcon :symbol="getEntryIcon(child)" class="icon-small" />
            </span>
            <span class="child-content">
              <template v-if="child.message">{{ child.message }}</template>
              <template v-if="child.type === 'defeat' && child.cards?.length">
                <span class="defeat-info">
                  using 
                  <span class="defeat-cards">
                    {{ child.cards.map(c => c.cardName).join(', ') }}
                  </span>
                  <span v-if="child.monsterCardsUsed !== undefined" class="monster-card-count">
                    ({{ child.monsterCardsUsed }} card{{ child.monsterCardsUsed === 1 ? '' : 's' }} used)
                  </span>
                </span>
              </template>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import SymbolIcon from './SymbolIcon.vue';

const room = inject('room');
const history = ref([]);
const historyListRef = ref(null);

// Auto-scroll behavior
let shouldScrollToBottom = true;
let hasLoadedHistory = false;

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const getEventIcon = (type) => {
  const icons = {
    card: 'sword',
    ability: 'scroll',
    boss: 'shield',
    system: 'scroll',
    dungeon: 'arrow',
    defeat: 'jump',
    event: 'scroll',
    miniboss: 'shield'
  };
  return icons[type] || 'scroll';
};

const getEntryIcon = (entry) => {
  // For card entries, use the first symbol if available
  if (entry.type === 'card' && entry.symbols?.length > 0) {
    return entry.symbols[0];
  }
  // For other entries, use the type-based icon
  return getEventIcon(entry.type);
};

const getEntryClass = (entry) => {
  const typeMap = {
    card: 'type-card',
    ability: 'type-ability',
    boss: 'type-boss',
    system: 'type-system',
    dungeon: 'type-dungeon',
    defeat: 'type-defeat',
    event: 'type-event',
    miniboss: 'type-miniboss'
  };
  return {
    'history-entry': true,
    [typeMap[entry.type] || '']: true
  };
};

const displayHistory = computed(() => {
  return history.value.filter(entry => {
    const hasContent = entry.message || entry.cardName || entry.prefix;
    const hasChildren = entry.children?.length > 0;
    return hasContent || hasChildren;
  });
});

// Check if user has scrolled up manually
function checkScrollPosition() {
  if (!historyListRef.value) return;
  const container = historyListRef.value;
  // If user is near the bottom, maintain auto-scroll behavior
  const threshold = 50; // pixels from bottom
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  shouldScrollToBottom = atBottom;
}

// Scroll to bottom of history
function scrollToBottom() {
  if (!historyListRef.value || !shouldScrollToBottom) return;
  nextTick(() => {
    const container = historyListRef.value;
    container.scrollTop = container.scrollHeight;
  });
}

// Handle scroll events to detect manual scrolling
function handleScroll() {
  checkScrollPosition();
}

// Set up scroll event listener
onMounted(() => {
  if (historyListRef.value) {
    historyListRef.value.addEventListener('scroll', handleScroll);
  }
});

onBeforeUnmount(() => {
  if (historyListRef.value) {
    historyListRef.value.removeEventListener('scroll', handleScroll);
  }
});

watch(
  () => room?.value?.history,
  (newHist) => {
    if (!newHist) {
      history.value = [];
      hasLoadedHistory = false;
      return;
    }
    
    // Check scroll position before updating
    checkScrollPosition();

    if (!hasLoadedHistory) {
      shouldScrollToBottom = true;
      hasLoadedHistory = true;
    }

    history.value = [...newHist];
    
    if (history.value.length > 200) {
      // Remove oldest entries (from the beginning) to keep limit
      history.value = history.value.slice(-200);
    }
    
    // Scroll to bottom if we should
    scrollToBottom();
  },
  { deep: true, immediate: true }
);
</script>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  max-width: 280px;
  height: 100vh;
  background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.65) 100%);
  border-right: 2px solid rgba(255, 255, 255, 0.2);
  padding: 1rem;
  overflow: hidden;
  flex-shrink: 0;
  box-sizing: border-box;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}

.history-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #c7cdef;
  text-transform: uppercase;
  letter-spacing: 0.08rem;
}

.history-list-container {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
  padding-right: 0.5rem;
  flex: 1;
  scroll-behavior: smooth;
}

.history-entry {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
  animation: fadeIn 0.15s ease;
  min-width: 0;
}

.entry-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.entry-time {
  font-size: 0.7rem;
  color: #7a8aa0;
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.entry-icon {
  flex-shrink: 0;
}

.entry-content {
  flex: 1;
  color: #e0e0e0;
  word-break: break-word;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.card-name {
  font-weight: 600;
  color: #fff;
}

.card-symbols {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.25rem;
}

.children-list {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-left: 1.5rem;
  padding-left: 0.5rem;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
}

.child-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  animation: fadeIn 0.1s ease;
  opacity: 0.85;
}

.child-time {
  font-size: 0.65rem;
  color: #7a8aa0;
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.child-icon {
  flex-shrink: 0;
}

.child-content {
  flex: 1;
  color: #e0e0e0;
  word-break: break-word;
  min-width: 0;
}

.defeat-info {
  font-size: 0.8rem;
  color: #a0c4ff;
  margin-left: 0.25rem;
}

.defeat-cards {
  color: #4b60ff;
  font-weight: 500;
}

.monster-card-count {
  color: #ffca28;
  font-weight: 600;
  margin-left: 0.25rem;
}

.icon-small {
  width: 14px;
  height: 14px;
}

.icon-tiny {
  width: 12px;
  height: 12px;
}

.history-entry.type-card {
  border-left: 3px solid #4b60ff;
}

.history-entry.type-ability {
  border-left: 3px solid #ffeb3b;
}

.history-entry.type-boss {
  border-left: 3px solid #f44336;
}

.history-entry.type-system {
  border-left: 3px solid #81c784;
}

.history-entry.type-dungeon {
  border-left: 3px solid #9c27b0;
}

.history-entry.type-defeat {
  border-left: 3px solid #4caf50;
}

.history-entry.type-event {
  border-left: 3px solid #ff9800;
}

.history-entry.type-miniboss {
  border-left: 3px solid #ff5722;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.history-list-container::-webkit-scrollbar {
  width: 6px;
}

.history-list-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.history-list-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.history-list-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.35);
}

@media (max-width: 768px) {
  .history-panel {
    width: 100%;
    max-width: none;
    height: auto;
    max-height: 32vh;
    min-height: 150px;
    border-right: 0;
    border-bottom: 2px solid rgba(255, 255, 255, 0.2);
    padding: 0.75rem;
    background: linear-gradient(180deg, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.48) 100%);
  }

  .history-header {
    margin-bottom: 0.5rem;
    padding-bottom: 0.4rem;
  }

  .history-label {
    font-size: 0.75rem;
    letter-spacing: 0.04rem;
  }

  .history-list-container {
    max-height: calc(32vh - 3.25rem);
    padding-right: 0.35rem;
  }

  .history-entry {
    padding: 0.35rem 0.45rem;
    font-size: 0.78rem;
  }

  .entry-main {
    gap: 0.35rem;
  }

  .entry-time {
    min-width: 32px;
    font-size: 0.65rem;
  }

  .children-list {
    margin-left: 0.75rem;
    padding-left: 0.4rem;
  }

  .child-entry {
    gap: 0.35rem;
    padding: 0.2rem 0.35rem;
    font-size: 0.72rem;
  }
}

@media (max-width: 480px) {
  .history-panel {
    max-height: 28vh;
    min-height: 130px;
    padding: 0.5rem;
  }

  .history-list-container {
    max-height: calc(28vh - 2.75rem);
  }

  .history-entry {
    font-size: 0.72rem;
  }

  .entry-icon,
  .child-icon {
    display: none;
  }

  .entry-time,
  .child-time {
    min-width: 29px;
    font-size: 0.6rem;
  }
}
</style>
