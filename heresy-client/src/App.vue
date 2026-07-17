<template>
  <AdminView v-if="isAdminRoute" />
  <div v-else class="app">
    <header class="masthead">
      <button class="brand" @click="leaveToHome" aria-label="Heresy Rising home">
        <span class="brand-mark">H</span><span><strong>HERESY RISING</strong><small>A game of accusation and survival</small></span>
      </button>
      <div class="mast-actions">
        <a href="/docs/" class="ghost compact">Manual</a>
        <span v-if="game" class="game-code">CONCLAVE {{ game.code }}</span>
        <span class="connection" :class="connectionState"><i></i>{{ connectionLabel }}</span>
        <button v-if="game" class="ghost compact" @click="copyInvite">Copy invite</button>
      </div>
    </header>

    <main>
      <JoinView v-if="!game" :busy="busy" :error="error" :initial-room-code="initialCode"
        :profile="profile" @create="createGame" @join="joinGame" @recover="recoverProfile" />
      <LobbyView v-else-if="game.phase === 'lobby'" :game="game" :me="me" :busy="busy"
        :composition-errors="compositionErrors" :messages="messages" :channel="channel"
        @ready="toggleReady" @start="startGame" @clear-errors="clearCompositionErrors"
        @configure="configureGame" @leave="leaveGame"
        @send="sendMessage" @channel-change="changeChannel" @history="loadHistory"
        @kick="kickPlayer" />
      <GameView v-else :game="game" :me="me" :messages="messages" :channel="channel"
        :busy="busy" :now="now" @channel="changeChannel" @send="sendMessage" @history="loadHistory"
        @vote="submitVote" @retract-vote="retractVote" @action="submitAction"
        @retract-action="retractAction" @respond="respondInterrogation" @ask-confession="askConfession"
        @reveal="confirmReveal" @advance="advancePhase" @leave="leaveGame" />
    </main>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <footer>Unofficial, non-commercial fan project. Not affiliated with or endorsed by Games Workshop.</footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ensureConnected, emitWithAck, getPlayerCode, setPlayerCode, socket } from './socket';
import AdminView from './components/AdminView.vue';
import JoinView from './components/JoinView.vue';
import LobbyView from './components/LobbyView.vue';
import GameView from './components/GameView.vue';

