<template>
  <AdminView v-if="isAdminRoute" />
  <div v-else class="app" :class="game ? 'phase-' + game.phase : ''">
    <EmberField />
    <header class="masthead">
      <button class="brand" @click="leaveToHome" aria-label="Heresy Rising home">
        <img class="brand-logo" src="/logo.svg" alt="" width="46" height="46" />
        <span><strong>HERESY RISING</strong><small>A game of accusation and survival</small></span>
      </button>
      <!-- Replaces the old static "CONCLAVE {{ code }}" label that used to
           sit in .mast-actions: the switcher already shows the current code
           here, so a second copy on the right would just be clutter. -->
      <ConclaveSwitcher :current-code="game?.code || ''" @switch="switchToGame" />
      <div class="mast-actions">
        <button class="ghost compact" @click="openManual" aria-haspopup="dialog">Manual</button>
        <!-- Observing admins hold no seat, so they have no avatar for the
             usual gold-seal ring (see LobbyView/GameView .admin-seal) — this
             is their only persistent "you're in admin mode" cue. -->
        <span v-if="adminObserver" class="connection admin-mode" title="Full-visibility admin observer — no seat, nothing you do here is visible to the table.">Admin</span>
        <span class="connection" :class="connectionState"><i></i>{{ connectionLabel }}</span>
        <button v-if="game" class="ghost compact" @click="copyInvite">Copy invite</button>
        <SettingsMenu />
      </div>
    </header>

    <main>
      <JoinView v-if="!game" :busy="busy" :error="error" :initial-room-code="initialCode"
        :profile="profile" @create="createGame" @join="joinOrSpectate" @recover="recoverProfile" @observe="observeGame" @admin-create="adminCreateGame" />
      <LobbyView v-else-if="game.phase === 'lobby'" :game="game" :me="me" :busy="busy"
        :composition-errors="compositionErrors" :messages="messages"
        :has-more="hasMoreByChannel[channel]" :admin-observer="adminObserver"
        @ready="toggleReady" @start="startGame" @clear-errors="clearCompositionErrors"
        @configure="configureGame" @leave="leaveGame"
        @send="sendMessage" @history="loadHistory"
        @kick="kickPlayer" />
      <GameView v-else :game="game" :me="me" :messages="messages" :channel="channel"
        :has-more="hasMoreByChannel[channel]"
        :busy="busy" :now="now" :spectator="spectator" :admin-observer="adminObserver" :voting-enabled="game?.votingEnabled"
        :notes="notes" :bookmarks="bookmarks" :ensure-channel-history="ensureChannelHistory"
        @channel="changeChannel" @send="sendMessage" @send-as="sendMessageAs" @history="loadHistory"
        @vote="submitVote" @retract-vote="retractVote" @vote-as="submitVoteAs" @retract-vote-as="retractVoteAs" @action="submitAction"
        @faction-action="submitFactionAction"
        @retract-action="retractAction"
        @open-manual="openManual" @leave="leaveGame"
        @notes-add="addNote" @notes-edit="editNote" @notes-delete="deleteNote"
        @bookmark-toggle="toggleBookmark" @bookmark-annotate="annotateBookmark"
        @notify="notify" />
    </main>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <AnnouncementOverlay :announcement="announcement" @dismiss="dismissAnnouncement" />
    <footer>Unofficial, non-commercial fan project. Not affiliated with or endorsed by Games Workshop.</footer>

    <Transition name="manual">
      <div v-if="manualMounted" v-show="showManual" class="manual-overlay" role="dialog" aria-modal="true" aria-label="Manual">
        <iframe
          class="manual-frame"
          :src="manualUrl"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          title="Heresy Rising manual"
        ></iframe>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ensureConnected, emitWithAck, getPlayerCode, setPlayerCode, socket } from './socket';
