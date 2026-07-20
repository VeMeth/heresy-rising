<template>
  <section class="game-page">
    <div class="phase-strip" :class="game.phase">
      <div>
        <span class="phase-icon">{{ game.phase==='night'?'☾':game.phase==='ended'?'†':'☼' }}</span>
        <div><span class="eyebrow">{{ stageKicker }}</span><strong>{{ stageTitle }}</strong></div>
      </div>
      <div class="phase-time"><small>PHASE ENDS IN</small><strong>{{ timeLeft }}</strong></div>
    </div>
    <nav class="mobile-tabs"><button v-for="tab in ['roster','chat','orders']" :key="tab" :class="{active:mobileTab===tab}" @click="mobileTab=tab">{{ tab }}</button></nav>
    <div class="game-grid">
      <aside class="panel roster-panel" :class="{'mobile-hidden':mobileTab!=='roster'}">
        <header><h2>Conclave</h2><span>{{ alive.length }} alive</span></header>
        <ul class="player-list">
          <li v-for="p in players" :key="p.playerCode" :class="{dead:!p.alive,me:p.playerCode===me?.playerCode,voted:myVote?.choice===p.playerCode,selectable:votingOpen&&!myVote&&p.alive&&p.playerCode!==me?.playerCode,unavailable:!p.alive||p.playerCode===me?.playerCode,'lynch-leader':lynchLeader===p.playerCode}" @click="voteFor(p)">
            <span class="avatar">{{ initial(p.name) }}</span>
            <div><strong>{{ p.name }}</strong><span>{{ status(p) }}</span></div>
            <small v-if="votingOpen&&p.alive" class="vote-count">{{ targetVoteCount(p.playerCode) }}/{{ voteThreshold }}</small>
            <i :class="{online:p.connected}"></i>
          </li>
        </ul>
        <template v-if="votingOpen">
          <button class="ghost wide" :class="{selected:myVote?.choice==='skip','stand-down-leading':standDownLeading}" @click="castVote('skip')">Stand down <small>{{ targetVoteCount('skip') }}/{{ voteThreshold }}</small></button>
          <button v-if="myVote" class="ghost wide" @click="$emit('retract-vote')">Retract vote</button>
        </template>
        <p v-else-if="game.phase==='day' && game.round===1" class="day1-hint">Day 1 — no vote. Introduce yourself and observe.</p>
        <button class="ghost wide leave" @click="$emit('leave')">Leave session</button>
      </aside>
      <section class="panel chat-panel" :class="{'mobile-hidden':mobileTab!=='chat'}">
        <div class="channel-tabs"><button v-for="c in channels" :key="c.id" :class="{active:channel===c.id}" @click="$emit('channel',c.id)">{{ c.label }}<small>{{ c.note }}</small></button></div>
        <div ref="feed" class="message-feed">
          <div v-if="!messages.length" class="empty-chat"><strong>No transmissions recorded</strong></div>
          <template v-else>
            <div class="day-sections">
              <section v-for="day in pastDays" :key="day.label" class="day-section">
                <header class="day-header" @click="toggleDay(day.label)">
                  <span class="day-toggle">{{ day.expanded ? '▼' : '▶' }}</span>
                  <strong>{{ day.label }}</strong>
                  <span class="day-count">{{ day.messages.length }}</span>
                </header>
                <div class="day-messages" v-show="day.expanded">
                  <article v-for="m in day.messages" :key="m.id" :class="['message',{system:m.kind==='system',vote:m.kind==='vote',faction:m.kind==='faction'}]">
                    <span v-if="m.kind==='system'" class="system-line">{{ m.body }}</span>
                    <template v-else>
                      <span class="avatar mini">{{ initial(m.author) }}</span>
                      <div>
                        <header><strong>{{ m.author }}</strong><time>{{ formatTime(m.createdAt) }}</time></header>
                        <p>{{ m.body }}</p>
                      </div>
                    </template>
                  </article>
                </div>
              </section>
            </div>
            <article v-for="m in currentMessages" :key="m.id" :class="['message',{system:m.kind==='system',vote:m.kind==='vote',faction:m.kind==='faction'}]">
              <span v-if="m.kind==='system'" class="system-line">{{ m.body }}</span>
              <template v-else>
                <span class="avatar mini">{{ initial(m.author) }}</span>
                <div>
                  <header><strong>{{ m.author }}</strong><time>{{ formatTime(m.createdAt) }}</time></header>
                  <p>{{ m.body }}</p>
                </div>
              </template>
            </article>
          </template>
        </div>
        <form class="composer" @submit.prevent="post">
          <textarea v-model.trim="draft" maxlength="1000" rows="2" :disabled="!canChat" :placeholder="canChat?'Transmit… (Enter to send, Shift+Enter for newline)':'Channel sealed'" @keydown.enter.exact.prevent="post"></textarea>
          <button class="primary" :disabled="!draft||!canChat">Transmit</button>
        </form>
      </section>
      <aside class="panel orders-panel" :class="{'mobile-hidden':mobileTab!=='orders'}">
        <template v-if="game.phase==='ended'">
          <div class="dossier-header">
            <span class="eyebrow">FINAL JUDGEMENT</span>
            <h2 :class="game.winner+'-win'">{{ game.winner }} victory</h2>
          </div>
          <ul class="reveal-list">
            <li v-for="p in players" :key="p.playerCode">
              <strong>{{ p.name }}</strong>
              <span :class="['role-pill', p.faction]">{{ p.role?.displayName || '—' }}</span>
            </li>
          </ul>
        </template>
        <template v-else>
          <div class="dossier-header">
            <span class="eyebrow">CLASSIFIED DOSSIER</span>
          </div>
          <div class="role-card" :class="me?.faction">
            <span class="role-sigil" aria-hidden="true">{{ me?.faction === 'heretic' ? '✶' : '☉' }}</span>
            <h2 class="role-name">{{ role.displayName }}</h2>
            <span class="role-faction" :class="me?.faction">{{ me?.faction === 'heretic' ? 'Heretic' : 'Loyalist' }}</span>
            <dl v-if="me?.drift != null || me?.crippleTier" class="role-meta">
              <div v-if="me?.drift != null"><dt>Drift</dt><dd>{{ me.drift }} / {{ game.maxDrift }}</dd></div>
              <div v-if="me?.crippleTier"><dt>Interrogation</dt><dd>Tier {{ me.crippleTier }}</dd></div>
            </dl>
          </div>
          <section class="dossier-section">
            <span class="eyebrow">Ability</span>
            <p class="dossier-text">{{ role.ability }}</p>
          </section>
          <section class="dossier-section">
            <span class="eyebrow">Objective</span>
            <p class="dossier-text objective">{{ role.objective }}</p>
          </section>
          <div v-if="game.phase==='day' && (role.actions?.day?.kind==='forgery' || me?.crippleTier>=2 || pending)" class="order-block">
            <div v-if="role.actions?.day?.kind==='forgery'" class="preset">
              <span class="eyebrow">Forgery · Once today</span>
              <label>Attributed speaker
                <select v-model="forgeAs"><option v-for="p in validTargets" :key="p.playerCode" :value="p.playerCode">{{ p.name }}</option></select>
              </label>
              <label>Forged transmission
                <textarea v-model="forgeBody" maxlength="500"></textarea>
              </label>
              <button class="ghost wide" :disabled="!forgeAs||!forgeBody" @click="forge">Plant transmission</button>
            </div>
            <label v-if="me.crippleTier>=2" class="justify-label">
              <span class="eyebrow">Required vote justification</span>
              <textarea v-model="voteJustification" maxlength="300"></textarea>
            </label>
            <template v-if="pending?.canRespond&&pending.tier<3">
              <div class="response-card">
                <span class="eyebrow">Interrogation response · Tier {{ pending.tier }}</span>
                <p class="dossier-text">Choose your answer. The conclave is listening.</p>
                <button class="secondary wide" @click="$emit('respond','confess')">Confess</button>
                <button class="ghost wide" @click="$emit('respond','resist')">Resist</button>
                <button class="primary wide" @click="$emit('respond','refuse-break')">Refuse + break</button>
              </div>
            </template>
            <template v-else-if="pending?.tier===3">
              <div class="response-card">
                <span class="eyebrow">Forced confession</span>
                <p class="dossier-text">The suspect is crippled to Tier 3. You may demand their confession directly.</p>
                <button class="primary wide" @click="$emit('ask-confession',pending.targetCode)">Demand confession</button>
              </div>
            </template>
            <p v-else-if="pending" class="notice">Waiting for the accused to answer.</p>
          </div>
          <div v-else-if="game.phase !== 'day'" class="order-block night-directive">
            <span class="eyebrow">Night directive</span>
            <h2 class="directive-title">{{ actionLabel }}</h2>
            <template v-if="hasNightAction">
              <label v-if="variants.length" class="intensity-label">
                <span class="eyebrow">Intensity</span>
                <select v-model="variant"><option v-for="v in variants" :key="v" :value="v">{{ intensityLabel(v) }}</option></select>
              </label>
              <div class="targets">
                <button v-for="p in actionTargets" :key="p.playerCode" :class="{selected:game.myAction?.targetCode===p.playerCode}" @click="act(p.playerCode)">
                  <span class="target-avatar">{{ initial(p.name) }}</span>
                  <span class="target-name">{{ p.name }}</span>
                </button>
              </div>
              <div v-if="game.myAction" class="selected-summary">Directive locked on <strong>{{ targetName(game.myAction.targetCode) }}</strong></div>
              <button class="ghost wide" @click="$emit('retract-action')">Retract directive</button>
            </template>
            <p v-else class="notice">No directive tonight. Skipping the night counts as sleep.</p>
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>
<script setup>
import { computed,nextTick,ref,watch } from 'vue';
// TODO(heresy-spec): Q28 — Day 1 votingEnabled = false. Remove when gate is wired.
const props=defineProps({game:{type:Object,required:true},me:Object,messages:{type:Array,default:()=>[]},channel:String,busy:Boolean,now:Number,hasMore:{type:Boolean,default:true},votingEnabled:{type:Boolean,default:true}});const emit=defineEmits(['channel','send','history','vote','retract-vote','action','retract-action','respond','ask-confession','leave']);
const draft=ref(''),mobileTab=ref('chat'),feed=ref(null),variant=ref(''),forgeAs=ref(''),forgeBody=ref(''),voteJustification=ref('');
const dayExpanded = ref({});
function isDayStart(m){return m.kind==='system'&&/Day\s+\d+(\s*:|\s+begins)/i.test(m.body);}
function isDayEnd(m){return m.kind==='system'&&/(concludes with no vote|conclave stands down|was interrogated and left|was lynched and revealed)/i.test(m.body);}
function nightStart(msgs,markerIdx,lowerBound){let start=markerIdx;for(let j=markerIdx-1;j>lowerBound;j--){const m=msgs[j];if(m.kind==='player'){start=j+1;break;}if(isDayStart(m)){start=j+1;break;}if(isDayEnd(m)){start=j+1;break;}start=j;}return start;}
const players=computed(()=>props.game.players||[]),alive=computed(()=>players.value.filter(p=>p.alive)),role=computed(()=>props.me?.role||{}),nightAction=computed(()=>role.value.actions?.night),hasNightAction=computed(()=>nightAction.value&&nightAction.value.kind!=='sleep'),variants=computed(()=>nightAction.value?.variants||[]),pending=computed(()=>props.game.pendingInterrogation),validTargets=computed(()=>alive.value.filter(p=>p.playerCode!==props.me?.playerCode)),myVote=computed(()=>props.game.votes?.find(v=>v.voterCode===props.me?.playerCode)),voteThreshold=computed(()=>props.game.votes?.[0]?.threshold||Math.floor(alive.value.length/2)+1),voteCounts=computed(()=>{const counts={};for(const v of props.game.votes||[])counts[v.choice]=(counts[v.choice]||0)+1;return counts;}),votingOpen=computed(()=>props.votingEnabled&&props.game.phase==='day'&&!pending.value),pastDays=computed(()=>{const msgs=props.messages;if(!msgs.length)return[];const markers=[];for(let i=0;i<msgs.length;i++){if(isDayStart(msgs[i]))markers.push(i);}if(markers.length<2)return[];const sections=[];for(let d=0;d<markers.length-1;d++){const start=d===0?markers[0]:nightStart(msgs,markers[d],d>0?markers[d-1]:-1);const end=nightStart(msgs,markers[d+1],markers[d]);const dayNum=msgs[markers[d]].body.match(/Day\s+(\d+)/i)?.[1]||(d+1);const label=`Day ${dayNum}`;sections.push({label,messages:msgs.slice(start,end),expanded:dayExpanded.value[label]??false});}return sections;}),currentMessages=computed(()=>{const msgs=props.messages;if(!msgs.length)return[];let lastMarker=-1;for(let i=msgs.length-1;i>=0;i--){if(isDayStart(msgs[i])){lastMarker=i;break;}}if(lastMarker===-1)return msgs;let prevMarker=-1;for(let i=lastMarker-1;i>=0;i--){if(isDayStart(msgs[i])){prevMarker=i;break;}}const start=nightStart(msgs,lastMarker,prevMarker);return msgs.slice(start);});
function toggleDay(label){dayExpanded.value[label]=!dayExpanded.value[label];}
watch(variants,v=>variant.value=v[0]||'',{immediate:true});
let preChangeHeight=0,preChangeScrollTop=0;
watch(()=>props.messages.length,()=>{
  const el=feed.value;
  if(el){preChangeHeight=el.scrollHeight;preChangeScrollTop=el.scrollTop;}
});
watch(()=>props.messages,()=>nextTick(()=>{
  const el=feed.value;
  if(!el)return;
  const heightDelta=el.scrollHeight-preChangeHeight;
  const wasNearBottom=preChangeHeight-preChangeScrollTop-el.clientHeight<80;
  if(wasNearBottom)el.scrollTop=el.scrollHeight;
  else if(heightDelta>0)el.scrollTop=preChangeScrollTop+heightDelta;
}),{deep:false});
watch(()=>props.channel,()=>{dayExpanded.value={};});
const actionTargets=computed(()=>alive.value.filter(p=>{if(nightAction.value?.target==='any')return true;if(p.playerCode===props.me?.playerCode){return nightAction.value?.kind==='protect';}if(nightAction.value?.target==='hostile')return p.faction!=='heretic';return true}));
const channels=computed(()=>[{id:'public',label:'Conclave',note:'public'},...(props.me?.faction==='heretic'?[{id:'faction',label:'Cabal',note:'heretics'}]:[]),{id:'private',label:'Private',note:'your eyes only'},...(!props.me?.alive?[{id:'graveyard',label:'Graveyard',note:'dead'}]:[])]),canChat=computed(()=>props.game.phase!=='ended'&&(props.channel!=='public'||props.game.phase!=='night')&&(props.me?.alive||props.channel==='graveyard'));
const deadline=computed(()=>props.game.deadline),timeLeft=computed(()=>{if(!deadline.value)return'—';const s=Math.max(0,Math.floor((deadline.value-props.now)/1000));return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}),stageTitle=computed(()=>props.game.phase==='day'?`Day ${props.game.round} · ${props.game.dayStage}`:props.game.phase==='night'?`Night ${props.game.round}`:props.game.phase),stageKicker=computed(()=>props.game.phase==='night'?'THE LIGHT WITHDRAWS':'THE CONCLAVE SITS'),actionLabel=computed(()=>hasNightAction.value?pretty(nightAction.value.kind):'Keep the vigil'),lynchLeader=computed(()=>{if(!votingOpen.value)return null;const counts=voteCounts.value;let leader=null,max=-1;for(const [code,count] of Object.entries(counts)){if(code==='skip')continue;if(count>max){max=count;leader=code;}}return leader}),standDownLeading=computed(()=>{if(!votingOpen.value)return false;const skip=voteCounts.value.skip||0;for(const [code,count] of Object.entries(voteCounts.value)){if(code!=='skip'&&count>=skip)return false;return true;}});
function castVote(choice){emit('vote',{choice,justification:voteJustification.value})}
function voteFor(p){if(!votingOpen.value||!p.alive||p.playerCode===props.me?.playerCode)return;if(myVote.value?.choice===p.playerCode)return;castVote(p.playerCode)}function act(targetCode){emit('action',{targetCode,variant:variant.value||undefined})}function forge(){emit('action',{asPlayerCode:forgeAs.value,body:forgeBody.value});forgeBody.value=''}function post(){if(draft.value&&canChat.value){emit('send',draft.value);draft.value=''}}function initial(n){return(n||'?')[0].toUpperCase()}function pretty(s){return String(s||'').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}function intensityLabel(v){return v==='T1'?'T1 — Soft':v==='T2'?'T2 — Standard':v==='T3'?'T3 — Brutal':pretty(v)}function status(p){if(!p.alive)return'Deceased';if(p.crippleTier)return`Interrogation Tier ${p.crippleTier}`;return p.connected?'Observing':'Vox lost'}function formatTime(t){return t?new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}function targetVoteCount(choice){return voteCounts.value[choice]||0}
function targetName(code){return players.value.find(p=>p.playerCode===code)?.name||'unknown';}
</script>