const game = ref(null); const busy = ref(false); const error = ref(''); const toast = ref(''); const compositionErrors = ref([]);
const isAdminRoute = location.pathname.replace(/\/+$/, '') === '/admin';
const connected = ref(false); const reconnecting = ref(false); const messagesByChannel = ref({ public: [], faction: [], graveyard: [] });
const channel = ref('public'); const now = ref(Date.now()); let clock; let toastTimer;
const profile = ref(readJson('heresy-rising:profile', { playerCode: getPlayerCode() }));
const params = new URLSearchParams(location.search); const initialCode = ref((params.get('game') || params.get('room') || '').toUpperCase());
const messages = computed(() => messagesByChannel.value[channel.value] || []);
const me = computed(() => game.value?.players?.find(p => p.isYou || p.id === game.value.you || p.id === game.value.youId) || game.value?.me || null);
const connectionState = computed(() => connected.value ? 'online' : reconnecting.value ? 'reconnecting' : 'offline');
const connectionLabel = computed(() => connected.value ? 'Vox online' : reconnecting.value ? 'Reconnecting' : 'Vox offline');

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveProfile(data) { if (!data) return; profile.value = { ...(profile.value || {}), ...data }; localStorage.setItem('heresy-rising:profile', JSON.stringify(profile.value)); if (data.playerCode) setPlayerCode(data.playerCode); }
function normalize(data) { return data?.state || data?.game || data?.room || data || null; }
function notify(text) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 2600); }
async function command(event, payload = {}) { busy.value = true; error.value = ''; try { await ensureConnected(); const data = await emitWithAck(event, { ...payload, playerCode: getPlayerCode() }); const state = normalize(data); if (state?.code && state?.players) game.value = state; if (data?.profile || data?.playerCode) saveProfile(data.profile || data); return data; } catch (e) { error.value = e.message; notify(e.message); throw e; } finally { busy.value = false; } }
async function createGame(form) { try { saveProfile({ name: form.name }); const data = await command('game:create', { name: form.name, mode: form.mode, options: {}, playerCode: profile.value?.playerCode }); game.value = normalize(data); if (data?.code && game.value && !game.value.code) game.value.code = data.code; if (game.value?.code) { history.replaceState({}, '', `?game=${game.value.code}`); await loadHistory(); } } catch {} }
async function joinGame(form) { try { saveProfile({ name: form.name }); const data = await command('game:join', { code: form.roomCode, name: form.name, playerCode: profile.value?.playerCode }); game.value = normalize(data); history.replaceState({}, '', `?game=${game.value.code || form.roomCode}`); await loadHistory(); } catch {} }
async function recoverProfile(code) { if (!code) return; setPlayerCode(code); saveProfile({ playerCode: code }); socket.disconnect(); await ensureConnected().catch(() => {}); notify('Identity restored'); }
async function toggleReady() { try { await command('game:ready', { code: game.value.code, ready: !me.value?.ready }); } catch {} }
async function kickPlayer(targetCode) { if (!targetCode || !game.value?.code) return; try { await command('game:kick', { code: game.value.code, targetCode }); } catch (e) { notify(e.message || 'Kick failed'); } }
function receiveKicked() { notify('You were removed from the conclave.'); leaveGame(); }
async function startGame(composition) { try { await command('game:start', { code: game.value.code, setup: { maxDrift: game.value.setup?.maxDrift || game.value.maxDrift, dayMs: game.value.setup?.dayMs || game.value.dayMs, nightMs: game.value.setup?.nightMs || game.value.nightMs, ...(composition ? { composition } : {}) } }); compositionErrors.value = []; } catch (e) { if (e.data?.errors) { compositionErrors.value = e.data.errors; error.value = ''; toast.value = ''; } } }
function clearCompositionErrors() { compositionErrors.value = []; }
async function configureGame(setup) { game.value = { ...game.value, setup }; notify('Parameters staged for game start'); }
async function confirmReveal() { try { await command('game:advance-phase', { code: game.value.code }); } catch {} }
async function advancePhase() { try { await command('game:advance-phase', { code: game.value.code }); } catch {} }
async function sendMessage(body) { try { await command('chat:send', { code: game.value.code, channel: channel.value, body }); } catch {} }
async function loadHistory(before) { try { const data = await command('chat:history', { code: game.value.code, playerCode: profile.value?.playerCode, channel: channel.value, before, limit: 50 }); mergeMessages(channel.value, data?.messages || [], true); } catch {} }
async function submitVote(payload) { try { const vote=typeof payload==='string'?{choice:payload}:payload; const data=await command('vote:submit', { code: game.value.code, targetCode: vote.choice, justification: vote.justification }); if(data?.votes) game.value={...game.value,votes:data.votes}; } catch {} }
async function retractVote() { try { await command('vote:retract', { code: game.value.code }); } catch {} }
async function submitAction(payload) { try { const data=await command('action:submit', { code: game.value.code, ...(typeof payload==='string'?{targetCode:payload}:payload) }); if(data?.action) game.value={...game.value,myAction:data.action}; } catch {} }
async function retractAction() { try { await command('action:retract', { code: game.value.code }); } catch {} }
async function respondInterrogation(response) { try { await command('interrogation:respond', { code: game.value.code, response }); } catch {} }
async function askConfession(targetCode) { try { await command('confession:ask', { code: game.value.code, targetCode }); } catch {} }
async function leaveGame() { try { if (game.value) await command('game:leave', { code: game.value.code }); } catch {} game.value = null; messagesByChannel.value = { public: [], faction: [], graveyard: [] }; history.replaceState({}, '', location.pathname); }
function leaveToHome() { if (!game.value || confirm('Leave this game? You can return with the same player code.')) leaveGame(); }
function changeChannel(next) { channel.value = next; if (!messagesByChannel.value[next]?.length) loadHistory(); }
function mergeMessages(ch, incoming, prepend = false) { const old = messagesByChannel.value[ch] || []; const map = new Map((prepend ? [...incoming, ...old] : [...old, ...incoming]).map(m => [m.id || m.sequence || `${m.createdAt}-${m.authorName}-${m.body}`, m])); messagesByChannel.value = { ...messagesByChannel.value, [ch]: [...map.values()].sort((a,b) => (a.sequence || Date.parse(a.createdAt)) - (b.sequence || Date.parse(b.createdAt))) }; }
async function copyInvite() {
  if (!game.value?.code) return;
  const invite = new URL(location.origin);
  invite.searchParams.set('game', game.value.code);
  const copied = await copyText(invite.toString());
  notify(copied ? `Invite copied: ${invite.toString()}` : `Copy failed. Invite: ${invite.toString()}`);
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
function receiveState(data) { const state = normalize(data); if (state) game.value = state; }
function receiveMessage(payload) { const msg = payload?.message || payload; if (msg) mergeMessages(msg.channel || 'public', [msg]); }
function receiveVotes(data) { if (game.value && data?.votes) game.value = { ...game.value, votes:data.votes }; }
function onConnect() { connected.value = true; reconnecting.value = false; if (game.value?.code) emitWithAck('game:state', { code:game.value.code, playerCode:getPlayerCode() }).then(data => { receiveState(data); return loadHistory(); }).catch(()=>{}); }
function onDisconnect() { connected.value = false; reconnecting.value = true; }
async function maybeAutoJoin() {
  if (game.value) return;
  const savedName = profile.value?.name;
  const savedCode = profile.value?.playerCode;
  const target = initialCode.value;
  if (!target || !savedName || !savedCode) return;
  await joinGame({ name: savedName, roomCode: target }).catch(() => {});
}
onMounted(() => { if (isAdminRoute) return; clock = setInterval(() => now.value = Date.now(), 1000); socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); ['game:state','phase:updated','action:state','game:ended'].forEach(e => socket.on(e, receiveState)); socket.on('vote:state',receiveVotes); socket.on('chat:message', receiveMessage); socket.on('game:kicked', receiveKicked); ensureConnected().then(maybeAutoJoin).catch(() => {}); });
onBeforeUnmount(() => { if (isAdminRoute) return; clearInterval(clock); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); ['game:state','phase:updated','action:state','game:ended'].forEach(e => socket.off(e, receiveState)); socket.off('vote:state',receiveVotes); socket.off('chat:message', receiveMessage); socket.off('game:kicked', receiveKicked); });
</script>
