<template>
  <div v-if="announcement" :key="animationKey" class="announcement-wrapper" :class="[`type-${announcement.type}`, factionClass]" role="alert">
    <div class="announcement-backdrop"></div>
    <div class="letterbox top" aria-hidden="true"></div>
    <div class="letterbox bottom" aria-hidden="true"></div>
    <div class="announcement-card">
      <span class="announcement-badge">{{ badgeLabel }}</span>
      <h1 class="announcement-title">{{ displayTitle }}</h1>
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

// The dossier reveal's main focus is the role itself — put it in the
// giant title slot instead of the generic "YOUR DOSSIER" heading.
const displayTitle = computed(() => {
  const a = props.announcement;
  if (!a) return '';
  return (a.type === 'role-reveal' && a.role) ? a.role : (a.title || '');
});

// Faction tint for the role reveal: heretic oxblood vs loyalist gold.
const factionClass = computed(() => {
  const a = props.announcement;
  if (!a || a.type !== 'role-reveal' || !a.faction) return '';
  return `faction-${a.faction}`;
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
  /* Cinematic vignette that works regardless of the per-type tint */
  box-shadow: inset 0 0 180px rgba(0, 0, 0, 0.85);
  animation: backdrop-slam 0.45s ease;
}
@keyframes backdrop-slam {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* Letterbox bars slam in from the screen edges */
.letterbox {
  position: absolute;
  left: 0;
  right: 0;
  height: 11vh;
  background: #000;
}
.letterbox.top {
  top: 0;
  transform-origin: top;
  animation: letterbox-in 0.5s cubic-bezier(.2, .8, .3, 1) both;
}
.letterbox.bottom {
  bottom: 0;
  transform-origin: bottom;
  animation: letterbox-in 0.5s cubic-bezier(.2, .8, .3, 1) both;
}
@keyframes letterbox-in {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}

.announcement-card {
  position: relative;
  text-align: center;
  padding: 2.5rem 4rem;
  max-width: 42rem;
  border: 1px solid;
  background: rgba(10, 12, 10, 0.95);
  box-shadow: 0 0 60px rgba(0, 0, 0, 0.8);
  animation: announce-in 0.35s ease, announce-glow 2s ease-in-out 0.4s infinite alternate;
  overflow: hidden;
  /* Gold corner brackets drawn as eight tiny gradients */
  background-image:
    linear-gradient(#b69a5c, #b69a5c), linear-gradient(#b69a5c, #b69a5c),
    linear-gradient(#b69a5c, #b69a5c), linear-gradient(#b69a5c, #b69a5c),
    linear-gradient(#b69a5c, #b69a5c), linear-gradient(#b69a5c, #b69a5c),
    linear-gradient(#b69a5c, #b69a5c), linear-gradient(#b69a5c, #b69a5c);
  background-repeat: no-repeat;
  background-size: 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px;
  background-position:
    5px 5px, 5px 5px,
    right 5px top 5px, right 5px top 5px,
    left 5px bottom 5px, left 5px bottom 5px,
    right 5px bottom 5px, right 5px bottom 5px;
}
.announcement-card::before {
  content: "\24B8";
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  font: 700 180px Cinzel, serif;
  opacity: 0.025;
  pointer-events: none;
  line-height: 1;
}

/* The badge slams down like a wax stamp and stays slightly askew */
.announcement-badge {
  display: inline-block;
  font: 700 0.7rem Inter, sans-serif;
  letter-spacing: 0.25em;
  padding: 0.35em 0.9em;
  margin-bottom: 1rem;
  text-transform: uppercase;
  border: 1px solid currentColor;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35), inset 0 0 10px rgba(0, 0, 0, 0.25);
  opacity: 0.85;
  transform: rotate(-5deg);
  animation: stamp-in 0.55s cubic-bezier(.2, 1.3, .35, 1) 0.1s both;
}
@keyframes stamp-in {
  0%   { opacity: 0; transform: scale(2.4) rotate(-16deg); }
  60%  { opacity: 1; transform: scale(0.94) rotate(-3deg); }
  100% { opacity: 0.85; transform: scale(1) rotate(-5deg); }
}

.announcement-title {
  font-family: Cinzel, serif;
  font-size: 2.2rem;
  letter-spacing: 0.15em;
  margin: 0 0 0.6rem;
  text-transform: uppercase;
  font-weight: 700;
  line-height: 1.2;
  text-shadow: 0 0 20px currentColor;
  animation: title-track 0.9s ease 0.15s both;
}
@keyframes title-track {
  from { opacity: 0; letter-spacing: 0.38em; }
  to   { opacity: 1; letter-spacing: 0.15em; }
}

.announcement-message {
  font-size: 1rem;
  line-height: 1.5;
  margin: 0;
  opacity: 0.85;
  max-width: 32rem;
  animation: message-fade 0.8s ease 0.35s both;
}
@keyframes message-fade {
  from { opacity: 0; }
  to   { opacity: 0.85; }
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
.type-role-reveal .announcement-title { font-size: 2.9rem; }
.type-role-reveal.faction-heretic .announcement-backdrop { background: rgba(60, 10, 10, 0.62); }
.type-role-reveal.faction-heretic .announcement-card { border-color: #6b3030; color: #ff8a8a; }
.type-role-reveal.faction-loyalist .announcement-backdrop { background: rgba(28, 24, 12, 0.6); }
.type-role-reveal.faction-loyalist .announcement-card { border-color: #5b533d; color: #dfc27c; }

.type-gameover .announcement-backdrop { background: rgba(0, 0, 0, 0.75); }
.type-gameover .announcement-card { border-color: #8b0000; color: #ff3333; }
.type-gameover .announcement-title {
  font-size: 3rem;
  animation: title-track 0.9s ease 0.15s both, gameover-pulse 2.2s ease-in-out 1.1s infinite alternate;
}
@keyframes gameover-pulse {
  from { text-shadow: 0 0 16px rgba(255, 51, 51, 0.45); }
  to   { text-shadow: 0 0 34px rgba(255, 51, 51, 0.85), 0 0 70px rgba(255, 51, 51, 0.35); }
}
</style>