<style scoped>
.day1-hint {
  font: 400 11px/1.5 Inter, sans-serif;
  color: #d4a84a;
  text-align: center;
  padding: 8px 10px;
  margin: 6px 0 10px;
  background: rgba(255, 193, 7, 0.06);
  border: 1px solid rgba(255, 193, 7, 0.25);
  border-radius: 2px;
  letter-spacing: 0.04em;
}
.player-list li.lynch-leader {
  border-color: #ff3333;
  background: rgba(255, 51, 51, 0.18);
  box-shadow:
    0 0 0 1px rgba(255, 51, 51, 0.35),
    0 0 20px rgba(255, 51, 51, 0.35);
  animation: lynchPulse 1s ease-in-out infinite alternate;
}

.player-list li.voted {
  opacity: 0.55;
  cursor: not-allowed;
  background: rgba(182, 154, 92, 0.08);
  box-shadow: inset 3px 0 0 var(--gold);
}
.player-list li.voted:hover { background: rgba(182, 154, 92, 0.08); }

@keyframes lynchPulse {
  from { box-shadow: 0 0 0 1px rgba(255, 51, 51, 0.35), 0 0 14px rgba(255, 51, 51, 0.25); }
  to   { box-shadow: 0 0 0 1px rgba(255, 51, 51, 0.55), 0 0 28px rgba(255, 51, 51, 0.5); }
}