import { settings, loadSettings } from './settings.js';
import AdminView from './components/AdminView.vue';
import AnnouncementOverlay from './components/AnnouncementOverlay.vue';
import EmberField from './components/EmberField.vue';
import JoinView from './components/JoinView.vue';
import LobbyView from './components/LobbyView.vue';
import GameView from './components/GameView.vue';
import SettingsMenu from './components/SettingsMenu.vue';
import ConclaveSwitcher from './components/ConclaveSwitcher.vue';
import newPhaseSoundUrl from './assets/new-phase.mp3';
import newVoteSoundUrl from './assets/new-vote.mp3';

const game = ref(null); const busy = ref(false); const error = ref(''); const toast = ref(''); const announcement = ref(null); let announcementTimer; const compositionErrors = ref([]); let previousPhase = null;
const showManual = ref(false); const manualMounted = ref(false); const manualUrl = ref('/docs/how-to-play');
const isAdminRoute = location.pathname.replace(/\/+$/, '') === '/admin';
const connected = ref(false); const reconnecting = ref(false); const messagesByChannel = ref({ public: [], faction: [], graveyard: [] });
const notes = ref([]); const bookmarks = ref([]);
const hasMoreByChannel = ref({ public: true, faction: true, graveyard: true });
const channel = ref('public'); const now = ref(Date.now()); let clock; let toastTimer;
const profile = ref(readJson('heresy-rising:profile', { playerCode: getPlayerCode() }));
const params = new URLSearchParams(location.search); const initialCode = ref((params.get('game') || params.get('room') || '').toUpperCase()); let audioUnlocked = false;
const messages = computed(() => messagesByChannel.value[channel.value] || []);
const me = computed(() => { const g = game.value; if (!g) return null; const myCode = getPlayerCode(); const found = g.players?.find(p => p.playerCode === myCode); return found || g.me || null; });
const connectionState = computed(() => connected.value ? 'online' : reconnecting.value ? 'reconnecting' : 'offline');
const connectionLabel = computed(() => connected.value ? 'Vox online' : reconnecting.value ? 'Reconnecting' : 'Vox offline');
const spectator = computed(() => game.value?.isSpectator === true);
const adminObserver = computed(() => game.value?.isAdminObserver === true);

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveProfile(data) { if (!data) return; profile.value = { ...(profile.value || {}), ...data }; localStorage.setItem('heresy-rising:profile', JSON.stringify(profile.value)); if (data.playerCode) setPlayerCode(data.playerCode); }
function saveGameCode(code){if(code)localStorage.setItem('heresy-rising:game',code);else localStorage.removeItem('heresy-rising:game');}
function normalize(data) { return data?.state || data?.game || data?.room || data || null; }
function notify(text) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 2600); }
async function command(event, payload = {}) { busy.value = true; error.value = ''; try { await ensureConnected(); const data = await emitWithAck(event, { ...payload, playerCode: getPlayerCode() }); const state = normalize(data); if (state?.code && state?.players) { game.value = state; saveGameCode(state.code); } if (data?.profile || data?.playerCode) saveProfile(data.profile || data); return data; } catch (e) { error.value = e.message; notify(e.message); throw e; } finally { busy.value = false; } }
async function createGame(form) { try { saveProfile({ name: form.name }); const data = await command('game:create', { name: form.name, mode: form.mode, options: {}, playerCode: profile.value?.playerCode }); const state=normalize(data); game.value=state; if (data?.code&&game.value&&!game.value.code)game.value.code=data.code; if(game.value?.code){saveGameCode(game.value.code);history.replaceState({},'',`?game=${game.value.code}`);messagesByChannel.value={public:[],faction:[],graveyard:[]};hasMoreByChannel.value={public:true,faction:true,graveyard:true};await loadHistory();await loadNotes();}}catch{}}
async function joinGame(form) { saveProfile({ name: form.name }); const data = await command('game:join', { code: form.roomCode, name: form.name, playerCode: profile.value?.playerCode }); const state=normalize(data); game.value=state; if(game.value?.code)saveGameCode(game.value.code);history.replaceState({},'',`?game=${game.value.code||form.roomCode}`);messagesByChannel.value={public:[],faction:[],graveyard:[]};hasMoreByChannel.value={public:true,faction:true,graveyard:true};await loadHistory();await loadNotes();}
async function joinOrSpectate(form) {
  // A player who isn't already in the game will fail to join once it has
  // started (or is full) — fall back to read-only spectating instead of
  // leaving them stuck on the join screen.
  await joinGame(form).catch(() => spectateGame(form.roomCode));
}
async function recoverProfile(code) { if (!code) return; setPlayerCode(code); saveProfile({ playerCode: code }); socket.disconnect(); await ensureConnected().catch(() => {}); await loadSettings(); notify('Identity restored'); }
// Every game the switcher lists is one this playerCode has an actual seat
// in (listPlayerGames() joins on hr_players — a spectated-only game never
// appears there), so this always goes through the real reconnect path,
// never game:spectate.
async function switchToGame(code) {
  if (!code || code === game.value?.code) return;
  try {
    await ensureConnected();
    const data = await emitWithAck('game:state', { code, playerCode: getPlayerCode() });
    const state = normalize(data);
    if (state) {
      game.value = state;
      saveGameCode(state.code);
      history.replaceState({}, '', `?game=${state.code}`);
      saveProfile({ playerCode: getPlayerCode(), isSpectator: false });
      channel.value = 'public';
      messagesByChannel.value = { public: [], faction: [], graveyard: [] };
      hasMoreByChannel.value = { public: true, faction: true, graveyard: true };
      await loadHistory();
      await loadNotes();
    }
  } catch (e) { notify(e.message || 'Unable to switch conclaves.'); }
}
async function spectateGame(code) {
  if (!code) return;
  try {
    await ensureConnected();
    const data = await emitWithAck('game:spectate', { code });
    const state = normalize(data);
    if (state) {
      game.value = state;
      saveGameCode(state.code);
      history.replaceState({}, '', `?game=${state.code}`);
      // data.playerCode is a throwaway spec_ tag the server mints purely to
      // filter broadcasts to this socket (index.js game:spectate handler) —
      // nothing persists it server-side, so it must never overwrite the
      // real identity createGame()/joinGame() read from profile.playerCode.
      saveProfile({ isSpectator: true });
      messagesByChannel.value = { public: [], faction: [], graveyard: [] };
      hasMoreByChannel.value = { public: true, faction: true, graveyard: true };
      await loadHistory();
    }
  } catch (e) { error.value = e.message; notify(e.message); }
}
// Admin full-visibility observer: never inserts an hr_players row server-side
// (see game:admin-observe), so this deliberately skips saveProfile/loadNotes/
// loadHistory — there is no player seat to attach notes/bookmarks to, and
// chat:history's per-channel authorization assumes a real player. The
// adminState payload already carries everything (allMessages/allActions/
// allVotes/unredacted roles) in one shot, and keeps arriving live via the
// same game:state/phase:updated/game:ended pushes every other viewer gets
// (see receiveState) — GameView reads game.allMessages directly for this
// viewer rather than the per-channel messagesByChannel history flow.
async function observeGame(form) {
  const roomCode = form?.roomCode;
  if (!roomCode) return;
  try {
    await ensureConnected();
    const data = await emitWithAck('game:admin-observe', { code: roomCode });
    const state = normalize(data);
    if (state) {
      game.value = state;
      saveGameCode(state.code);
      history.replaceState({}, '', `?game=${state.code}`);
      channel.value = 'public';
      messagesByChannel.value = { public: [], faction: [], graveyard: [] };
      hasMoreByChannel.value = { public: true, faction: true, graveyard: true };
    }
  } catch (e) { notify(e.message || 'Observe failed'); }
}
// Admin-only: found a Conclave without taking a seat in it — same
// no-hr_players-row contract as observeGame above, so the same bookkeeping
// (or lack of it) applies.
async function adminCreateGame(form) {
  try {
    await ensureConnected();
    const data = await emitWithAck('game:admin-create', { mode: form?.mode || 'live' });
    const state = normalize(data);
    if (state) {
      game.value = state;
      saveGameCode(state.code);
      history.replaceState({}, '', `?game=${state.code}`);
      channel.value = 'public';
      messagesByChannel.value = { public: [], faction: [], graveyard: [] };
      hasMoreByChannel.value = { public: true, faction: true, graveyard: true };
    }
  } catch (e) { notify(e.message || 'Could not found conclave'); }
}
async function toggleReady() { try { await command('game:ready', { code: game.value.code, ready: !me.value?.ready }); } catch {} }
async function kickPlayer(targetCode) { if (!targetCode || !game.value?.code) return; try { await command('game:kick', { code: game.value.code, targetCode }); } catch (e) { notify(e.message || 'Kick failed'); } }
function receiveKicked() { notify('You were removed from the conclave.'); leaveGame(); }
async function startGame(composition) { try { await command('game:start', { code: game.value.code, setup: { maxDrift: game.value.setup?.maxDrift || game.value.maxDrift, dayMs: game.value.setup?.dayMs || game.value.dayMs, nightMs: game.value.setup?.nightMs || game.value.nightMs, ...(composition ? { composition } : {}) } }); compositionErrors.value = []; channel.value = 'public'; messagesByChannel.value = { public: [], faction: [], graveyard: [] }; hasMoreByChannel.value = { public: true, faction: true, graveyard: true }; await loadHistory(); } catch (e) { if (e.data?.errors) { compositionErrors.value = e.data.errors; error.value = ''; toast.value = ''; } } }
function clearCompositionErrors() { compositionErrors.value = []; }
async function configureGame(setup) { try { await command('game:configure', { code: game.value.code, setup }); } catch (e) { notify(e.message || 'Failed to update parameters'); } }
async function sendMessage(body) { try { await command('chat:send', { code: game.value.code, channel: channel.value, body }); } catch {} }
// H6 Animus's possession-day "speak as" — always public, no channel param
// (the server derives who you're speaking as from its own live
// possessed_by record, never from anything the client sends).
async function sendMessageAs(body) { try { await command('chat:send-as', { code: game.value.code, body }); } catch {} }
async function loadHistory(before) { try { if (before == null) { let all = []; let cursor; let hasMore = true; while (hasMore) { const data = await command('chat:history', { code: game.value.code, playerCode: profile.value?.playerCode, channel: channel.value, before: cursor, limit: 100 }); const batch = data?.messages || []; if (!batch.length) break; all = [...batch, ...all]; hasMore = !!data?.hasMore; cursor = batch[0]?.id; if (!cursor) break; } messagesByChannel.value = { ...messagesByChannel.value, [channel.value]: all }; hasMoreByChannel.value = { ...hasMoreByChannel.value, [channel.value]: hasMore }; if (channel.value === 'public') await loadPrivateHistory(); } else { const data = await command('chat:history', { code: game.value.code, playerCode: profile.value?.playerCode, channel: channel.value, before, limit: 50 }); mergeMessages(channel.value, data?.messages || [], true); hasMoreByChannel.value = { ...hasMoreByChannel.value, [channel.value]: !!data?.hasMore }; } } catch {} }
// Private notes & bookmarks. Never called for a spectator — the server's
// notes:*/bookmark:* handlers all require a real seat (requirePlayer) and
// throw otherwise, and command() would just surface that as a toast for
// something that was never going to work. Loaded once per game (game code
// first available, or a reconnect) rather than on every phase:updated,
// since that fires constantly and the arrays are otherwise kept in sync
// locally by patching in each mutation's response below.
async function loadNotes() { if (!game.value?.code || spectator.value) return; try { const data = await command('notes:list', { code: game.value.code }); notes.value = data?.notes || []; bookmarks.value = data?.bookmarks || []; } catch {} }
async function addNote({ subjectCode, body }) { try { const data = await command('notes:add', { code: game.value.code, subjectCode, body }); if (data?.note) notes.value = [...notes.value, data.note]; } catch {} }
async function editNote({ noteId, body }) { try { const data = await command('notes:edit', { code: game.value.code, noteId, body }); if (data?.note) notes.value = notes.value.map(n => n.id === data.note.id ? data.note : n); } catch {} }
async function deleteNote({ noteId }) { try { await command('notes:delete', { code: game.value.code, noteId }); notes.value = notes.value.filter(n => n.id !== noteId); } catch {} }
// bookmark:toggle both creates and removes a bookmark server-side (ack
// carries the new Bookmark, or null when the toggle removed it) — this
// mirrors that directly rather than assuming "toggle" always means "add".
async function toggleBookmark({ messageId }) { try { const data = await command('bookmark:toggle', { code: game.value.code, messageId }); if (data?.bookmark == null) { bookmarks.value = bookmarks.value.filter(b => b.messageId !== messageId); } else { const b = data.bookmark; bookmarks.value = bookmarks.value.some(x => x.messageId === b.messageId) ? bookmarks.value.map(x => x.messageId === b.messageId ? b : x) : [...bookmarks.value, b]; } } catch {} }
async function annotateBookmark({ messageId, note }) { try { const data = await command('bookmark:note', { code: game.value.code, messageId, note }); if (data?.bookmark) { const b = data.bookmark; bookmarks.value = bookmarks.value.some(x => x.messageId === b.messageId) ? bookmarks.value.map(x => x.messageId === b.messageId ? b : x) : [...bookmarks.value, b]; } } catch {} }
// The engine auto-files a bookmark straight into SQLite when it sends a
// private "here's what happened" line (a crippling, a night-action recap,
// an intel result) — that write never goes through toggleBookmark's ack, so
// without this listener the entry is invisible until the next loadNotes().
// Server targets 'bookmark:added' at the owner's own socket only (see
// broadcastBookmark in index.js) — never a room broadcast — so nothing here
// needs to check whose bookmark this is. Same replace-if-present/else-append
// merge as toggleBookmark's handler above, so a replayed event can't
// duplicate the row.
function receiveBookmarkAdded(payload) { const b = payload?.bookmark; if (!b) return; bookmarks.value = bookmarks.value.some(x => x.messageId === b.messageId) ? bookmarks.value.map(x => x.messageId === b.messageId ? b : x) : [...bookmarks.value, b]; }
// Bookmark jump target may be in a channel the view isn't currently
// showing — private messages are folded into the 'public' bucket on
// receipt (see receiveMessage below; chat:history has no 'private' channel
// at all, see heresyGameManager.js's authorizeChannel), faction/graveyard
// are real channels but only ever loaded on demand. Switches there (if
// needed) and reloads that channel's FULL history from scratch —
// loadHistory() with no cursor already loops until hasMore is false, which
// is exactly "the entire channel" GameView's onJump needs before it can
// give up and say the message truly isn't there. Whether the id actually
// turns up is for the caller (GameView) to check in the DOM afterward.
async function ensureChannelHistory(ch) { if (!game.value?.code) return; if (channel.value !== ch) channel.value = ch; await loadHistory(); }
// Engine-authored private lines (role reveal, intel returns, night-action
// reports) arrive live via receiveMessage, which folds them into the 'public'
// bucket rather than a bucket of their own. That meant a reload silently wiped
// every one of them: loadHistory only ever refetched channel 'public', and
// nothing else held them — which is why jumping to a bookmarked private line
// reported it as "outside the loaded history". Refetch them into the same
// bucket so a reload restores the full log. The server scopes this channel to
// `recipient_code = you` in SQL (see authorizeChannel/historyMessages), so it
// can never return another player's private lines; spectators are refused
// outright and skipped here too.
async function loadPrivateHistory() {
  if (!game.value?.code || spectator.value) return;
  try {
    let all = []; let cursor; let hasMore = true;
    while (hasMore) {
      const data = await command('chat:history', { code: game.value.code, playerCode: profile.value?.playerCode, channel: 'private', before: cursor, limit: 100 });
      const batch = data?.messages || []; if (!batch.length) break;
      all = [...batch, ...all]; hasMore = !!data?.hasMore; cursor = batch[0]?.id; if (!cursor) break;
    }
    if (all.length) mergeMessages('public', all);
  } catch {}
}
async function submitVote(payload) { try { const vote=typeof payload==='string'?{choice:payload}:payload; const data=await command('vote:submit', { code: game.value.code, targetCode: vote.choice, justification: vote.justification }); if(data?.votes) game.value={...game.value,votes:data.votes}; } catch {} }
async function retractVote() { try { await command('vote:retract', { code: game.value.code }); } catch {} }
async function submitVoteAs(payload) { try { const vote=typeof payload==='string'?{choice:payload}:payload; const data=await command('vote:submit-as', { code: game.value.code, targetCode: vote.choice, justification: vote.justification }); if(data?.votes) game.value={...game.value,votes:data.votes}; } catch {} }
async function retractVoteAs() { try { await command('vote:retract-as', { code: game.value.code }); } catch {} }
async function submitAction(payload) { try { const data=await command('action:submit', { code: game.value.code, ...(typeof payload==='string'?{targetCode:payload}:payload) }); if(data?.action) game.value={...game.value,myAction:data.action}; } catch {} }
async function submitFactionAction(payload) { try { const data=await command('action:submit-faction', { code: game.value.code, ...payload }); if(data?.action) game.value={...game.value,myAction:data.action}; } catch {} }
async function retractAction() { try { const data = await command('action:retract', { code: game.value.code }); if (data?.action === null) game.value = { ...game.value, myAction: null }; } catch {} }
async function leaveGame() { try { if (game.value) { const data = await command('game:leave', { code: game.value.code }); if (data?.disbanded) notify('You were the only one there — the conclave has been disbanded.'); } } catch {} game.value = null; saveGameCode(null); messagesByChannel.value = { public: [], faction: [], graveyard: [] }; notes.value = []; bookmarks.value = []; history.replaceState({}, '', location.pathname); }
function leaveToHome() { if (!game.value || confirm('Leave this game? You can return with the same player code.')) leaveGame(); }
function openManual(path) {
  manualMounted.value = true;
  // Only change src if a new path is given, otherwise the iframe keeps
  // its current page. Always show the overlay.
  if (typeof path === 'string') manualUrl.value = path;
  showManual.value = true;
  // The overlay sits on top of the game page, but doesn't stop it from
  // scrolling underneath — without this the manual's own scrollbar and
  // the game page's scrollbar both show at once. Locked here rather than
  // via a watcher since open/close are the only two places this changes.
  document.documentElement.style.overflow = 'hidden';
}
function closeManual() { showManual.value = false; document.documentElement.style.overflow = ''; }
function onManualKeydown(e) { if (e.key === 'Escape' && showManual.value) closeManual(); }
function onManualMessage(e) { if (e?.data && e.data.type === 'close-manual' && showManual.value) closeManual(); }

