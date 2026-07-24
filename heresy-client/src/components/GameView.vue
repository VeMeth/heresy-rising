<template>
  <section class="game-page">
    <div class="phase-flash" :class="game.phase" :key="game.phase + '-' + game.round" aria-hidden="true"></div>
    <div class="phase-strip" :class="game.phase">
      <div>
        <span class="phase-icon" aria-hidden="true"><svg class="phase-sigil"><use :href="phaseSigil"/></svg></span>
        <div><span class="eyebrow">{{ stageKicker }}</span><strong>{{ stageTitle }}</strong></div>
      </div>
      <div class="phase-time" :class="{urgent:secondsLeft!=null&&secondsLeft<=60&&secondsLeft>0,critical:secondsLeft!=null&&secondsLeft<=15&&secondsLeft>0}"><small>PHASE ENDS IN</small><strong>{{ timeLeft }}</strong></div>
      <div class="phase-progress" :style="{'--p':phaseProgress}" aria-hidden="true"></div>
    </div>
    <nav class="mobile-tabs"><button v-for="tab in ['roster','chat','orders']" :key="tab" :class="{active:mobileTab===tab}" @click="mobileTab=tab">{{ tab }}</button></nav>
    <div class="game-grid">
      <aside class="panel roster-panel" :class="{'mobile-hidden':mobileTab!=='roster'}">
        <span class="panel-frame-corner tl"></span><span class="panel-frame-corner tr"></span>
        <span class="panel-frame-corner bl"></span><span class="panel-frame-corner br"></span>
        <header class="roster-header">
          <div class="roster-heading"><span class="eyebrow">Roll Call</span><h2>Conclave</h2></div>
          <span class="roster-count"><strong>{{ alive.length }}</strong><small>Alive</small></span>
        </header>
        <ul class="player-list">
          <li v-for="p in players" :key="p.playerCode" :class="{dead:!p.alive,me:p.playerCode===me?.playerCode,voted:myVote?.choice===p.playerCode,selectable:votingOpen&&!myVote&&p.alive&&p.playerCode!==me?.playerCode,unavailable:!p.alive||p.playerCode===me?.playerCode,'lynch-leader':lynchLeader===p.playerCode}" @click="voteFor(p)">
            <span class="portrait" :data-status="portraitStatus(p)"><svg class="portrait-glyph"><use :href="portraitGlyph(p)"/></svg></span>
            <div><strong>{{ p.name }}</strong><span>{{ status(p) }}</span></div>
            <small v-if="votingOpen&&p.alive" class="vote-count" :style="tallyStyle(p.playerCode)">{{ targetVoteCount(p.playerCode) }}/{{ voteThreshold }}</small>
            <i :class="{online:p.connected}"></i>
          </li>
        </ul>
        <div v-if="votingOpen && !spectator" class="verdict-block">
          <span class="eyebrow">Cast Your Verdict</span>
          <button class="ghost wide" :class="{selected:myVote?.choice==='skip','stand-down-leading':standDownLeading}" @click="castVote('skip')">Stand down <small>{{ targetVoteCount('skip') }}/{{ voteThreshold }}</small></button>
          <button v-if="myVote" class="ghost wide" @click="$emit('retract-vote')">Retract vote</button>
        </div>
        <p v-else-if="game.phase==='day' && game.round===1 && !spectator" class="day1-hint">Day 1 — no vote. Introduce yourself and observe.</p>
        <button class="ghost wide leave" @click="$emit('leave')">Leave session</button>
      </aside>
      <section class="panel chat-panel" :class="{'mobile-hidden':mobileTab!=='chat'}">
        <span class="panel-frame-corner tl"></span><span class="panel-frame-corner tr"></span>
        <span class="panel-frame-corner bl"></span><span class="panel-frame-corner br"></span>
        <div class="channel-tabs"><button v-for="c in channels" :key="c.id" :class="{active:channel===c.id}" @click="$emit('channel',c.id)">{{ c.label }}<small>{{ c.note }}</small></button></div>
        <div ref="feed" class="message-feed">
          <div v-if="!messages.length" class="empty-chat"><strong>No transmissions recorded</strong></div>
          <template v-else>
            <div class="day-sections">
              <button v-if="earlierPastDays.length" class="load-history" @click="showEarlierDays = !showEarlierDays">{{ showEarlierDays ? 'Hide earlier messages' : 'Load earlier messages' }}</button>
              <section v-for="day in visibleDays" :key="day.label" class="day-section">
                <header class="day-header" @click="toggleDay(day.label)">
                  <span class="day-toggle">{{ day.expanded ? '▼' : '▶' }}</span>
                  <strong>{{ day.label }}</strong>
                  <span class="day-count">{{ day.messages.length }}</span>
                </header>
                <div class="day-messages" v-show="day.expanded">
                  <article v-for="m in day.messages" :key="m.id" :class="['message',{system:m.kind==='system',vote:m.kind==='vote',faction:m.channel==='faction'}]">
                    <span v-if="m.kind==='system'" class="log-entry" :class="'log-entry--'+classifyEntry(m.body).type"><svg class="log-glyph" aria-hidden="true"><use :href="classifyEntry(m.body).glyph"/></svg><span class="log-text">{{ m.body }}</span></span>
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
            <article v-for="m in currentMessages" :key="m.id" :class="['message',{system:m.kind==='system',vote:m.kind==='vote',faction:m.channel==='faction'}]">
              <span v-if="m.kind==='system'" class="log-entry" :class="'log-entry--'+classifyEntry(m.body).type"><svg class="log-glyph" aria-hidden="true"><use :href="classifyEntry(m.body).glyph"/></svg><span class="log-text">{{ m.body }}</span></span>
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
        <form v-if="!spectator" class="composer" @submit.prevent="post">
          <textarea v-model.trim="draft" maxlength="1000" rows="2" :disabled="!canChat" :placeholder="canChat?'Transmit… (Enter to send, Shift+Enter for newline)':'Channel sealed'" @keydown.enter.exact.prevent="post"></textarea>
          <button class="primary" :disabled="!draft||!canChat">Transmit</button>
        </form>
        <div v-else class="composer"><p class="spectator-composer-note">Spectating — transmissions sealed.</p></div>
      </section>
      <aside class="panel orders-panel" :class="{'mobile-hidden':mobileTab!=='orders'}">
        <span class="panel-frame-corner tl"></span><span class="panel-frame-corner tr"></span>
        <span class="panel-frame-corner bl"></span><span class="panel-frame-corner br"></span>
        <template v-if="game.phase==='ended'">
          <div class="dossier-header judgement-header">
            <svg class="judgement-rosette" aria-hidden="true"><use href="#hr-rosette"/></svg>
            <span class="eyebrow">FINAL JUDGEMENT</span>
            <div class="verdict-seal" :class="game.winner==='loyalist'?'loyalist':'heretic'">
              <div class="seal-wax" aria-hidden="true"></div>
              <div class="seal-ring" aria-hidden="true"></div>
              <div class="seal-face">{{ game.winner }} Victory<small>Conclave Sealed</small></div>
            </div>
          </div>
          <ul class="reveal-list">
            <li v-for="p in players" :key="p.playerCode">
              <strong>{{ p.name }}</strong>
              <span class="role-badge" :class="p.faction">
                <svg class="role-glyph" aria-hidden="true"><use :href="sigilFor(p.role, p.faction)"/></svg>{{ p.role?.displayName || '—' }}
              </span>
            </li>
          </ul>
        </template>
        <template v-else-if="spectator">
          <div class="spectator-notice">
            <span class="eyebrow">OBSERVING</span>
            <p>You are observing this conclave. The dossier is sealed until the final judgement.</p>
          </div>
        </template>
        <template v-else>
          <div class="dossier-header">
            <span class="eyebrow">CLASSIFIED DOSSIER</span>
          </div>
          <div class="role-card" :class="me?.faction">
            <span class="role-shine" aria-hidden="true"></span>
            <span class="role-sigil" aria-hidden="true"><svg class="dossier-glyph"><use :href="sigilFor(role, me?.faction)"/></svg></span>
            <button class="role-name" @click="$emit('open-manual', '/docs/roles/' + (role.id || '').toLowerCase())">{{ role.displayName }}</button>
            <span class="role-faction" :class="me?.faction">{{ me?.faction === 'heretic' ? 'Heretic' : 'Loyalist' }}</span>
            <dl v-if="me?.drift != null || me?.crippleTier" class="role-meta">
              <div v-if="me?.drift != null"><dt>Drift</dt><dd>{{ me.drift }} / {{ game.maxDrift }}<span class="drift-gauge" aria-hidden="true"><i :style="{ width: driftPct + '%' }"></i></span></dd></div>
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
          <div v-else-if="game.phase !== 'day'" class="order-block night-directive" :class="{ disabled: !me?.alive }">
            <span class="eyebrow">Night directive</span>
            <h2 class="directive-title">{{ actionLabel }}</h2>
            <template v-if="me?.alive">
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
            </template>
            <p v-else class="notice deceased-notice">You are deceased. You have no night directives.</p>
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>
<script setup>
import { computed,nextTick,ref,watch } from 'vue';
// TODO(heresy-spec): Q28 — Day 1 votingEnabled = false. Remove when gate is wired.
const props=defineProps({game:{type:Object,required:true},me:Object,messages:{type:Array,default:()=>[]},channel:String,busy:Boolean,now:Number,hasMore:{type:Boolean,default:true},spectator:{type:Boolean,default:false},votingEnabled:{type:Boolean,default:true}});const emit=defineEmits(['channel','send','history','vote','retract-vote','action','retract-action','respond','ask-confession','open-manual','leave']);
const draft=ref(''),mobileTab=ref('chat'),feed=ref(null),variant=ref(''),forgeAs=ref(''),forgeBody=ref(''),voteJustification=ref('');
const dayExpanded = ref({});
const showEarlierDays = ref(false);
function isDayStart(m){return m.kind==='system'&&/Day\s+\d+(\s*:|\s+begins)/i.test(m.body);}
function isDayEnd(m){return m.kind==='system'&&/(concludes with no vote|conclave stands down|was interrogated and left|was lynched and revealed)/i.test(m.body);}
function nightStart(msgs,markerIdx,lowerBound){let start=markerIdx;for(let j=markerIdx-1;j>lowerBound;j--){const m=msgs[j];if(m.kind==='player'){start=j+1;break;}if(isDayStart(m)){start=j+1;break;}if(isDayEnd(m)){start=j+1;break;}start=j;}return start;}
const players=computed(()=>props.game.players||[]),alive=computed(()=>players.value.filter(p=>p.alive)),role=computed(()=>props.me?.role||{}),nightAction=computed(()=>role.value.actions?.night),hasNightAction=computed(()=>nightAction.value&&nightAction.value.kind!=='sleep'),variants=computed(()=>nightAction.value?.variants||[]),pending=computed(()=>props.game.pendingInterrogation),validTargets=computed(()=>alive.value.filter(p=>p.playerCode!==props.me?.playerCode)),myVote=computed(()=>props.game.votes?.find(v=>v.voterCode===props.me?.playerCode)),voteThreshold=computed(()=>props.game.votes?.[0]?.threshold||Math.floor(alive.value.length/2)+1),voteCounts=computed(()=>{const counts={};for(const v of props.game.votes||[])counts[v.choice]=(counts[v.choice]||0)+1;return counts;}),votingOpen=computed(()=>props.votingEnabled&&props.game.phase==='day'&&!pending.value),pastDays=computed(()=>{const msgs=props.messages;if(!msgs.length)return[];const markers=[];for(let i=0;i<msgs.length;i++){if(isDayStart(msgs[i]))markers.push(i);}if(markers.length<2)return[];const sections=[];for(let d=0;d<markers.length-1;d++){const start=d===0?markers[0]:nightStart(msgs,markers[d],d>0?markers[d-1]:-1);const end=nightStart(msgs,markers[d+1],markers[d]);const dayNum=msgs[markers[d]].body.match(/Day\s+(\d+)/i)?.[1]||(d+1);const label=`Day ${dayNum}`;sections.push({label,messages:msgs.slice(start,end),expanded:dayExpanded.value[label]??false});}return sections;}),recentPastDay=computed(()=>pastDays.value.length?pastDays.value[pastDays.value.length-1]:null),earlierPastDays=computed(()=>pastDays.value.slice(0,-1)),visibleDays=computed(()=>[...(showEarlierDays.value?earlierPastDays.value:[]),...(recentPastDay.value?[recentPastDay.value]:[])]),currentMessages=computed(()=>{const msgs=props.messages;if(!msgs.length)return[];let lastMarker=-1;for(let i=msgs.length-1;i>=0;i--){if(isDayStart(msgs[i])){lastMarker=i;break;}}if(lastMarker===-1)return msgs;let prevMarker=-1;for(let i=lastMarker-1;i>=0;i--){if(isDayStart(msgs[i])){prevMarker=i;break;}}const start=nightStart(msgs,lastMarker,prevMarker);return msgs.slice(start);});
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
const channels=computed(()=>[{id:'public',label:'Conclave',note:'public'},...(!props.spectator&&props.me?.faction==='heretic'?[{id:'faction',label:'Cabal',note:'heretics'}]:[]),...(!props.spectator&&!props.me?.alive?[{id:'graveyard',label:'Graveyard',note:'dead'}]:[])]),canChat=computed(()=>props.game.phase!=='ended'&&(props.channel!=='public'||props.game.phase!=='night')&&(props.me?.alive||props.channel==='graveyard'));
const deadline=computed(()=>props.game.deadline),timeLeft=computed(()=>{if(!deadline.value)return'—';const s=Math.max(0,Math.floor((deadline.value-props.now)/1000));return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}),stageTitle=computed(()=>props.game.phase==='day'?`Day ${props.game.round} · ${props.game.dayStage}`:props.game.phase==='night'?`Night ${props.game.round}`:props.game.phase),stageKicker=computed(()=>props.game.phase==='night'?'THE LIGHT WITHDRAWS':'THE CONCLAVE SITS'),actionLabel=computed(()=>hasNightAction.value?pretty(nightAction.value.kind):'Keep the vigil'),lynchLeader=computed(()=>{if(!votingOpen.value)return null;const counts=voteCounts.value;let leader=null,max=-1;for(const [code,count] of Object.entries(counts)){if(code==='skip')continue;if(count>max){max=count;leader=code;}}return leader}),standDownLeading=computed(()=>{if(!votingOpen.value)return false;const skip=voteCounts.value.skip||0;for(const [code,count] of Object.entries(voteCounts.value)){if(code!=='skip'&&count>=skip)return false;return true;}});
const secondsLeft=computed(()=>{if(!deadline.value)return null;return Math.max(0,Math.floor((deadline.value-props.now)/1000));});
const phaseProgress=computed(()=>{const total=(props.game.phase==='night'?props.game.nightMs:props.game.dayMs)||0;if(!total||secondsLeft.value==null)return 0;return Math.min(1,Math.max(0,1-(secondsLeft.value*1000)/total));});
const driftPct=computed(()=>{const max=props.game.maxDrift||20;const d=props.me?.drift||0;return Math.min(100,Math.round((d/max)*100));});
function tallyStyle(choice){return{'--fill':Math.min(1,(voteCounts.value[choice]||0)/voteThreshold.value)};}
function castVote(choice){emit('vote',{choice,justification:voteJustification.value})}
function voteFor(p){if(props.spectator||!votingOpen.value||!p.alive||p.playerCode===props.me?.playerCode)return;if(myVote.value?.choice===p.playerCode)return;castVote(p.playerCode)}function act(targetCode){emit('action',{targetCode,variant:variant.value||undefined})}function forge(){emit('action',{asPlayerCode:forgeAs.value,body:forgeBody.value});forgeBody.value=''}function post(){if(draft.value&&canChat.value){emit('send',draft.value);draft.value=''}}function initial(n){return(n||'?')[0].toUpperCase()}function pretty(s){return String(s||'').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}function intensityLabel(v){return v==='T1'?'T1 — Soft':v==='T2'?'T2 — Standard':v==='T3'?'T3 — Brutal':pretty(v)}function status(p){if(!p.alive)return'Deceased';if(p.crippleTier)return`Interrogation Tier ${p.crippleTier}`;return p.connected?'Observing':'Vox lost'}function formatTime(t){return t?new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}function targetVoteCount(choice){return voteCounts.value[choice]||0}
function targetName(code){return players.value.find(p=>p.playerCode===code)?.name||'unknown';}
// ── Generated sigil assets (heresy-sigils.svg, inlined in index.html) ─────
const ROLE_SIGILS={priest:'hr-priest',murderer:'hr-murderer',interrogator:'hr-interrogator',chirurgeon:'hr-chirurgeon','imperial-citizen':'hr-citizen'};
function sigilFor(r,faction){const id=r?.id;if(id&&ROLE_SIGILS[id])return '#'+ROLE_SIGILS[id];if(!id&&!faction)return '#hr-unknown';return (faction||r?.faction)==='heretic'?'#hr-murderer':'#hr-citizen';}
const phaseSigil=computed(()=>props.game.phase==='night'?'#hr-night':props.game.phase==='ended'?'#hr-verdict':'#hr-day');
function portraitStatus(p){return !p.alive?'deceased':'alive';}
function portraitGlyph(p){return !p.alive?'#hr-deceased':'#hr-alive';}
// Classify a system-log line by its text so the transcript is scannable — glyph + tint per event type.
function classifyEntry(body){const b=String(body||'');
  if(/victory|conclave is (ended|dissolved)|game over|ended by admin/i.test(b))return{type:'verdict',glyph:'#hr-verdict'};
  if(/lynched|executed|summary execution|revealed (as )?(loyalist|heretic)|left at tier \d|forced to confess|confessed:/i.test(b))return{type:'execution',glyph:'#hr-execution'};
  if(/slain|was killed|found dead|absorbed a strike|deflected/i.test(b))return{type:'death',glyph:'#hr-deceased'};
  if(/vote tally|\d+ of \d+ votes|voters:/i.test(b))return{type:'vote',glyph:'#hr-vote'};
  if(/accused|retracted their accusation/i.test(b))return{type:'accusation',glyph:'#hr-accusation'};
  if(/night \d|day \d|begins|has begun|vote for a target|stands? down|dispers|no vote/i.test(b))return{type:'phase',glyph:/night/i.test(b)?'#hr-night':'#hr-day'};
  return{type:'system',glyph:'#hr-vox'};}