button.ghost.wide.stand-down-leading {
  border-color: #4caf50;
  background: rgba(76, 175, 80, 0.18);
  box-shadow:
    0 0 0 1px rgba(76, 175, 80, 0.35),
    0 0 16px rgba(76, 175, 80, 0.3);
  animation: standDownPulse 1.2s ease-in-out infinite alternate;
}

@keyframes standDownPulse {
  from { box-shadow: 0 0 0 1px rgba(76, 175, 80, 0.3), 0 0 10px rgba(76, 175, 80, 0.2); }
  to   { box-shadow: 0 0 0 1px rgba(76, 175, 80, 0.5), 0 0 22px rgba(76, 175, 80, 0.4); }
}

.message.faction {
  border-left: 3px solid #ff6b6b;
  background: rgba(255, 107, 107, 0.08);
}

.message.faction header strong {
  color: #ff6b6b;
}

.message.faction p {
  color: #ff6b6b;
}

.day-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.day-section {
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--panel);
  overflow: hidden;
}
.day-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--panel2);
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  user-select: none;
}
.day-header:hover { background: #1a1d18; }
.day-toggle {
  font-size: 10px;
  color: var(--gold);
  width: 14px;
  text-align: center;
}
.day-label {
  font: 600 12px Cinzel;
  color: var(--gold2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.day-count {
  margin-left: auto;
  font: 500 10px Inter;
  color: var(--muted);
}
.day-messages {
  padding: 8px 12px;
  max-height: 300px;
  overflow-y: auto;
}
.day-messages .message { margin-bottom: 8px; }
.day-messages .message:last-child { margin-bottom: 0; }

/* ── Classified Dossier ────────────────────────────────────────────────── */
.orders-panel { padding-top: 22px; }
.orders-panel > .eyebrow { margin-top: 0; }

.dossier-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
}
.dossier-header > .eyebrow { color: var(--gold); letter-spacing: 0.2em; }
.dossier-header h2 {
  font: 700 22px Cinzel;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 4px 0 0;
}


.role-card {
  position: relative;
  text-align: center;
  padding: 22px 18px 18px;
  margin: 0 0 18px;
  background: linear-gradient(180deg, rgba(24, 26, 22, 0.95), rgba(13, 15, 13, 0.95));
  border: 1px solid #4a4530;
  border-top: 2px solid var(--gold);
  overflow: hidden;
}
.role-card.loyalist { border-top-color: #b69a5c; }
.role-card.heretic { border-top-color: #c14545; background: linear-gradient(180deg, rgba(34, 18, 18, 0.95), rgba(15, 11, 11, 0.95)); border-color: #6b3030; }
.role-card::before {
  content: "";
  position: absolute;
  inset: 6px;
  border: 1px solid rgba(182, 154, 92, 0.18);
  pointer-events: none;
}
.role-card.heretic::before { border-color: rgba(193, 69, 69, 0.2); }

.role-sigil {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0 auto 8px;
  border: 1px solid var(--gold);
  color: var(--gold2);
  font: 700 14px Cinzel, serif;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 50%;
}
.role-card.heretic .role-sigil { border-color: #c14545; color: #d77272; }

.role-name {
  font: 700 20px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--pale);
  margin: 0 0 6px;
}
.role-faction {
  display: inline-block;
  font: 700 10px/1 Inter, sans-serif;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 4px 10px;
  margin-bottom: 14px;
  border: 1px solid currentColor;
}
.role-faction.loyalist { color: #c8dabc; background: rgba(76, 110, 60, 0.12); }
.role-faction.heretic { color: #ff8a8a; background: rgba(140, 40, 40, 0.18); }

.role-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 0;
  padding: 12px 10px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(182, 154, 92, 0.15);
  text-align: left;
}
.role-card.heretic .role-meta { border-color: rgba(193, 69, 69, 0.18); }
.role-meta > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.role-meta dt {
  font: 500 8px/1 Inter, sans-serif;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}
.role-meta dd {
  font: 600 12px Inter, sans-serif;
  color: var(--pale);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dossier-section {
  margin: 0 0 16px;
  padding: 14px 14px 12px;
  background: rgba(13, 15, 13, 0.6);
  border-left: 2px solid var(--gold);
}
.dossier-section .eyebrow {
  display: block;
  margin: 0 0 8px;
  color: var(--gold);
}
.dossier-text {
  font: 400 13px/1.55 Georgia, serif;
  color: #d4d2c4;
  margin: 0;
}
.dossier-text.objective {
  color: var(--gold2);
  font-style: italic;
}

.response-card {
  margin-top: 14px;
  padding: 14px;
  background: rgba(40, 25, 25, 0.7);
  border: 1px solid #6b3030;
}
.response-card .eyebrow { color: #ff8a8a; }
.response-card .dossier-text { margin-bottom: 12px; }

.justify-label,
.intensity-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 14px 0;
}
.justify-label .eyebrow,
.intensity-label .eyebrow {
  color: var(--muted);
  letter-spacing: 0.18em;
}

.night-directive { margin-top: 6px; }
.directive-title {
  font: 700 17px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gold2);
  margin: 6px 0 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

/* Glow the action block so players can't miss their turn prompt */
.order-block {
  position: relative;
  margin-top: 18px;
  padding: 16px 14px 14px;
  background: linear-gradient(180deg, rgba(40, 32, 14, 0.55), rgba(20, 16, 8, 0.55));
  border: 1px solid var(--gold);
  border-radius: 3px;
  box-shadow:
    0 0 0 1px rgba(182, 154, 92, 0.25),
    0 0 18px rgba(255, 200, 90, 0.18),
    inset 0 0 24px rgba(182, 154, 92, 0.08);
  animation: actionGlow 2.6s ease-in-out infinite alternate;
}
@keyframes actionGlow {
  from {
    box-shadow:
      0 0 0 1px rgba(182, 154, 92, 0.22),
      0 0 14px rgba(255, 200, 90, 0.14),
      inset 0 0 20px rgba(182, 154, 92, 0.06);
  }
  to {
    box-shadow:
      0 0 0 1px rgba(182, 154, 92, 0.42),
      0 0 26px rgba(255, 200, 90, 0.32),
      inset 0 0 32px rgba(182, 154, 92, 0.14);
  }
}
.order-block .eyebrow {
  color: var(--gold);
  letter-spacing: 0.2em;
}

/* Final judgement — give the reveal list nicer pills instead of plain text rows */
.reveal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.reveal-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  background: rgba(13, 15, 13, 0.6);
  border-left: 2px solid var(--gold);
}
.role-pill {
  font: 600 10px/1 Inter, sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 8px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.role-pill.loyalist { color: #c8dabc; }
.role-pill.heretic { color: #ff8a8a; }

.notice {
  font: 400 12px/1.55 Georgia, serif;
  color: var(--muted);
  font-style: italic;
  padding: 10px 0;
  margin: 0;
  text-align: center;
}
</style>