// Admin observer never calls loadHistory() here — chat:history's server-side
// historyMessages() throws 'Access denied' for a caller with no hr_players
// row in this game outside a narrow public/non-lobby carve-out, and there's
// nothing to fetch anyway: GameView already renders straight from
// game.allMessages (adminState) for this viewer, filtered client-side by tab.
function changeChannel(next) { channel.value = next; if (!adminObserver.value && !messagesByChannel.value[next]?.length) { hasMoreByChannel.value = { ...hasMoreByChannel.value, [next]: true }; loadHistory(); } }
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
function receiveState(data) { const state = normalize(data); if (state) { if (previousPhase && previousPhase !== state.phase) playPhaseSound(); previousPhase = state.phase; game.value = state; saveGameCode(state.code); if (state.privateMessages?.length) mergeMessages('public', state.privateMessages); } }
function unlockAudio() { if (audioUnlocked) return; audioUnlocked = true; const dummy = new Audio(); dummy.play().catch(() => {}); }
function playSound(url, label) { if (!audioUnlocked || settings.muted) return; try { const audio = new Audio(url); audio.volume = 0.5; audio.play().catch(err => console.error(`Could not play ${label} sound:`, err)); } catch(e) { console.error(`Error playing ${label} sound:`, e); } }
function playPhaseSound() { playSound(newPhaseSoundUrl, 'phase'); }
function receiveMessage(payload) { const msg = payload?.message || payload; if (msg) mergeMessages(msg.channel === 'private' ? 'public' : (msg.channel || 'public'), [msg]); }
function receiveVotes(data) { if (game.value && data?.votes) { game.value = { ...game.value, votes:data.votes }; playSound(newVoteSoundUrl, 'vote'); } }
function receiveAnnouncement(payload) {
  const a = payload?.announcement || payload;
  if (!a) return;
  // The server broadcasts every player's role-reveal announcement to the
  // whole room. Only render the one addressed to this player; non-targeted
  // announcements (kill, lynch, execution, …) show for everyone.
  if (a.targetCode && a.targetCode !== getPlayerCode()) return;
  announcement.value = a;
  clearTimeout(announcementTimer);
}
function dismissAnnouncement() { clearTimeout(announcementTimer); announcement.value = null; }
function onConnect() { connected.value = true; reconnecting.value = false; const code=game.value?.code||readJson('heresy-rising:game');const profile=readJson('heresy-rising:profile',{});if(code){if(profile.isSpectator){spectateGame(code).catch(()=>{});}else{emitWithAck('game:state',{code,playerCode:getPlayerCode()}).then(data=>{receiveState(data);return loadHistory();}).then(()=>loadNotes()).catch(()=>{});}}}
function onDisconnect() { connected.value = false; reconnecting.value = true; }
async function maybeAutoJoin() {
  if (game.value) return;
  const savedName = profile.value?.name;
  const savedCode = profile.value?.playerCode;
  const target = initialCode.value;
  if (!target || !savedName || !savedCode) return;
  await joinOrSpectate({ name: savedName, roomCode: target });
}
onMounted(() => { if (isAdminRoute) return; loadSettings(); clock = setInterval(() => now.value = Date.now(), 1000); socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); ['game:state','phase:updated','game:ended'].forEach(e => socket.on(e, receiveState)); socket.on('vote:state',receiveVotes); socket.on('chat:message', receiveMessage); socket.on('game:announcement', receiveAnnouncement); socket.on('game:kicked', receiveKicked); socket.on('bookmark:added', receiveBookmarkAdded); window.addEventListener('keydown', onManualKeydown); window.addEventListener('message', onManualMessage); window.addEventListener('click', unlockAudio, { once: true }); window.addEventListener('keydown', unlockAudio, { once: true }); ensureConnected().then(maybeAutoJoin).catch(() => {}); });
onBeforeUnmount(() => { if (isAdminRoute) return; clearInterval(clock); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); ['game:state','phase:updated','game:ended'].forEach(e => socket.off(e, receiveState)); socket.off('vote:state',receiveVotes); socket.off('chat:message', receiveMessage); socket.off('game:announcement', receiveAnnouncement); socket.off('game:kicked', receiveKicked); socket.off('bookmark:added', receiveBookmarkAdded); window.removeEventListener('keydown', onManualKeydown); window.removeEventListener('message', onManualMessage); });
</script>

<style scoped>
.connection.admin-mode {
  border: 1px solid var(--gold);
  color: var(--gold2);
  padding: 3px 9px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: .1em;
  font-size: 10px;
}
.manual-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(6, 7, 6, 0.96);
  display: flex;
  flex-direction: column;
}
.manual-frame {
  flex: 1 1 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #090a09;
  transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.3, 1), opacity 0.32s ease;
}

/* Backdrop fades; the frame itself rises and settles — same rise-in
   language as the join panel, just quick enough for a dialog. */
.manual-enter-active,
.manual-leave-active {
  transition: opacity 0.28s ease;
}
.manual-enter-from,
.manual-leave-to {
  opacity: 0;
}
.manual-enter-from .manual-frame,
.manual-leave-to .manual-frame {
  opacity: 0;
  transform: translateY(16px) scale(0.98);
}
</style>
