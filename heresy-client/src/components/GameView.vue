<template>
  <section class="game-page">
    <div class="phase-strip" :class="game.phase">
      <div>
        <span class="phase-icon">{{ game.phase==='night'?'☾':game.phase==='ended'?'†':'☼' }}</span>
        <div><span class="eyebrow">{{ stageKicker }}</span><strong>{{ stageTitle }}</strong></div>
      </div>
      <div class="phase-time"><small>PHASE ENDS IN</small><strong>{{ timeLeft }}</strong></div>
    </div>
    <div v-if="game.phase==='day' && !votingEnabled && game.round===1" class="day1-banner">Day 1 — no vote. Introduce yourself and observe.</div>
    <nav class="mobile-tabs"><button v-for="tab in ['roster','chat','orders']" :key="tab" :class="{active:mobileTab===tab}" @click="mobileTab=tab">{{ tab }}</button></nav>
    <div class="game-grid">
      <aside class="panel roster-panel" :class="{'mobile-hidden':mobileTab!=='roster'}">
        <header><h2>Conclave</h2><span>{{ alive.length }} alive</span></header>
        <ul class="player-list">
          <li v-for="p in players" :key="p.playerCode" :class="{dead:!p.alive,me:p.playerCode===me?.playerCode,selected:myVote?.choice===p.playerCode,selectable:votingOpen&&p.alive&&p.playerCode!==me?.playerCode,unavailable:!p.alive||p.playerCode===me?.playerCode,'lynch-leader':lynchLeader===p.playerCode}" @click="voteFor(p)">
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
        <template v-if="game.phase==='ended'"><span class="eyebrow">FINAL JUDGEMENT</span><h2 :class="game.winner+'-win'">{{ game.winner }} victory</h2><div class="reveal-list"><div v-for="p in players" :key="p.playerCode"><strong>{{ p.name }}</strong><span>{{ p.role?.displayName }}</span></div></div></template>
        <template v-else><span class="eyebrow">CLASSIFIED DOSSIER</span><div class="role-card"><h2>{{ role.displayName }}</h2><strong>{{ me.faction }}</strong><p>{{ role.ability }}</p><p>{{ role.objective }}</p></div>
          <div v-if="game.phase==='day'" class="order-block">
            <div v-if="role.actions?.day?.kind==='forgery'" class="preset"><span class="eyebrow">FORGERY · ONCE TODAY</span><label>Attributed speaker<select v-model="forgeAs"><option v-for="p in validTargets" :key="p.playerCode" :value="p.playerCode">{{ p.name }}</option></select></label><label>Forged transmission<textarea v-model="forgeBody" maxlength="500"></textarea></label><button class="ghost wide" :disabled="!forgeAs||!forgeBody" @click="forge">Plant transmission</button></div>
            <label v-if="me.crippleTier>=2">Required vote justification<textarea v-model="voteJustification" maxlength="300"></textarea></label>
            <template v-if="pending?.canRespond&&pending.tier<3"><span class="eyebrow">INTERROGATION RESPONSE</span><h2>Choose your answer</h2><button class="secondary wide" @click="$emit('respond','confess')">Confess</button><button class="ghost wide" @click="$emit('respond','resist')">Resist</button><button class="primary wide" @click="$emit('respond','refuse-break')">Refuse + Break</button></template>
            <template v-else-if="pending?.tier===3"><span class="eyebrow">FORCED CONFESSION</span><h2>Ask the crippled suspect</h2><button class="primary wide" @click="$emit('ask-confession',pending.targetCode)">Demand confession</button></template>
            <p v-else-if="pending" class="notice">Waiting for the accused to answer.</p>
          </div>
           <div v-else class="order-block"><span class="eyebrow">NIGHT DIRECTIVE</span><h2>{{ actionLabel }}</h2><template v-if="hasNightAction"><label v-if="variants.length">Intensity<select v-model="variant"><option v-for="v in variants" :key="v" :value="v">{{ intensityLabel(v) }}</option></select></label><div class="targets"><button v-for="p in actionTargets" :key="p.playerCode" :class="{selected:game.myAction?.targetCode===p.playerCode}" @click="act(p.playerCode)"><span>{{ initial(p.name) }}</span>{{ p.name }}</button></div><button v-if="game.myAction" class="ghost wide" @click="$emit('retract-action')">Retract directive</button></template><p v-else class="notice">No directive. Skipping the night counts as sleep.</p></div>
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
const players=computed(()=>props.game.players||[]),alive=computed(()=>players.value.filter(p=>p.alive)),role=computed(()=>props.me?.role||{}),nightAction=computed(()=>role.value.actions?.night),hasNightAction=computed(()=>nightAction.value&&nightAction.value.kind!=='sleep'),variants=computed(()=>nightAction.value?.variants||[]),pending=computed(()=>props.game.pendingInterrogation),validTargets=computed(()=>alive.value.filter(p=>p.playerCode!==props.me?.playerCode)),myVote=computed(()=>props.game.votes?.find(v=>v.voterCode===props.me?.playerCode)),voteThreshold=computed(()=>props.game.votes?.[0]?.threshold||Math.floor(alive.value.length/2)+1),voteCounts=computed(()=>{const counts={};for(const v of props.game.votes||[])counts[v.choice]=(counts[v.choice]||0)+1;return counts;}),votingOpen=computed(()=>props.votingEnabled&&props.game.phase==='day'&&!pending.value),pastDays=computed(()=>{const sections=[];let currentLabel=null;let currentMessages=[];for(let i=0;i<props.messages.length;i++){const m=props.messages[i];if(m.kind==='system'&&/^Day \d+:/i.test(m.body)){if(currentMessages.length&&currentLabel){sections.push({label:currentLabel,messages:[...currentMessages].reverse(),expanded:dayExpanded.value[currentLabel]??false});}currentLabel=m.body.replace(/^Day (\d+):.*/i,'Day $1');currentMessages=[];}else{currentMessages.push(m);}}return sections;}),currentMessages=computed(()=>{const msgs=[];let foundCurrent=false;for(let i=props.messages.length-1;i>=0;i--){const m=props.messages[i];if(m.kind==='system'&&/^Day \d+:/i.test(m.body)){foundCurrent=true;continue;}if(foundCurrent)break;msgs.unshift(m);}return msgs;});
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
const channels=computed(()=>[{id:'public',label:'Conclave',note:'public'},...(props.me?.faction==='heretic'?[{id:'faction',label:'Cabal',note:'heretics'}]:[]),...(!props.me?.alive?[{id:'graveyard',label:'Graveyard',note:'dead'}]:[])]),canChat=computed(()=>props.game.phase!=='ended'&&(props.channel!=='public'||props.game.phase!=='night')&&(props.me?.alive||props.channel==='graveyard'));
const deadline=computed(()=>props.game.deadline),timeLeft=computed(()=>{if(!deadline.value)return'—';const s=Math.max(0,Math.floor((deadline.value-props.now)/1000));return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}),stageTitle=computed(()=>props.game.phase==='day'?`Day ${props.game.round} · ${props.game.dayStage}`:props.game.phase==='night'?`Night ${props.game.round}`:props.game.phase),stageKicker=computed(()=>props.game.phase==='night'?'THE LIGHT WITHDRAWS':'THE CONCLAVE SITS'),actionLabel=computed(()=>hasNightAction.value?pretty(nightAction.value.kind):'Keep the vigil'),lynchLeader=computed(()=>{if(!votingOpen.value)return null;const counts=voteCounts.value;let leader=null,max=-1;for(const [code,count] of Object.entries(counts)){if(code==='skip')continue;if(count>max){max=count;leader=code;}}return leader}),standDownLeading=computed(()=>{if(!votingOpen.value)return false;const skip=voteCounts.value.skip||0;for(const [code,count] of Object.entries(voteCounts.value)){if(code!=='skip'&&count>=skip)return false;return true;}});
function castVote(choice){emit('vote',{choice,justification:voteJustification.value})}
function voteFor(p){if(!votingOpen.value||!p.alive||p.playerCode===props.me?.playerCode)return;castVote(p.playerCode)}function act(targetCode){emit('action',{targetCode,variant:variant.value||undefined})}function forge(){emit('action',{asPlayerCode:forgeAs.value,body:forgeBody.value});forgeBody.value=''}function post(){if(draft.value&&canChat.value){emit('send',draft.value);draft.value=''}}function initial(n){return(n||'?')[0].toUpperCase()}function pretty(s){return String(s||'').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}function intensityLabel(v){return v==='T1'?'T1 — Soft':v==='T2'?'T2 — Standard':v==='T3'?'T3 — Brutal':pretty(v)}function status(p){if(!p.alive)return'Deceased';if(p.crippleTier)return`Interrogation Tier ${p.crippleTier}`;return p.connected?'Observing':'Vox lost'}function formatTime(t){return t?new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}function targetVoteCount(choice){return voteCounts.value[choice]||0}
</script>

<style scoped>
.day1-banner {
  padding: 12px 16px;
  background: rgba(255, 193, 7, 0.15);
  border: 1px solid #ffc107;
  border-radius: 4px;
  margin: 0 16px 12px;
  text-align: center;
  font-weight: 600;
  color: #ffc107;
  font-size: 0.95rem;
}
.player-list li.lynch-leader {
  border-color: #ff3333;
  background: rgba(255, 51, 51, 0.18);
  box-shadow:
    0 0 0 1px rgba(255, 51, 51, 0.35),
    0 0 20px rgba(255, 51, 51, 0.35);
  animation: lynchPulse 1s ease-in-out infinite alternate;
}

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
</style>
