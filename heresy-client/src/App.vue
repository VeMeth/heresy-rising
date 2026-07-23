<template>
  <AdminView v-if="isAdminRoute" />
  <div v-else class="app">
    <header class="masthead">
      <button class="brand" @click="leaveToHome" aria-label="Heresy Rising home">
        <span class="brand-mark">H</span><span><strong>HERESY RISING</strong><small>A game of accusation and survival</small></span>
      </button>
      <div class="mast-actions">
        <button class="ghost compact" @click="openManual" aria-haspopup="dialog">Manual</button>
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
        :has-more="hasMoreByChannel[channel]"
        @ready="toggleReady" @start="startGame" @clear-errors="clearCompositionErrors"
        @configure="configureGame" @leave="leaveGame"
        @send="sendMessage" @channel-change="changeChannel" @history="loadHistory"
        @kick="kickPlayer" />
      <GameView v-else :game="game" :me="me" :messages="messages" :channel="channel"
        :has-more="hasMoreByChannel[channel]"
        :busy="busy" :now="now" :voting-enabled="game?.votingEnabled"
        @channel="changeChannel" @send="sendMessage" @history="loadHistory"
        @vote="submitVote" @retract-vote="retractVote" @action="submitAction"
        @retract-action="retractAction" @respond="respondInterrogation" @ask-confession="askConfession"
        @open-manual="openManual" @leave="leaveGame" />
    </main>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <AnnouncementOverlay :announcement="announcement" />
    <footer>Unofficial, non-commercial fan project. Not affiliated with or endorsed by Games Workshop.</footer>

    <div v-if="manualMounted && showManual" class="manual-overlay" role="dialog" aria-modal="true" aria-label="Manual">
      <button type="button" class="manual-close ghost" @click="closeManual" aria-label="Close manual">Close</button>
      <iframe v-if="!manualLoadFailed" ref="manualFrame" class="manual-frame" :src="manualUrl" title="Heresy Rising manual" referrerpolicy="no-referrer" @error="onManualIframeError" @load="onManualIframeLoad"></iframe>
      <div v-else class="manual-fallback">
        <h2>The vox cannot reach the manual</h2>
        <p>The embedded manual failed to load (network or proxy refusal). Open it in a new tab to continue.</p>
        <div class="manual-fallback-actions">
          <a :href="manualUrl" target="_blank" rel="noopener" class="secondary">Open manual in new tab</a>
          <button type="button" class="ghost" @click="closeManual">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ensureConnected, emitWithAck, getPlayerCode, setPlayerCode, socket } from './socket';
import AdminView from './components/AdminView.vue';
import AnnouncementOverlay from './components/AnnouncementOverlay.vue';
import JoinView from './components/JoinView.vue';
import LobbyView from './components/LobbyView.vue';
import GameView from './components/GameView.vue';

