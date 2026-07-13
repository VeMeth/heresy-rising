<template>
  <section class="lobby page">
    <div class="section-heading"><div><span class="eyebrow">ASSEMBLY IN PROGRESS</span><h1>The conclave gathers</h1><p>Share conclave code <strong>{{ game.code }}</strong>. The host begins when every operative is ready.</p></div><button class="ghost" @click="$emit('leave')">Leave conclave</button></div>
    <div class="lobby-grid">
      <article class="panel roster-card"><header><h2>Operatives</h2><span>{{ players.length }}/12</span></header><ul class="lobby-players"><li v-for="p in players" :key="p.playerCode"><span class="avatar">{{ initial(p.name) }}</span><div><strong>{{ p.name }}</strong><small>{{ p.isHost ? 'Conclave commander' : p.connected === false ? 'Disconnected' : 'Awaiting orders' }}</small></div><span class="ready" :class="{yes:p.ready}">{{ p.ready?'READY':'NOT READY' }}</span></li></ul><p v-if="players.length<5" class="notice">At least five operatives are required.</p></article>
      <article class="panel setup-card"><header><h2>Operation parameters</h2><span>{{ game.mode==='async'?'ASYNC':'LIVE' }}</span></header>
        <div class="preset"><strong>{{ players.length }}-operative conclave</strong><p>Roles are assigned only after launch and revealed privately via dossier. The roster is sealed.</p></div>
        <label>Maximum Drift<input v-model.number="setup.maxDrift" type="number" min="1" max="100" :disabled="!isHost"></label>
        <button v-if="isHost" class="secondary wide" @click="$emit('configure',{...setup})">Use these parameters</button>
      </article>
    </div>
    <div class="lobby-actions"><button class="secondary" :class="{selected:me?.ready}" :disabled="busy" @click="$emit('ready')">{{ me?.ready?'Stand down':'Mark ready' }}</button><button v-if="isHost" class="primary" :disabled="!canStart||busy" @click="$emit('start')">Seal the chamber</button><span v-else>Waiting for the conclave commander.</span></div>
  </section>
</template>
<script setup>
import { computed, reactive, watch } from 'vue';
const props=defineProps({game:{type:Object,required:true},me:Object,busy:Boolean});defineEmits(['ready','start','configure','leave']);
const players=computed(()=>props.game.players||[]),isHost=computed(()=>props.me?.isHost),canStart=computed(()=>players.value.length>=5&&players.value.every(p=>p.ready));
const setup=reactive({maxDrift:20});watch(()=>props.game.maxDrift,v=>{if(v)setup.maxDrift=v},{immediate:true});
function initial(name){return(name||'?').charAt(0).toUpperCase()}
</script>