</script>

<style scoped>
/* ── Conclave roster ───────────────────────────────────────────────────── */
.roster-header {
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}
.roster-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}
.roster-heading .eyebrow {
  color: var(--gold);
  letter-spacing: 0.22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roster-heading h2 {
  margin: 0;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roster-count {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
  min-width: 40px;
  padding: 5px 10px 6px;
  border: 1px solid rgba(182, 154, 92, 0.35);
  background: rgba(0, 0, 0, 0.28);
  box-shadow: inset 0 1px 0 rgba(223, 194, 124, 0.08);
}
.roster-count strong {
  font: 700 17px Cinzel, serif;
  line-height: 1;
  color: var(--gold2);
  text-shadow: 0 0 8px rgba(223, 194, 124, 0.3);
}
.roster-count small {
  font: 600 8px Inter, sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  margin-top: 3px;
}

.player-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 0;
}
.player-list li {
  position: relative;
  border: 1px solid var(--line);
  border-left: 2px solid rgba(182, 154, 92, 0.4);
  border-radius: 2px;
  background: linear-gradient(160deg, rgba(24, 26, 22, 0.6), rgba(13, 15, 13, 0.6));
  padding: 10px 12px;
  margin: 0;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.player-list li.me {
  border-color: var(--gold);
  border-left-color: var(--gold);
  background: linear-gradient(160deg, rgba(42, 38, 20, 0.65), rgba(20, 17, 10, 0.65));
}
.player-list li.dead {
  border-color: #26281f;
  border-left-color: #26281f;
  background: linear-gradient(160deg, rgba(18, 19, 16, 0.5), rgba(10, 11, 9, 0.5));
}
.player-list li:not(.dead):not(.unavailable):not(.voted):hover {
  border-color: rgba(182, 154, 92, 0.45);
  background: linear-gradient(160deg, rgba(32, 34, 26, 0.65), rgba(16, 18, 14, 0.65));
}
.player-list i.online {
  box-shadow: 0 0 6px rgba(113, 144, 94, 0.65), 0 0 12px rgba(113, 144, 94, 0.3);
}

.verdict-block {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.verdict-block > .eyebrow {
  display: block;
  margin-bottom: 9px;
  color: var(--gold);
  letter-spacing: 0.2em;
}
.verdict-block button + button { margin-top: 8px; }

.leave {
  border-top: 1px solid var(--line);
  padding-top: 14px;
}

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
  /* background-color only — the fx layer adds a red corner reticle via
     background-image, and a shorthand here would wipe it out */
  background-color: rgba(255, 51, 51, 0.18);
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

/* Cabal transmissions: oxblood variant of the vox frame (global
   message chrome lives in fx.css). */
.message.faction .avatar.mini {
  border-color: rgba(255, 107, 107, .55);
  color: #ff8a8a;
  box-shadow:
    0 0 0 1px #0a0b09,
    0 0 10px rgba(255, 107, 107, .22),
    inset 0 1px 0 rgba(255, 138, 138, .15);
  text-shadow: 0 0 8px rgba(255, 107, 107, .55);
}

.message.faction header strong {
  color: #ff8a8a;
}

.message.faction p {
  color: #d99b95;
  border-left-color: #6b3030;
  background: linear-gradient(160deg, #231a18, #151010);
}
.message.faction p::before {
  border-color: rgba(255, 107, 107, .5);
}

.day-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
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
.day-header::before {
  content: "";
  width: 3px; height: 14px;
  background: var(--gold);
  border-radius: 1px;
  margin-right: 2px;
  opacity: 0.6;
}
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
  /* button reset */
  display: block;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.role-name:hover {
  color: var(--gold2);
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
/* Dead players can't act — kill the glow, grey out the block */
.order-block.disabled {
  background: linear-gradient(180deg, rgba(22, 22, 22, 0.45), rgba(12, 12, 12, 0.45));
  border-color: #3a3a3a;
  box-shadow: none;
  animation: none;
  opacity: 0.5;
}
.order-block.disabled .eyebrow,
.order-block.disabled .directive-title {
  color: #777a70;
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
.spectator-notice {
  padding: 30px 18px;
  text-align: center;
}
.spectator-notice p {
  font: 400 13px/1.6 Georgia, serif;
  color: var(--muted);
  font-style: italic;
  margin: 10px 0 0;
}
.spectator-composer-note {
  font: 400 10px/1 Inter, sans-serif;
  color: var(--muted);
  text-align: center;
  margin: 0;
  padding: 12px 0;
  width: 100%;
  letter-spacing: .06em;
  text-transform: uppercase;
}

/* ═══ Generated graphics kit — sigils/seal/portraits, adapted to the app palette ═══ */

/* Phase-strip glyph (day/night/verdict sigil) */
.phase-sigil { width: 26px; height: 26px; stroke: currentColor; fill: none; display: block; }

/* Roster: octagonal portrait plate with a status ring, replacing the letter box */
.player-list .portrait {
  --ring: #7d6a3f;
  position: relative;
  display: grid; place-items: center;
  flex: 0 0 34px; width: 34px; height: 34px;
  font: 700 12px Cinzel, serif; line-height: 1;
  color: var(--gold);
  background: linear-gradient(160deg, #1c1710, #0d0a07);
  border: 1px solid var(--ring);
  clip-path: polygon(28% 0, 72% 0, 100% 28%, 100% 72%, 72% 100%, 28% 100%, 0 72%, 0 28%);
  text-shadow: 0 0 8px rgba(223, 194, 124, .4);
}
.player-list .portrait::after {
  content: ''; position: absolute; right: -1px; bottom: -1px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ring); box-shadow: 0 0 8px var(--ring);
}
.player-list .portrait[data-status="alive"]    { --ring: #5c8a76; }
.player-list .portrait[data-status="deceased"] { --ring: #3a2f22; color: #4a4034; filter: grayscale(1) brightness(.75); }
.player-list .portrait[data-status="deceased"]::after { box-shadow: none; }
.portrait-glyph { width: 18px; height: 18px; stroke: currentColor; fill: none; display: block; }

/* Dossier role-card sigil */
.dossier-glyph { width: 16px; height: 16px; stroke: currentColor; fill: none; display: block; }

/* Final judgement: rose-window watermark + wax verdict seal */
.judgement-header { position: relative; }
.judgement-rosette {
  position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
  width: 190px; height: 190px; color: var(--gold); opacity: .06; pointer-events: none;
}
.verdict-seal {
  --wax: #9f3931;
  position: relative; z-index: 1;
  width: 150px; height: 150px; margin: 12px auto 4px;
  display: grid; place-items: center;
  transform: rotate(-7deg);
  filter: drop-shadow(0 6px 18px rgba(0, 0, 0, .7));
  animation: seal-press .7s cubic-bezier(.18, .9, .24, 1.02) both;
}
.verdict-seal.loyalist { --wax: #9c7c2e; }
.seal-wax { position: absolute; inset: 0; filter: url(#hr-roughen); }
.seal-wax::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(circle at 34% 28%,
    color-mix(in srgb, var(--wax) 70%, #fff) 0%,
    var(--wax) 34%,
    color-mix(in srgb, var(--wax) 62%, #000) 78%,
    color-mix(in srgb, var(--wax) 34%, #000) 100%);
  clip-path: polygon(50% 0%, 63% 4%, 74% 3%, 82% 12%, 92% 19%, 95% 31%, 100% 42%, 96% 54%, 98% 66%, 89% 74%, 84% 85%, 72% 88%, 62% 96%, 50% 100%, 38% 96%, 27% 97%, 18% 88%, 8% 82%, 5% 70%, 0% 58%, 4% 46%, 2% 33%, 11% 25%, 16% 14%, 28% 11%, 38% 3%);
}
.seal-ring {
  position: absolute; inset: 13%;
  border: 1.5px solid rgba(0, 0, 0, .42); border-radius: 50%;
  box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--wax) 55%, #000), inset 0 0 22px rgba(0, 0, 0, .5);
}
.seal-face {
  position: relative; z-index: 2; text-align: center;
  font: 700 .72rem/1.25 Cinzel, serif;
  letter-spacing: .12em; text-transform: uppercase;
  color: color-mix(in srgb, var(--wax) 22%, #f6e6c8);
  text-shadow: 0 1px 0 rgba(0, 0, 0, .55), 0 -1px 0 rgba(255, 255, 255, .14);
  padding: 0 1.7rem;
}
.seal-face small { display: block; margin-top: .3rem; font-size: .5rem; letter-spacing: .28em; opacity: .68; font-weight: 400; }
@keyframes seal-press {
  0%   { transform: rotate(-14deg) scale(2.1); opacity: 0; filter: blur(6px); }
  60%  { transform: rotate(-5deg)  scale(.94); opacity: 1; filter: blur(0); }
  100% { transform: rotate(-7deg)  scale(1);   opacity: 1; }
}

/* Final reveal: stamped role badges with role sigil */
.role-badge {
  display: inline-flex; align-items: center; gap: .4em;
  padding: .28em .65em .28em .5em;
  font: 600 10px Cinzel, serif;
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--gold); white-space: nowrap;
  background: linear-gradient(180deg, rgba(182, 154, 92, .1), rgba(182, 154, 92, .02));
  border: 1px solid rgba(182, 154, 92, .3);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
}
.role-badge.heretic {
  color: #ff8a8a;
  background: linear-gradient(180deg, rgba(159, 57, 49, .18), rgba(159, 57, 49, .04));
  border-color: rgba(159, 57, 49, .5);
  box-shadow: 0 0 14px -4px rgba(159, 57, 49, .6);
}
.role-glyph { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; }

/* Stamped transcript: glyph + tint per event type, replacing the uniform amber line */
.message.system { background: none; border: 0; border-radius: 0; padding: 0; margin: 13px 0 13px 41px; }
.log-entry {
  --tint: var(--gold);
  display: flex; align-items: center; gap: .7rem;
  padding: .5rem .8rem;
  font: 400 12.5px/1.45 Georgia, serif;
  color: color-mix(in srgb, var(--tint) 82%, var(--pale));
  background: linear-gradient(90deg, color-mix(in srgb, var(--tint) 10%, transparent), transparent 65%);
  border-left: 2px solid var(--tint);
}
.log-glyph { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; color: var(--tint); opacity: .85; }
.log-text { flex: 1; }
.log-entry::after {
  content: ''; flex: none; width: 26%; height: 1px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tint) 34%, transparent), transparent);
}
.log-entry--accusation { --tint: #b69a5c; }
.log-entry--vote       { --tint: #8f9c6a; }
.log-entry--execution  { --tint: #c14545; }
.log-entry--death      { --tint: #a86b5c; }
.log-entry--phase      { --tint: #7f8ca6; }
.log-entry--verdict    { --tint: var(--gold2); }
.log-entry--system     { --tint: var(--muted); }

@media (prefers-reduced-motion: reduce) { .verdict-seal { animation: none; } }
@media (max-width: 460px) { .log-entry::after { display: none; } }
</style>
