<template>
  <section class="landing">
    <div class="hero-copy">
      <span class="eyebrow">THE ENEMY IS AMONG YOU</span>
      <h1 ref="heading">
        <span v-if="quoteParts.lead">{{ quoteParts.lead }}</span><em>{{ quoteParts.highlight }}</em>
      </h1>
      <p class="tagline">Will you find the heretics before night falls—or ensure the faithful never see another dawn?</p>
      <p>A persistent, chat-driven game of hidden allegiance. Find the heretics before night falls—or ensure the faithful never see another dawn.</p>
      <div class="feature-row"><span>5–12 players</span><span>Live or asynchronous</span><span>Persistent campaigns</span></div>
    </div>
    <div class="join-panel">
      <div class="sigil" aria-hidden="true"><span class="wax-seal">⅋</span><span class="seal-ribbons"><i></i><i></i></span></div>
      <h2>Enter the conclave</h2><p class="muted">Your words will be recorded. Choose them carefully.</p>
      <span class="data-chit" aria-hidden="true"></span>
      <form @submit.prevent="join">
        <label>Operative name<input v-model.trim="name" required maxlength="30" autocomplete="nickname" placeholder="Enter a callsign"></label>
        <label>Conclave code<input v-model.trim="code" maxlength="8" autocapitalize="characters" placeholder="e.g. CADIA" @input="code = code.toUpperCase()"></label>
        <button class="primary wide" :disabled="busy || !name || !code">Join existing conclave</button>
        <div class="divider"><span>or found a new conclave</span></div>
        <div class="mode-select" role="group" aria-label="Game pace">
          <button type="button" :class="{ active: mode === 'live' }" @click="mode='live'"><strong>Live</strong><small>Minutes per phase</small></button>
          <button type="button" :class="{ active: mode === 'async' }" @click="mode='async'"><strong>Async</strong><small>Hours per phase</small></button>
        </div>
        <button type="button" class="secondary wide" :disabled="busy || !name" @click="$emit('create', { name, mode })">Create a conclave</button>
      </form>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <details class="recovery">
        <summary>Restore an existing identity</summary>
        <form @submit.prevent="emitRecover">
          <input v-model="recoveryCode" placeholder="Player recovery code" maxlength="40">
          <!-- Only ever appears after the server signals this specific code
               needs it — a normal player restoring their own identity never
               sees it at all. -->
          <input v-if="needsAdminPassword" v-model="recoveryPassword" type="password"
                 placeholder="Admin password" autocomplete="off">
          <button class="ghost">Restore</button>
        </form>
      </details>
      <div v-if="profile?.playerCode" class="identity"><span>Identity secured</span><code>{{ profile.playerCode }}</code></div>
    </div>
  </section>
</template>
<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
const props = defineProps({ busy:Boolean, error:String, initialRoomCode:String, profile:Object, needsAdminPassword:Boolean });
const name = ref(props.profile?.username || props.profile?.name || ''); const code = ref(props.initialRoomCode || ''); const mode = ref('live'); const recoveryCode = ref(''); const recoveryPassword = ref('');
const fallbackQuote = { lead: 'Trust is a ', highlight: 'fatal weakness.' };
const quoteParts = ref(fallbackQuote);
function join(){ if(name.value && code.value) emitJoin(); }
const emit = defineEmits(['join','create','recover']);
function emitJoin(){ emit('join',{ name:name.value, roomCode:code.value.toUpperCase() }); }
function emitRecover(){ emit('recover', { code: recoveryCode.value.trim().toUpperCase(), password: recoveryPassword.value }); }
function splitQuote(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallbackQuote;
  const words = normalized.split(' ');
  if (words.length < 4) return { lead: '', highlight: normalized };
  const midpoint = Math.ceil(words.length / 2);
  return { lead: `${words.slice(0, midpoint).join(' ')} `, highlight: words.slice(midpoint).join(' ') };
}
function parseQuotes(text) {
  return text
    .split(/\n\s*\n/)
    .map(item => item.trim())
    .filter(Boolean);
}
const heading = ref(null);
const MIN_SCALE = 0.6;
const MAX_LINES = 4;
const MAX_ITERATIONS = 6;
const LINE_HEIGHT_RATIO = 0.99; // must match .hero-copy h1's CSS line-height
let resizeTimer = null;
function checkOverflow(scale) {
  const el = heading.value;
  el.style.setProperty('--fit-scale', String(scale));
  const fontSizePx = parseFloat(getComputedStyle(el).fontSize);
  const lineBudget = fontSizePx * LINE_HEIGHT_RATIO * MAX_LINES;
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > lineBudget + 1;
}
function fitHeading() {
  const el = heading.value;
  if (!el) return;
  if (!checkOverflow(1)) return;
  let lo = MIN_SCALE, hi = 1, best = MIN_SCALE;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (checkOverflow(mid)) hi = mid; else { best = mid; lo = mid; }
  }
  checkOverflow(best);
}
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitHeading, 150);
}
onMounted(async () => {
  await nextTick();
  fitHeading();
  window.addEventListener('resize', onResize);
  if (document.fonts?.ready) document.fonts.ready.then(fitHeading);
  try {
    const response = await fetch('/quotes.txt', { cache: 'no-cache' });
    if (!response.ok) return;
    const quotes = parseQuotes(await response.text());
    if (quotes.length) {
      quoteParts.value = splitQuote(quotes[Math.floor(Math.random() * quotes.length)]);
      await nextTick();
      fitHeading();
    }
  } catch {}
});
onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  clearTimeout(resizeTimer);
});
</script>