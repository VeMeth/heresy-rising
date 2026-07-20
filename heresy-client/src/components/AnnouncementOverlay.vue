<template>
  <div v-if="announcement" :key="animationKey" class="announcement-wrapper" :class="`type-${announcement.type}`" role="alert">
    <div class="announcement-backdrop"></div>
    <div class="announcement-card">
      <span class="announcement-badge">{{ badgeLabel }}</span>
      <h1 class="announcement-title">{{ announcement.title }}</h1>
      <p class="announcement-message">{{ announcement.message }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  announcement: { type: Object, default: null }
});

const badgeLabels = {
  'kill': 'NIGHT SLAYING',
  'bodyguard': 'BLADE DEFLECTED',
  'execution': 'SUMMARY EXECUTION',
  'lynch': 'SENTENCE CARRIED OUT',
  'protection': 'CHIRURGEON INTERVENTION',
  'torture-chamber': 'TORTURE CHAMBER',
  'confession': 'CONFESSION',
  'gameover': 'CONCLUSION',
  'role-reveal': 'DOSSIER ISSUED'
};

const badgeLabel = computed(() => {
  if (!props.announcement) return '';
  return badgeLabels[props.announcement.type] || 'ANNOUNCEMENT';
});

// Force a fresh render every time the announcement changes so the CSS
// enter animation always replays, even when the server sends two
// announcements with the same fields back-to-back.
const animationKey = computed(() => {
  const a = props.announcement;
  if (!a) return 'none';
  return `${a.type || 'announce'}|${a.title || ''}|${a.message || ''}|${a.round || 0}|${Date.now()}`;
});
</script>

<style scoped>
.announcement-wrapper {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: announce-in 0.35s ease;
}
@keyframes announce-in {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}

.announcement-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}

.announcement-card {
  position: relative;
  text-align: center;
  padding: 2.5rem 4rem;
  max-width: 42rem;
  border: 1px solid;
  background: rgba(10, 12, 10, 0.95);
  box-shadow: 0 0 60px rgba(0, 0, 0, 0.8);
}

.announcement-badge {
  display: inline-block;
  font-size: 0.7rem;
  letter-spacing: 0.25em;
  padding: 0.3em 0.8em;
  margin-bottom: 1rem;
  text-transform: uppercase;
  border: 1px solid currentColor;
  opacity: 0.8;
}

.announcement-title {
  font-family: 'Times New Roman', serif;
  font-size: 2.2rem;
  letter-spacing: 0.15em;
  margin: 0 0 0.6rem;
  text-transform: uppercase;
  font-weight: 700;
  line-height: 1.2;
}

.announcement-message {
  font-size: 1rem;
  line-height: 1.5;
  margin: 0;
  opacity: 0.85;
  max-width: 32rem;
}

/* Type-based theming */
.type-kill .announcement-backdrop { background: rgba(80, 10, 10, 0.55); }
.type-kill .announcement-card { border-color: #8b1a1a; color: #ff6b6b; }

.type-bodyguard .announcement-backdrop { background: rgba(100, 40, 0, 0.55); }
.type-bodyguard .announcement-card { border-color: #8b5a1a; color: #ffb347; }

.type-execution .announcement-backdrop { background: rgba(60, 0, 0, 0.65); }
.type-execution .announcement-card { border-color: #6b0000; color: #ff4444; }

.type-lynch .announcement-backdrop { background: rgba(60, 20, 0, 0.6); }
.type-lynch .announcement-card { border-color: #6b3a00; color: #ff8844; }

.type-protection .announcement-backdrop { background: rgba(0, 30, 50, 0.45); }
.type-protection .announcement-card { border-color: #1a4a6b; color: #66c0ff; }

.type-torture-chamber .announcement-backdrop { background: rgba(50, 40, 0, 0.5); }
.type-torture-chamber .announcement-card { border-color: #6b5a1a; color: #ffd700; }

.type-confession .announcement-backdrop { background: rgba(40, 0, 50, 0.5); }
.type-confession .announcement-card { border-color: #5a1a6b; color: #c966ff; }

.type-role-reveal .announcement-backdrop { background: rgba(20, 30, 40, 0.6); }
.type-role-reveal .announcement-card { border-color: #3a5a7a; color: #a8d0e8; }

.type-gameover .announcement-backdrop { background: rgba(0, 0, 0, 0.75); }
.type-gameover .announcement-card { border-color: #8b0000; color: #ff3333; }
.type-gameover .announcement-title { font-size: 3rem; }
</style>