const game = ref(null); const busy = ref(false); const error = ref(''); const toast = ref(''); const announcement = ref(null); let announcementTimer; const compositionErrors = ref([]);
const showManual = ref(false); const manualMounted = ref(false); const manualFrame = ref(null); const manualUrl = ref('/docs/how-to-play'); const manualLoadFailed = ref(false); let manualLoadTimer = null;
function onManualIframeLoad() {
  if (manualLoadTimer) { clearTimeout(manualLoadTimer); manualLoadTimer = null; }
  manualLoadFailed.value = false;
}
function onManualIframeError() {
  if (manualLoadTimer) { clearTimeout(manualLoadTimer); manualLoadTimer = null; }
  manualLoadFailed.value = true;
}
const isAdminRoute = location.pathname.replace(/\/+$/, '') === '/admin';
const connected = ref(false); const reconnecting = ref(false); const messagesByChannel = ref({ public: [], faction: [], graveyard: [] });
const hasMoreByChannel = ref({ public: true, faction: true, graveyard: true });
const channel = ref('public'); const now = ref(Date.now()); let clock; let toastTimer;
const profile = ref(readJson('heresy-rising:profile', { playerCode: getPlayerCode() }));
const params = new URLSearchParams(location.search); const initialCode = ref((params.get('game') || params.get('room') || '').toUpperCase());
const messages = computed(() => messagesByChannel.value[channel.value] || []);
const me = computed(() => { const g = game.value; if (!g) return null; const myCode = getPlayerCode(); const found = g.players?.find(p => p.playerCode === myCode || p.isYou || (p.id != null && (p.id === g.you || p.id === g.youId))); return found || g.me || null; });
const connectionState = computed(() => connected.value ? 'online' : reconnecting.value ? 'reconnecting' : 'offline');
const connectionLabel = computed(() => connected.value ? 'Vox online' : reconnecting.value ? 'Reconnecting' : 'Vox offline');

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveProfile(data) { if (!data) return; profile.value = { ...(profile.value || {}), ...data }; localStorage.setItem('heresy-rising:profile', JSON.stringify(profile.value)); if (data.playerCode) setPlayerCode(data.playerCode); }
function saveGameCode(code){if(code)localStorage.setItem('heresy-rising:game',code);else localStorage.removeItem('heresy-rising:game');}
function normalize(data) { return data?.state || data?.game || data?.room || data || null; }
function notify(text) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 2600); }
async function command(event, payload = {}) { busy.value = true; error.value = ''; try { await ensureConnected(); const data = await emitWithAck(event, { ...payload, playerCode: getPlayerCode() }); const state = normalize(data); if (state?.code && state?.players) { game.value = state; saveGameCode(state.code); } if (data?.profile || data?.playerCode) saveProfile(data.profile || data); return data; } catch (e) { error.value = e.message; notify(e.message); throw e; } finally { busy.value = false; } }
async function createGame(form) { try { saveProfile({ name: form.name }); const data = await command('game:create', { name: form.name, mode: form.mode, options: {}, playerCode: profile.value?.playerCode }); const state=normalize(data); game.value=state; if (data?.code&&game.value&&!game.value.code)game.value.code=data.code; if(game.value?.code){saveGameCode(game.value.code);history.replaceState({},'',`?game=${game.value.code}`);messagesByChannel.value={public:[],faction:[],graveyard:[]};hasMoreByChannel.value={public:true,faction:true,graveyard:true};await loadHistory();}}catch{}}
async function joinGame(form) { try { saveProfile({ name: form.name }); const data = await command('game:join', { code: form.roomCode, name: form.name, playerCode: profile.value?.playerCode }); const state=normalize(data); game.value=state; if(game.value?.code)saveGameCode(game.value.code);history.replaceState({},'',`?game=${game.value.code||form.roomCode}`);messagesByChannel.value={public:[],faction:[],graveyard:[]};hasMoreByChannel.value={public:true,faction:true,graveyard:true};await loadHistory();}catch{}}
async function recoverProfile(code) { if (!code) return; setPlayerCode(code); saveProfile({ playerCode: code }); socket.disconnect(); await ensureConnected().catch(() => {}); notify('Identity restored'); }
async function toggleReady() { try { await command('game:ready', { code: game.value.code, ready: !me.value?.ready }); } catch {} }
async function kickPlayer(targetCode) { if (!targetCode || !game.value?.code) return; try { await command('game:kick', { code: game.value.code, targetCode }); } catch (e) { notify(e.message || 'Kick failed'); } }
function receiveKicked() { notify('You were removed from the conclave.'); leaveGame(); }
async function startGame(composition) { try { await command('game:start', { code: game.value.code, setup: { maxDrift: game.value.setup?.maxDrift || game.value.maxDrift, dayMs: game.value.setup?.dayMs || game.value.dayMs, nightMs: game.value.setup?.nightMs || game.value.nightMs, ...(composition ? { composition } : {}) } }); compositionErrors.value = []; channel.value = 'public'; messagesByChannel.value = { public: [], faction: [], graveyard: [] }; hasMoreByChannel.value = { public: true, faction: true, graveyard: true }; await loadHistory(); } catch (e) { if (e.data?.errors) { compositionErrors.value = e.data.errors; error.value = ''; toast.value = ''; } } }
function clearCompositionErrors() { compositionErrors.value = []; }
async function configureGame(setup) { try { await command('game:configure', { code: game.value.code, setup }); } catch (e) { notify(e.message || 'Failed to update parameters'); } }
async function sendMessage(body) { try { await command('chat:send', { code: game.value.code, channel: channel.value, body }); } catch {} }
async function loadHistory(before) { try { if (before == null) { let all = []; let cursor; let hasMore = true; while (hasMore) { const data = await command('chat:history', { code: game.value.code, playerCode: profile.value?.playerCode, channel: channel.value, before: cursor, limit: 100 }); const batch = data?.messages || []; if (!batch.length) break; all = [...batch, ...all]; hasMore = !!data?.hasMore; cursor = batch[0]?.id; if (!cursor) break; } messagesByChannel.value = { ...messagesByChannel.value, [channel.value]: all }; hasMoreByChannel.value = { ...hasMoreByChannel.value, [channel.value]: hasMore }; } else { const data = await command('chat:history', { code: game.value.code, playerCode: profile.value?.playerCode, channel: channel.value, before, limit: 50 }); mergeMessages(channel.value, data?.messages || [], true); hasMoreByChannel.value = { ...hasMoreByChannel.value, [channel.value]: !!data?.hasMore }; } } catch {} }
async function submitVote(payload) { try { const vote=typeof payload==='string'?{choice:payload}:payload; const data=await command('vote:submit', { code: game.value.code, targetCode: vote.choice, justification: vote.justification }); if(data?.votes) game.value={...game.value,votes:data.votes}; } catch {} }
async function retractVote() { try { await command('vote:retract', { code: game.value.code }); } catch {} }
async function submitAction(payload) { try { const data=await command('action:submit', { code: game.value.code, ...(typeof payload==='string'?{targetCode:payload}:payload) }); if(data?.action) game.value={...game.value,myAction:data.action}; } catch {} }
async function retractAction() { try { const data = await command('action:retract', { code: game.value.code }); if (data?.action === null) game.value = { ...game.value, myAction: null }; } catch {} }
async function respondInterrogation(response) { try { await command('interrogation:respond', { code: game.value.code, response }); } catch {} }
async function askConfession(targetCode) { try { await command('confession:ask', { code: game.value.code, targetCode }); } catch {} }
async function leaveGame() { try { if (game.value) await command('game:leave', { code: game.value.code }); } catch {} game.value = null; saveGameCode(null); messagesByChannel.value = { public: [], faction: [], graveyard: [] }; history.replaceState({}, '', location.pathname); }
function leaveToHome() { if (!game.value || confirm('Leave this game? You can return with the same player code.')) leaveGame(); }
function openManual(path) {
  manualUrl.value = path || '/docs/how-to-play';
  manualMounted.value = true;
  manualLoadFailed.value = false;
  showManual.value = true;
  if (manualLoadTimer) clearTimeout(manualLoadTimer);
  manualLoadTimer = setTimeout(() => {
    manualLoadTimer = null;
    if (showManual.value) manualLoadFailed.value = true;
  }, 8000);
}
function closeManual() {
  showManual.value = false;
  if (manualLoadTimer) { clearTimeout(manualLoadTimer); manualLoadTimer = null; }
}
function onManualKeydown(e) { if (e.key === 'Escape' && showManual.value) closeManual(); }
function onManualMessage(e) { if (e?.data && e.data.type === 'close-manual' && showManual.value) closeManual(); }

