<template>
  <section class="landing">
    <div class="hero-copy">
      <span class="eyebrow">THE ENEMY IS AMONG US</span>
      <h1>Trust is a<br><em>fatal weakness.</em></h1>
      <p>A persistent, chat-driven game of hidden allegiance. Find the heretics before night falls—or ensure the faithful never see another dawn.</p>
      <div class="feature-row"><span>5–12 players</span><span>Live or asynchronous</span><span>Persistent campaigns</span></div>
    </div>
    <div class="join-panel">
      <div class="sigil" aria-hidden="true">⅋</div>
      <h2>Enter the conclave</h2><p class="muted">Your words will be recorded. Choose them carefully.</p>
      <form @submit.prevent="join">
        <label>Operative name<input v-model.trim="name" required maxlength="30" autocomplete="nickname" placeholder="Enter a callsign"></label>
        <label>Cell code<input v-model.trim="code" maxlength="8" autocapitalize="characters" placeholder="e.g. CADIA" @input="code = code.toUpperCase()"></label>
        <button class="primary wide" :disabled="busy || !name || !code">Join existing cell</button>
        <div class="divider"><span>or found a new cell</span></div>
        <div class="mode-select" role="group" aria-label="Game pace">
          <button type="button" :class="{ active: mode === 'live' }" @click="mode='live'"><strong>Live</strong><small>Minutes per phase</small></button>
          <button type="button" :class="{ active: mode === 'async' }" @click="mode='async'"><strong>Async</strong><small>Hours per phase</small></button>
        </div>
        <button type="button" class="secondary wide" :disabled="busy || !name" @click="$emit('create', { name, mode })">Create a cell</button>
      </form>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <details class="recovery"><summary>Restore an existing identity</summary><form @submit.prevent="$emit('recover', recoveryCode.trim().toUpperCase())"><input v-model="recoveryCode" placeholder="Player recovery code" maxlength="40"><button class="ghost">Restore</button></form></details>
      <div v-if="profile?.playerCode" class="identity"><span>Identity secured</span><code>{{ profile.playerCode }}</code></div>
    </div>
  </section>
</template>
<script setup>
import { ref } from 'vue';
const props = defineProps({ busy:Boolean, error:String, initialRoomCode:String, profile:Object });
const name = ref(props.profile?.username || props.profile?.name || ''); const code = ref(props.initialRoomCode || ''); const mode = ref('live'); const recoveryCode = ref('');
function join(){ if(name.value && code.value) emitJoin(); }
const emit = defineEmits(['join','create','recover']);
function emitJoin(){ emit('join',{ name:name.value, roomCode:code.value.toUpperCase() }); }
</script>