function changeChannel(next) { channel.value = next; if (!messagesByChannel.value[next]?.length) { hasMoreByChannel.value = { ...hasMoreByChannel.value, [next]: true }; loadHistory(); } }
function mergeMessages(ch, incoming, prepend = false) {
  const old = messagesByChannel.value[ch] || [];
  // Dedup by id when present (the common path — server always returns ids).
  // Fall back to a stable counter for synthetic messages without ids so two
  // distinct broadcasts with the same author/createdAt can't collide.
  const fallback = (m) => `synthetic:${m.createdAt || Date.now()}:${m.author || ''}:${(m.body || '').length}:${m.keyNonce || ''}`;
  const map = new Map((prepend ? [...incoming, ...old] : [...old, ...incoming]).map(m => [m.id ?? m.sequence ?? fallback(m), m]));
  // Sort by numeric createdAt (ms since epoch). Don't use Date.parse() — it
  // stringifies its argument and Date.parse("1721000000000") is NaN, which
  // makes the comparator return NaN and the order undefined.
  messagesByChannel.value = { ...messagesByChannel.value, [ch]: [...map.values()].sort((a, b) => Number(a.createdAt) - Number(b.createdAt)) };
}
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
function receiveState(data) { const state = normalize(data); if (state) { game.value = state; saveGameCode(state.code); if (state.privateMessages?.length) mergeMessages('public', state.privateMessages); } }
function receiveMessage(payload) { const msg = payload?.message || payload; if (msg) mergeMessages(msg.channel || 'public', [msg]); }
function receiveVotes(data) { if (game.value && data?.votes) game.value = { ...game.value, votes:data.votes }; }
function receiveAnnouncement(payload) {
  const a = payload?.announcement || payload;
  if (!a) return;
  announcement.value = a;
  clearTimeout(announcementTimer);
  const duration = a.type === 'gameover' ? 8000 : 5000;
  announcementTimer = setTimeout(() => { announcement.value = null; }, duration);
}
function onConnect() { connected.value = true; reconnecting.value = false; const code=game.value?.code||readJson('heresy-rising:game'); if(code) emitWithAck('game:state', { code, playerCode:getPlayerCode() }).then(data=>{ receiveState(data); return loadHistory(); }).catch(()=>{}); }
function onDisconnect() { connected.value = false; reconnecting.value = true; }
async function maybeAutoJoin() {
  if (game.value) return;
  const savedName = profile.value?.name;
  const savedCode = profile.value?.playerCode;
  const target = initialCode.value;
  if (!target || !savedName || !savedCode) return;
  await joinGame({ name: savedName, roomCode: target }).catch(() => {});
}
onMounted(() => { if (isAdminRoute) return; clock = setInterval(() => now.value = Date.now(), 1000); socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); ['game:state','phase:updated','action:state','game:ended'].forEach(e => socket.on(e, receiveState)); socket.on('vote:state',receiveVotes); socket.on('chat:message', receiveMessage); socket.on('game:announcement', receiveAnnouncement); socket.on('game:kicked', receiveKicked); window.addEventListener('keydown', onManualKeydown); window.addEventListener('message', onManualMessage); ensureConnected().then(maybeAutoJoin).catch(() => {}); });
onBeforeUnmount(() => { if (isAdminRoute) return; clearInterval(clock); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); ['game:state','phase:updated','action:state','game:ended'].forEach(e => socket.off(e, receiveState)); socket.off('vote:state',receiveVotes); socket.off('chat:message', receiveMessage); socket.off('game:announcement', receiveAnnouncement); socket.off('game:kicked', receiveKicked); window.removeEventListener('keydown', onManualKeydown); window.removeEventListener('message', onManualMessage); });
</script>

<style scoped>
.manual-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(6, 7, 6, 0.96);
  display: flex;
  flex-direction: column;
}
.manual-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 51;
  padding: 8px 16px;
  font: 700 10px Inter, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.manual-frame {
  flex: 1 1 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #090a09;
}
.manual-fallback {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
  color: var(--pale, #e8e4d5);
}
.manual-fallback h2 {
  font: 700 22px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #b69a5c;
  margin: 0;
}
.manual-fallback p {
  font: 400 14px/1.55 Georgia, serif;
  color: #aaa99d;
  max-width: 480px;
  margin: 0;
}
.manual-fallback-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}
.manual-fallback-actions a.secondary,
.manual-fallback-actions button {
  padding: 12px 20px;
  font: 700 10px Inter, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  text-decoration: none;
  display: inline-block;
}
</style>
