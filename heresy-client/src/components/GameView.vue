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
          <li v-for="p in players" :key="p.playerCode" :class="{dead:!p.alive,me:p.playerCode===me?.playerCode,crippled:p.crippleTier||p.torturedBefore,voted:myVote?.choice===p.playerCode,selectable:votingOpen&&!myVote&&p.alive&&p.playerCode!==me?.playerCode,unavailable:!p.alive||p.playerCode===me?.playerCode,'lynch-leader':lynchLeader===p.playerCode,kill:lynchLeader===p.playerCode&&lynchLeaderOutcome==='kill',torture:lynchLeader===p.playerCode&&lynchLeaderOutcome==='torture'}" @click="voteFor(p)">
            <span class="portrait" :data-status="portraitStatus(p)" v-bind="sealAttrs(p.name)">{{ sealText(p.name) }}</span>
            <div><strong>{{ p.name }}</strong><span>{{ status(p) }}</span><small v-if="p.possessed" class="possessed-badge">POSSESSED</small><small v-if="p.alive&&p.torturedBefore" class="tortured-badge" :title="tortureTooltip(p.crippleTier)">TORTURED</small></div>
            <small v-if="p.alive&&(p.crippleTier||p.torturedBefore)" class="tier-badge" :data-tier="p.crippleTier" :title="tortureTooltip(p.crippleTier)">T{{ p.crippleTier||0 }}</small>
            <span v-else-if="!p.alive" class="death-badge" :class="{executed:p.crippleTier===3}" :title="p.crippleTier===3?'Lynched':'Slain'"><svg class="death-glyph" aria-hidden="true"><use :href="p.crippleTier===3?'#hr-execution':'#hr-deceased'"/></svg></span>
            <small v-if="votingOpen&&p.alive" class="vote-count" :style="tallyStyle(p.playerCode)">{{ targetVoteCount(p.playerCode) }}</small>
            <i :class="{online:p.connected}"></i>
          </li>
        </ul>
        <div v-if="votingOpen && !spectator" class="verdict-block">
          <span class="eyebrow">{{ speakAsTarget && possessedTarget ? 'Vote as ' + possessedTarget.name : 'Cast Your Verdict' }}</span>
          <button class="ghost wide" :class="{selected:myVote?.choice==='skip','stand-down-leading':standDownLeading}" @click="castVote('skip')">Stand down <small>{{ targetVoteCount('skip') }}</small></button>
          <button v-if="myVote" class="ghost wide" @click="retractMyVote">Retract vote</button>
        </div>
        <p v-else-if="me?.possessed && !spectator" class="day1-hint">Possessed — you cannot vote today.</p>
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
                  <article v-for="m in day.messages" :key="m.id" :class="['message',{system:m.kind==='system',vote:m.kind==='vote',faction:m.channel==='faction','mentions-me':messageMentionsMe(m)}]">
                    <span v-if="m.kind==='system'" class="log-entry" :class="'log-entry--'+classifyEntry(m).type"><svg class="log-glyph" aria-hidden="true"><use :href="classifyEntry(m).glyph"/></svg><span class="log-text"><template v-for="(seg,si) in messageSegments(m)" :key="si"><button v-if="seg.term" type="button" class="glossary-term" @mouseenter="showTip(seg.term,$event)" @mouseleave="hideTip" @focus="showTip(seg.term,$event)" @blur="hideTip" @click="openTerm(seg.term)">{{ seg.text }}</button><template v-else>{{ seg.text }}</template></template></span><time class="log-time">{{ formatTime(m.createdAt) }}</time></span>
                    <template v-else>
                      <span class="avatar mini" v-bind="sealAttrs(m.author)">{{ sealText(m.author) }}</span>
                      <div>
                        <header><strong>{{ m.author }}</strong><time>{{ formatTime(m.createdAt) }}</time></header>
                        <p><template v-for="(seg,si) in messageSegments(m)" :key="si"><span v-if="seg.mention" class="mention">@{{ seg.text }}</span><button v-else-if="seg.term" type="button" class="glossary-term" @mouseenter="showTip(seg.term,$event)" @mouseleave="hideTip" @focus="showTip(seg.term,$event)" @blur="hideTip" @click="openTerm(seg.term)">{{ seg.text }}</button><template v-else>{{ seg.text }}</template></template></p>
                      </div>
                    </template>
                  </article>
                </div>
              </section>
            </div>
            <article v-for="m in currentMessages" :key="m.id" :class="['message',{system:m.kind==='system',vote:m.kind==='vote',faction:m.channel==='faction','mentions-me':messageMentionsMe(m)}]">
              <span v-if="m.kind==='system'" class="log-entry" :class="'log-entry--'+classifyEntry(m).type"><svg class="log-glyph" aria-hidden="true"><use :href="classifyEntry(m).glyph"/></svg><span class="log-text"><template v-for="(seg,si) in messageSegments(m)" :key="si"><button v-if="seg.term" type="button" class="glossary-term" @mouseenter="showTip(seg.term,$event)" @mouseleave="hideTip" @focus="showTip(seg.term,$event)" @blur="hideTip" @click="openTerm(seg.term)">{{ seg.text }}</button><template v-else>{{ seg.text }}</template></template></span><time class="log-time">{{ formatTime(m.createdAt) }}</time></span>
              <template v-else>
                <span class="avatar mini" v-bind="sealAttrs(m.author)">{{ sealText(m.author) }}</span>
                <div>
                  <header><strong>{{ m.author }}</strong><time>{{ formatTime(m.createdAt) }}</time></header>
                  <p><template v-for="(seg,si) in messageSegments(m)" :key="si"><span v-if="seg.mention" class="mention">@{{ seg.text }}</span><button v-else-if="seg.term" type="button" class="glossary-term" @mouseenter="showTip(seg.term,$event)" @mouseleave="hideTip" @focus="showTip(seg.term,$event)" @blur="hideTip" @click="openTerm(seg.term)">{{ seg.text }}</button><template v-else>{{ seg.text }}</template></template></p>
                </div>
              </template>
            </article>
          </template>
        </div>
        <form v-if="!spectator" class="composer" @submit.prevent="post">
          <label v-if="possessedTarget" class="speak-as-toggle">
            <input type="checkbox" v-model="speakAsTarget">
            Speak as {{ possessedTarget.name }}
          </label>
          <div class="composer-field">
            <ul v-if="mentionSuggestions.length" class="mention-suggestions">
              <li v-for="(p,i) in mentionSuggestions" :key="p.playerCode" :class="{active:i===mentionActiveIndex}" @mousedown.prevent="selectMention(p)">{{ p.name }}</li>
            </ul>
            <textarea ref="composerInput" v-model.trim="draft" maxlength="1000" rows="2" :disabled="!canChat" :class="{'speaking-as':speakAsTarget&&possessedTarget}" :placeholder="canChat?(speakAsTarget&&possessedTarget?'Transmit as '+possessedTarget.name+'… (Enter to send)':'Transmit… (Enter to send, Shift+Enter for newline, @ to mention)'):(me?.possessed?'Possessed — you cannot speak today':'Channel sealed')" @keydown="onComposerKeydown" @input="syncMentionQuery" @keyup="onComposerKeyup" @click="syncMentionQuery"></textarea>
          </div>
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
            <dl v-if="game.warpTaintVisible || me?.crippleTier || scaledCostRow" class="role-meta">
              <div v-if="game.warpTaintVisible" class="zone-row"><dt>Warp taint</dt><dd><span class="zone-gauge" role="img" :aria-label="'Last sensed drift zone: ' + knownZone"><i v-for="z in DRIFT_ZONES" :key="z" :class="[z, { lit: z === knownZone }]"></i></span><span class="zone-word" :class="knownZone">{{ knownZone }}</span></dd></div>
              <div v-if="me?.crippleTier"><dt>Torture</dt><dd>Tier {{ me.crippleTier }}</dd></div>
              <div v-if="scaledCostRow" class="zone-row cost-row"><dt>Cost this game ({{ players.length }}p)</dt><dd class="cost-readout"><span v-for="c in scaledCostRow" :key="c.tier" class="cost-chip" :class="c.zone"><small class="chip-tier">{{ c.tier }}</small><span class="chip-cost">{{ c.value }}</span></span></dd></div>
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
                <span class="eyebrow">Torture response · Tier {{ pending.tier }}</span>
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
          <template v-else-if="game.phase !== 'day'">
          <div class="order-block night-directive" :class="{ disabled: !me?.alive }">
            <span class="eyebrow">Night directive</span>
            <h2 class="directive-title">{{ actionLabel }}</h2>
            <template v-if="me?.alive">
              <template v-if="hasNightAction">
                <label v-if="variants.length" class="intensity-label">
                  <span class="eyebrow">Intensity</span>
                  <select v-model="variant"><option v-for="v in variants" :key="v" :value="v">{{ intensityLabel(v) }}</option></select>
                </label>
                <div class="targets">
                  <button v-for="p in actionTargets" :key="p.playerCode" :class="{selected:game.myAction?.kind===nightAction?.kind&&game.myAction?.targetCode===p.playerCode}" @click="act(p.playerCode)">
                    <span class="target-avatar" v-bind="sealAttrs(p.name)">{{ sealText(p.name) }}</span>
                    <span class="target-name">{{ p.name }}</span>
                  </button>
                </div>
                <div v-if="game.myAction?.kind===nightAction?.kind" class="selected-summary">Directive locked on <strong>{{ targetName(game.myAction.targetCode) }}</strong></div>
                <button v-if="game.myAction?.kind===nightAction?.kind" class="ghost wide" @click="$emit('retract-action')">Retract directive</button>
              </template>
              <p v-else-if="me?.faction!=='heretic'" class="notice">No directive tonight. Skipping the night counts as sleep.</p>
            </template>
            <p v-else class="notice deceased-notice">You are deceased. You have no night directives.</p>
          </div>
          <div v-if="me?.alive && me?.faction==='heretic'" class="order-block cabal-directive">
            <span class="eyebrow">Cabal Directive · Blood Ritual</span>
            <p class="dossier-text cabal-hint">Faction-wide — only one Heretic's claim lands each night. This shares your night action slot: submitting it replaces any personal directive above, and vice versa.</p>
            <div class="targets">
              <button v-for="p in bloodRitualTargets" :key="p.playerCode" :class="{selected:game.myAction?.kind==='blood-ritual'&&game.myAction?.targetCode===p.playerCode}" @click="bloodRitual(p.playerCode)">
                <span class="target-avatar" v-bind="sealAttrs(p.name)">{{ sealText(p.name) }}</span>
                <span class="target-name">{{ p.name }}</span>
              </button>
            </div>
            <div v-if="game.myAction?.kind==='blood-ritual'" class="selected-summary">Blood Ritual locked on <strong>{{ targetName(game.myAction.targetCode) }}</strong></div>
            <button v-if="game.myAction?.kind==='blood-ritual'" class="ghost wide" @click="$emit('retract-action')">Retract directive</button>
          </div>
          </template>
        </template>
      </aside>
    </div>
    <Teleport to="body">
      <div v-if="tip" class="glossary-tip" :class="'is-'+tipPos.placement" :style="tipStyle" role="tooltip">
        <span class="tip-kind" :class="tip.faction">{{ tip.kind }}</span>
        <strong class="tip-label">{{ tip.label }}</strong>
        <p class="tip-gloss">{{ tip.gloss }}</p>
        <span class="tip-more">Click to open the manual</span>
      </div>
    </Teleport>
  </section>
</template>
<script setup>
import { computed,nextTick,onBeforeUnmount,ref,watch } from 'vue';
import { TERM_PATTERN, lookupTerm } from '../glossary.js';
import { buildSealMap, fallbackSeal, sealVars } from '../seals.js';
import { settings } from '../settings.js';
import { DRIFT, DRIFT_ZONE_ORDER, SCALED_COSTS, resolveScaledCost, formatSigned } from '../driftCosts.js';
import rules from '@game_data/rules.json';
const props=defineProps({game:{type:Object,required:true},me:Object,messages:{type:Array,default:()=>[]},channel:String,busy:Boolean,now:Number,hasMore:{type:Boolean,default:true},spectator:{type:Boolean,default:false},votingEnabled:{type:Boolean,default:true}});const emit=defineEmits(['channel','send','send-as','history','vote','retract-vote','vote-as','retract-vote-as','action','retract-action','faction-action','respond','ask-confession','open-manual','leave']);
const draft=ref(''),mobileTab=ref('chat'),feed=ref(null),variant=ref(''),forgeAs=ref(''),forgeBody=ref(''),voteJustification=ref(''),speakAsTarget=ref(false);
const dayExpanded = ref({});
const showEarlierDays = ref(false);
function isDayStart(m){return m.kind==='system'&&/Day\s+\d+(\s*:|\s+begins)/i.test(m.body);}
function isDayEnd(m){return m.kind==='system'&&/(concludes with no vote|conclave stands down|was tortured and left|was lynched and revealed)/i.test(m.body);}
function nightStart(msgs,markerIdx,lowerBound){let start=markerIdx;for(let j=markerIdx-1;j>lowerBound;j--){const m=msgs[j];if(m.kind==='player'){start=j+1;break;}if(isDayStart(m)){start=j+1;break;}if(isDayEnd(m)){start=j+1;break;}start=j;}return start;}
const players=computed(()=>props.game.players||[]),alive=computed(()=>players.value.filter(p=>p.alive)),role=computed(()=>props.me?.role||{}),nightAction=computed(()=>role.value.actions?.night),hasNightAction=computed(()=>nightAction.value&&nightAction.value.kind!=='sleep'),variants=computed(()=>nightAction.value?.variants||[]),pending=computed(()=>props.game.pendingTorture),validTargets=computed(()=>alive.value.filter(p=>p.playerCode!==props.me?.playerCode)),myVote=computed(()=>props.game.votes?.find(v=>v.voterCode===effectiveVoterCode.value)),voteCounts=computed(()=>{const counts={};for(const v of props.game.votes||[])counts[v.choice]=(counts[v.choice]||0)+1;return counts;}),maxVoteCount=computed(()=>Math.max(0,...Object.values(voteCounts.value))),votingOpen=computed(()=>props.votingEnabled&&props.game.phase==='day'&&!pending.value&&!props.me?.possessed),pastDays=computed(()=>{const msgs=props.messages;if(!msgs.length)return[];const markers=[];for(let i=0;i<msgs.length;i++){if(isDayStart(msgs[i]))markers.push(i);}if(markers.length<2)return[];const sections=[];for(let d=0;d<markers.length-1;d++){const start=d===0?markers[0]:nightStart(msgs,markers[d],d>0?markers[d-1]:-1);const end=nightStart(msgs,markers[d+1],markers[d]);const dayNum=msgs[markers[d]].body.match(/Day\s+(\d+)/i)?.[1]||(d+1);const label=`Day ${dayNum}`;sections.push({label,messages:msgs.slice(start,end),expanded:dayExpanded.value[label]??false});}return sections;}),recentPastDay=computed(()=>pastDays.value.length?pastDays.value[pastDays.value.length-1]:null),earlierPastDays=computed(()=>pastDays.value.slice(0,-1)),visibleDays=computed(()=>[...(showEarlierDays.value?earlierPastDays.value:[]),...(recentPastDay.value?[recentPastDay.value]:[])]),currentMessages=computed(()=>{const msgs=props.messages;if(!msgs.length)return[];let lastMarker=-1;for(let i=msgs.length-1;i>=0;i--){if(isDayStart(msgs[i])){lastMarker=i;break;}}if(lastMarker===-1)return msgs;let prevMarker=-1;for(let i=lastMarker-1;i>=0;i--){if(isDayStart(msgs[i])){prevMarker=i;break;}}const start=nightStart(msgs,lastMarker,prevMarker);return msgs.slice(start);});
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
watch(()=>props.channel,()=>{dayExpanded.value={};mentionQuery.value=null;});
const actionTargets=computed(()=>alive.value.filter(p=>{if(nightAction.value?.target==='any')return true;if(p.playerCode===props.me?.playerCode){return nightAction.value?.kind==='protect';}if(nightAction.value?.target==='hostile')return p.faction!=='heretic';return true}));
// Blood Ritual is faction-wide, independent of the viewer's own role — any
// living, non-Heretic target is legal (self is excluded automatically since
// a Heretic viewer's own faction always reads 'heretic').
const bloodRitualTargets=computed(()=>alive.value.filter(p=>p.faction!=='heretic'));
const channels=computed(()=>[{id:'public',label:'Conclave',note:'public'},...(!props.spectator&&props.me?.faction==='heretic'?[{id:'faction',label:'Cabal',note:'heretics'}]:[]),...(!props.spectator&&!props.me?.alive?[{id:'graveyard',label:'Graveyard',note:'dead'}]:[])]),
// Post-game: public chat reopens for everyone (dead, possessed, whoever) so
// the table can talk about the game afterward — mirrors authorizeChannel's
// server-side gate exactly (see heresyGameManager.js).
canChat=computed(()=>props.game.phase==='ended'?props.channel==='public':(props.channel!=='public'||props.game.phase!=='night')&&(props.me?.alive||props.channel==='graveyard')&&!props.me?.possessed);
// H6 Animus: only the Animus's own client ever sees `possessed:true` on
// another player's row before the reveal (server-gated, see state()'s
// per-row comment in heresyGameManager.js) — so finding "the possessed row
// that isn't me" IS "my current target," no extra role check needed, but we
// check role.id anyway for clarity/defensiveness.
const possessedTarget=computed(()=>role.value.id==='animus'?players.value.find(p=>p.possessed&&p.playerCode!==props.me?.playerCode)||null:null);
// H6 Animus: "speak as" now also steers voting — while it's checked, the
// vote/retract actions below act as the possessed target (server derives
// the target from possessed_by itself; this is only which button we press).
const effectiveVoterCode=computed(()=>(speakAsTarget.value&&possessedTarget.value)?possessedTarget.value.playerCode:props.me?.playerCode);
const deadline=computed(()=>props.game.deadline),timeLeft=computed(()=>{if(!deadline.value)return'—';const s=Math.max(0,Math.floor((deadline.value-props.now)/1000));const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;return h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`}),stageTitle=computed(()=>props.game.phase==='day'?`Day ${props.game.round} · ${props.game.dayStage}`:props.game.phase==='night'?`Night ${props.game.round}`:props.game.phase),stageKicker=computed(()=>props.game.phase==='night'?'THE LIGHT WITHDRAWS':'THE CONCLAVE SITS'),actionLabel=computed(()=>hasNightAction.value?pretty(nightAction.value.kind):'Keep the vigil'),lynchLeader=computed(()=>{if(!votingOpen.value)return null;const counts=voteCounts.value;let leader=null,max=-1;for(const [code,count] of Object.entries(counts)){if(code==='skip')continue;if(count>max){max=count;leader=code;}}return leader}),
// Tiered Lynch (tiered-lynch.md v1.0.0): outcome is same-day, decided by
// what fraction of LIVING votes the leader cleared — >=60% executes,
// otherwise (any positive count) tortures. Border color previews this
// live during the vote so players can coordinate before it resolves.
lynchThreshold=computed(()=>Math.ceil(alive.value.length*rules.day.EXECUTION_THRESHOLD)),
lynchLeaderOutcome=computed(()=>{if(!lynchLeader.value)return null;return targetVoteCount(lynchLeader.value)>=lynchThreshold.value?'kill':'torture'}),
standDownLeading=computed(()=>{if(!votingOpen.value)return false;const skip=voteCounts.value.skip||0;for(const [code,count] of Object.entries(voteCounts.value)){if(code!=='skip'&&count>=skip)return false;return true;}});
const secondsLeft=computed(()=>{if(!deadline.value)return null;return Math.max(0,Math.floor((deadline.value-props.now)/1000));});
const phaseProgress=computed(()=>{const total=(props.game.phase==='night'?props.game.nightMs:props.game.dayMs)||0;if(!total||secondsLeft.value==null)return 0;return Math.min(1,Math.max(0,1-(secondsLeft.value*1000)/total));});
// Players never see their raw drift number — the engine privately hints only
// when they cross a zone boundary (meta.ownZone on a private system message).
// The gauge shows the most recent hint; everyone starts the game at green.
const DRIFT_ZONES=DRIFT_ZONE_ORDER;
const zoneForValue=v=>{for(const z of DRIFT_ZONES){const[min,max]=DRIFT.ZONES[z];if(v>=min&&v<=max)return z;}return'black';};
const knownZone=computed(()=>{const msgs=props.game.privateMessages||[];for(let i=msgs.length-1;i>=0;i--){const meta=msgs[i]?.meta,z=meta&&typeof meta==='object'?meta.ownZone:null;if(z&&DRIFT_ZONES.includes(z))return z;}return 'green';});
// Q34: scaled-cost roles (Interrogator, Priest, Heretic Priest, ...) have a
// per-tier drift cost that depends on THIS game's player count, already
// baked into role.ability's prose — but a player scanning past a paragraph
// to find "the number" is exactly the failure mode a dedicated readout
// avoids. Computed straight from driftCosts.js + the live roster size, not
// parsed out of the prose. Tier keys come from the role's OWN scaledCosts
// entry (alias -> tierKeys, legacy inline -> baseValues' keys), not a
// hardcoded ['t1','t2','t3'] — Priest's are whisper/hymn/litany, not t1/t2/t3.
const scaledCostRow=computed(()=>{const r=role.value;if(!r?.scaledCostKey)return null;const n=players.value.length;if(!n)return null;const cfg=SCALED_COSTS[r.scaledCostKey];if(!cfg)return null;const tiers=cfg.curve?cfg.tierKeys:Object.keys(cfg.baseValues);return tiers.map((tier,i)=>{const v=resolveScaledCost(r.scaledCostKey,tier,n);return{tier:tier.toUpperCase(),tierNum:i+1,value:formatSigned(v),zone:zoneForValue(v)};});});
function tallyStyle(choice){return{'--fill':maxVoteCount.value?Math.min(1,(voteCounts.value[choice]||0)/maxVoteCount.value):0};}
function castVote(choice){if(speakAsTarget.value&&possessedTarget.value)emit('vote-as',{choice,justification:voteJustification.value});else emit('vote',{choice,justification:voteJustification.value})}
function retractMyVote(){if(speakAsTarget.value&&possessedTarget.value)emit('retract-vote-as');else emit('retract-vote')}
function voteFor(p){if(props.spectator||!votingOpen.value||!p.alive||p.playerCode===effectiveVoterCode.value)return;if(myVote.value?.choice===p.playerCode)return;castVote(p.playerCode)}function act(targetCode){emit('action',{targetCode,variant:variant.value||undefined})}function bloodRitual(targetCode){emit('faction-action',{targetCode})}function forge(){emit('action',{asPlayerCode:forgeAs.value,body:forgeBody.value});forgeBody.value=''}function post(){if(!draft.value||!canChat.value)return;if(speakAsTarget.value&&possessedTarget.value)emit('send-as',draft.value);else emit('send',draft.value);draft.value='';mentionQuery.value=null}function initial(n){return(n||'?')[0].toUpperCase()}function pretty(s){return String(s||'').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}function intensityLabel(v){return v==='T1'?'T1 — Soft':v==='T2'?'T2 — Standard':v==='T3'?'T3 — Brutal':pretty(v)}function status(p){if(!p.alive)return'Deceased';if(p.possessed)return'Possessed';return p.connected?'':'Vox lost'}function formatTime(t){return t?new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}function tortureTooltip(tier){if(!tier)return'Tortured once. Next vote will kill them.';if(tier===1)return'Tortured once (T1). Next vote will escalate to death.';if(tier===2)return'Tortured twice (T2). One more vote and they die.';if(tier===3)return'Dead.';return'Tortured. At risk of death.';}function targetVoteCount(choice){return voteCounts.value[choice]||0}
// @mention autocomplete: player names can contain spaces ("Player 1",
// "Priestess Vale"), so the token can't just stop at the first whitespace —
// findMentionQuery instead scans left from the caret for the nearest '@'
// (bounded by the longest actual player name, so it never runs unbounded
// down a whole message) and only accepts it if the text from '@' to the
// caret is still a case-insensitive prefix of at least one real name. That
// self-terminates the token the moment typing diverges from every
// candidate (e.g. right after "@Player 1 " once no name starts with
// "player 1 "), instead of needing an arbitrary length or space-count cap.
const composerInput=ref(null),mentionQuery=ref(null),mentionActiveIndex=ref(0);
const rawMentionNames=computed(()=>[...new Set(players.value.map(p=>p.name).filter(Boolean))]);
function findMentionQuery(text,caret){const names=rawMentionNames.value;if(!names.length)return null;const maxLen=Math.max(...names.map(n=>n.length)),lower=names.map(n=>n.toLowerCase());for(let i=caret-1;i>=0&&caret-i<=maxLen+1;i--){if(text[i]!=='@')continue;if(i>0&&!/\s/.test(text[i-1]))continue;const query=text.slice(i+1,caret);if(query.includes('\n'))continue;if(lower.some(n=>n.startsWith(query.toLowerCase())))return{start:i,query};}return null;}
function syncMentionQuery(e){const el=e.target;mentionQuery.value=findMentionQuery(el.value,el.selectionStart);mentionActiveIndex.value=0;}
// keyup fires after keydown regardless of whether keydown's default was
// prevented, so without this filter a dropdown-navigation ArrowDown/Up
// (handled and preventDefault'd in onComposerKeydown) would still hit this
// on keyup and stomp mentionActiveIndex back to 0 immediately after it was
// set — only re-sync here for keys that can move the caret on their own
// (Left/Right/Home/End/etc.), which onComposerKeydown never intercepts.
function onComposerKeyup(e){if(['ArrowUp','ArrowDown','Enter','Tab','Escape'].includes(e.key))return;syncMentionQuery(e);}
const mentionSuggestions=computed(()=>{if(!mentionQuery.value)return[];const q=mentionQuery.value.query.toLowerCase();return players.value.filter(p=>p.name.toLowerCase().startsWith(q)).slice(0,6);});
function selectMention(p){const q=mentionQuery.value,el=composerInput.value;if(!q||!el)return;const text=el.value,before=text.slice(0,q.start),after=text.slice(el.selectionStart),inserted=`@${p.name} `;draft.value=before+inserted+after;mentionQuery.value=null;nextTick(()=>{el.focus();const pos=before.length+inserted.length;el.setSelectionRange(pos,pos);});}
function onComposerKeydown(e){if(mentionSuggestions.value.length){if(e.key==='ArrowDown'){e.preventDefault();mentionActiveIndex.value=(mentionActiveIndex.value+1)%mentionSuggestions.value.length;return;}if(e.key==='ArrowUp'){e.preventDefault();mentionActiveIndex.value=(mentionActiveIndex.value-1+mentionSuggestions.value.length)%mentionSuggestions.value.length;return;}if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();selectMention(mentionSuggestions.value[mentionActiveIndex.value]);return;}if(e.key==='Escape'){e.preventDefault();mentionQuery.value=null;return;}}if(e.key==='Enter'&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&!e.metaKey){e.preventDefault();post();}}
function targetName(code){return players.value.find(p=>p.playerCode===code)?.name||'unknown';}
// @mentions: client-side only — every viewer renders the same message body,
// but only the mentioned viewer's own client adds the 'mentions-me' glow
// class, so the highlight is local to them without any server support.
// Names are matched longest-first so "Player 10" isn't shadowed by "Player 1".
// Rendered as real template elements (v-for over segments), never v-html —
// Vue's own text interpolation escapes each segment, so there's no HTML-
// injection sink here even though message bodies are fully player-controlled.
function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
const mentionNames=computed(()=>[...new Set(players.value.map(p=>p.name).filter(Boolean))].sort((a,b)=>b.length-a.length));
function mentionPattern(){return mentionNames.value.length?new RegExp('@('+mentionNames.value.map(escapeRegExp).join('|')+')','gi'):null;}
function mentionSegments(body){const pattern=mentionPattern();if(!pattern)return[{text:body,mention:false}];const segments=[];let lastIndex=0,match;while((match=pattern.exec(body))){if(match.index>lastIndex)segments.push({text:body.slice(lastIndex,match.index),mention:false});segments.push({text:match[1],mention:true});lastIndex=match.index+match[0].length;}if(lastIndex<body.length)segments.push({text:body.slice(lastIndex),mention:false});return segments;}
// Second pass: split the plain runs again on glossary terms. Mentions are left
// alone so a player called "Priest" keeps their @mention styling instead of
// turning into a rules link. TERM_PATTERN is module-level and /g, so its
// lastIndex has to be reset before every scan.
function glossarySegments(text){const out=[];TERM_PATTERN.lastIndex=0;let lastIndex=0,match;while((match=TERM_PATTERN.exec(text))){const term=lookupTerm(match[1]);if(term){if(match.index>lastIndex)out.push({text:text.slice(lastIndex,match.index)});out.push({text:match[1],term});lastIndex=match.index+match[0].length;}}if(!out.length)return[{text}];if(lastIndex<text.length)out.push({text:text.slice(lastIndex)});return out;}
// Memoised: the phase countdown ticks `now` every second, which re-renders the
// whole feed, and this would otherwise re-scan every visible message against
// the mention list and the glossary on each tick. Message bodies are immutable
// once sent, so the id is a safe key; the roster changing (new player, rename
// under anonymised mode) invalidates the whole cache because mention matching
// depends on it.
const segmentCache=new Map();
watch(mentionNames,()=>segmentCache.clear());
function messageSegments(m){const key=m.id;const body=m.body||'';const hit=key!=null?segmentCache.get(key):null;if(hit&&hit.body===body)return hit.segments;const out=[];for(const seg of mentionSegments(body)){if(seg.mention){out.push(seg);continue;}for(const piece of glossarySegments(seg.text))out.push({...piece,mention:false});}if(key!=null)segmentCache.set(key,{body,segments:out});return out;}
function messageMentionsMe(m){if(m.kind==='system'||!props.me?.name)return false;return new RegExp('@'+escapeRegExp(props.me.name)+'(?![\\w])','i').test(m.body||'');}
// ── Glossary tooltip ──────────────────────────────────────────────────────
// One shared popover teleported to <body>: the chat feed is an overflow:auto
// column, so a tooltip positioned inside it would be clipped at the panel
// edge. Fixed coordinates come from the term's own rect, flipped below when
// there isn't room above and clamped to the viewport horizontally.
const tip=ref(null),tipPos=ref({left:0,top:0,placement:'above'});
const TIP_W=290;
function showTip(term,ev){const r=ev.currentTarget.getBoundingClientRect();const above=r.top>190;const left=Math.min(Math.max(10,r.left+r.width/2-TIP_W/2),window.innerWidth-TIP_W-10);tipPos.value={left,top:above?r.top-10:r.bottom+10,placement:above?'above':'below'};tip.value=term;}
function hideTip(){tip.value=null;}
function openTerm(term){hideTip();emit('open-manual',term.doc);}
const tipStyle=computed(()=>({left:tipPos.value.left+'px',top:tipPos.value.top+'px',width:TIP_W+'px',transform:tipPos.value.placement==='above'?'translateY(-100%)':'none'}));
// Any scroll moves the anchor out from under a fixed-position tooltip, so drop
// it rather than let it float detached. Capture phase catches the inner feed.
if(typeof window!=='undefined'){window.addEventListener('scroll',hideTip,true);onBeforeUnmount(()=>window.removeEventListener('scroll',hideTip,true));}
// ── Generated sigil assets (heresy-sigils.svg, inlined in index.html) ─────
const ROLE_SIGILS={priest:'hr-priest',murderer:'hr-murderer',interrogator:'hr-interrogator',chirurgeon:'hr-chirurgeon','imperial-citizen':'hr-citizen',arbitrator:'hr-arbitrator','novice-psychic':'hr-novice-psychic','sanctioned-psyker':'hr-sanctioned-psyker',saboteur:'hr-saboteur','heretic-priest':'hr-heretic-priest',recruiter:'hr-recruiter',conspirator:'hr-conspirator',animus:'hr-animus'};
function sigilFor(r,faction){const id=r?.id;if(id&&ROLE_SIGILS[id])return '#'+ROLE_SIGILS[id];if(!id&&!faction)return '#hr-unknown';return (faction||r?.faction)==='heretic'?'#hr-murderer':'#hr-citizen';}
const phaseSigil=computed(()=>props.game.phase==='night'?'#hr-night':props.game.phase==='ended'?'#hr-verdict':'#hr-day');
// Tiered Lynch v1.2.0: any living player who has ever survived a
// torture is one more torture away from a free execution —
// public knowledge (game.atRiskTargets), independent of the live
// vote-in-progress border. Persistent (not just "yesterday"): the mark
// isn't cleared by a skip day or by someone else being tortured in
// between, so more than one player can carry it at once.
function portraitStatus(p){if(!p.alive)return'deceased';if(props.game.atRiskTargets?.includes(p.playerCode))return'at-risk';return'alive';}
// Operative seals. Keyed by displayed name (see seals.js for why not by
// playerCode), so a forged Conspirator post or an Animus speaking as their
// victim carries the seal of the name it's attributed to — which is the whole
// point of those abilities. Authors not on the roster (the Vox's system posts)
// fall back to a neutral plate.
const sealMap=computed(()=>buildSealMap(players.value.map(p=>p.name),settings.sealStyle));
function sealFor(name){return sealMap.value.get(name)||fallbackSeal(name,settings.sealStyle);}
function sealAttrs(name){const s=sealFor(name);return{'data-seal-kind':s.kind,'data-seal':s.pattern,class:s.text.length>1?'seal-mono':null,style:sealVars(s)};}
function sealText(name){return sealFor(name).text;}
// Classify a system-log line so the transcript is scannable — glyph + tint
// per event type. Night kills are tagged server-side (meta.eventType —
// see heresyGameManager.js's system() calls) rather than sniffed from the
// message text, because the actual kill/bodyguard-redirect flavor lines
// (data/deathFlavor.json) are randomized narrative prose ("was found cut
// in two by a chainsword", "was melted from the inside by a melta gun",
// etc.) that never contained a stable common keyword — a body-regex here
// silently matched nothing for the real production text, which is why
// night kills were falling through to the generic grey 'system' bucket.
// meta may arrive as a JSON string (live socket messages / chat history)
// or an already-parsed object, so this tolerates either.
function messageEventType(m){if(!m?.meta)return null;try{const meta=typeof m.meta==='string'?JSON.parse(m.meta):m.meta;return meta?.eventType||null;}catch{return null;}}
function classifyEntry(m){const eventType=messageEventType(m),b=String(m?.body||'');
  if(eventType==='night-kill')return{type:'death',glyph:'#hr-deceased'};
  if(/victory|conclave is (ended|dissolved)|game over|ended by admin/i.test(b))return{type:'verdict',glyph:'#hr-verdict'};
  // Torture-chamber outcome lines (all deathFlavor tortureChamber variants end
  // in "and left <severity>") get their own glyph, distinct from executions.
  if(/and left (wounded|crippled|shattered)|torture chamber|excruciator|agony bonds/i.test(b))return{type:'torture',glyph:'#hr-torture'};
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
/* Tiered Lynch (tiered-lynch.md v1.0.0): red = will execute (>=EXECUTION_THRESHOLD of
   living votes), orange = will be tortured (leading, but under threshold). Threshold defined in game_data/rules.json. */
.player-list li.lynch-leader.kill {
  border-color: #ff3333;
  /* background-color only — the fx layer adds a red corner reticle via
     background-image, and a shorthand here would wipe it out */
  background-color: rgba(255, 51, 51, 0.18);
  box-shadow:
    0 0 0 1px rgba(255, 51, 51, 0.35),
    0 0 20px rgba(255, 51, 51, 0.35);
  animation: lynchPulse 1s ease-in-out infinite alternate;
}
.player-list li.lynch-leader.torture {
  border-color: #ff9333;
  background-color: rgba(255, 147, 51, 0.16);
  box-shadow:
    0 0 0 1px rgba(255, 147, 51, 0.32),
    0 0 20px rgba(255, 147, 51, 0.3);
  animation: lynchPulseAmber 1s ease-in-out infinite alternate;
}

.player-list li.voted {
  opacity: 0.55;
  cursor: not-allowed;
  background: rgba(182, 154, 92, 0.08);
  box-shadow: inset 3px 0 0 var(--gold);
}
.player-list li.voted:hover { background: rgba(182, 154, 92, 0.08); }

/* Tortured player row — gold left-border accent + amber tint */
.player-list li.crippled {
  border-left-color: #d4a84a;
  background: linear-gradient(160deg, rgba(48, 40, 16, 0.5), rgba(22, 18, 8, 0.55));
}
.player-list li.crippled.me {
  border-left-color: #d4a84a;
  background: linear-gradient(160deg, rgba(52, 44, 20, 0.65), rgba(26, 20, 10, 0.65));
}
.player-list li.crippled.dead {
  border-left-color: #26281f;
}

/* Tier badge — small colored pill shown below the player name */
.tier-badge {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 7px 2px;
  font: 600 9px/1.4 Inter, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.35);
}
.tier-badge[data-tier="1"] {
  color: #d4a84a;
  border-color: rgba(212, 168, 74, 0.5);
  box-shadow: 0 0 6px rgba(212, 168, 74, 0.15);
}
.tier-badge[data-tier="2"] {
  color: #d99b95;
  border-color: rgba(217, 155, 149, 0.5);
  box-shadow: 0 0 6px rgba(217, 155, 149, 0.15);
}
.tier-badge[data-tier="3"] {
  color: #ff8a8a;
  border-color: rgba(255, 138, 138, 0.5);
  box-shadow: 0 0 8px rgba(255, 60, 60, 0.25);
  animation: tier3-pulse 1.5s ease-in-out infinite alternate;
}
@keyframes tier3-pulse {
  from { box-shadow: 0 0 4px rgba(255, 60, 60, 0.15); }
  to   { box-shadow: 0 0 12px rgba(255, 60, 60, 0.4); }
}

/* Death badge — same pill slot as the tier badge, but for a dead player:
   the execution glyph (lynched, tier 3 + killed together) or the plain
   deceased glyph (killed at night — Murderer, Blood Ritual, Psyker, etc.),
   matching the glyphs classifyEntry() already uses for these exact events
   in the chat log. */
.death-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 4px;
  width: 20px;
  height: 16px;
  border: 1px solid rgba(139, 141, 132, 0.5);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.35);
  color: #8b8d84;
}
.death-glyph { width: 11px; height: 11px; }
.death-badge.executed {
  color: #ff8a8a;
  border-color: rgba(255, 138, 138, 0.5);
  box-shadow: 0 0 8px rgba(255, 60, 60, 0.25);
}

/* Possessed badge (H6 Animus) — same pill shape as tier badges, distinct
   violet tone so it never gets confused with a torture tier. Server
   only ever sends p.possessed to a client entitled to see it (the Animus's
   own view of their target, the possessed player's own view of themself,
   or everyone once the reveal has fired) — no extra gating needed here. */
.possessed-badge {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 7px 2px;
  font: 600 9px/1.4 Inter, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid rgba(168, 130, 255, 0.5);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.35);
  color: #b79bff;
  box-shadow: 0 0 6px rgba(168, 130, 255, 0.2);
}
.tortured-badge {
  display: inline-block;
  margin-top: 4px;
  margin-left: 4px;
  padding: 1px 7px 2px;
  font: 600 9px/1.4 Inter, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid rgba(255, 140, 100, 0.6);
  border-radius: 2px;
  background: rgba(60, 20, 10, 0.5);
  color: #ff9d7a;
  box-shadow: 0 0 6px rgba(255, 140, 100, 0.2);
}

.speak-as-toggle {
  /* The global label{flex-direction:column;margin:15px 0} reset (style.css,
     meant for form fields) wins per-property on anything this rule doesn't
     explicitly set itself — flex-direction and the other margin sides were
     falling through to it, stacking the checkbox above the text instead of
     beside it. Every property that reset touches needs an explicit value
     here, not just the ones that happened to differ. */
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  font: 600 10px/1.4 Inter, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #b79bff;
  margin: 0 0 6px;
  cursor: pointer;
}
/* The global input{width:100%;border;background;padding;border-radius}
   reset (style.css, meant for text/number fields) also lands on this
   checkbox and flattens it into a barely-visible filled square. Reset
   those specifically and let accent-color theme the native control. */
.speak-as-toggle input[type="checkbox"] {
  appearance: auto;
  -webkit-appearance: auto;
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  border-radius: 0;
  accent-color: #b79bff;
  cursor: pointer;
}

/* Speak-as glow: same violet as the possessed badge/toggle, so the
   composer visibly signals "you're channeling the possessed target"
   while the checkbox above is on. */
.composer textarea.speaking-as {
  border-color: rgba(168, 130, 255, 0.55);
  box-shadow: 0 0 0 2px rgba(168, 130, 255, 0.15), 0 0 14px rgba(168, 130, 255, 0.25);
}
.composer textarea.speaking-as:focus {
  border-color: #b79bff;
  box-shadow: 0 0 0 2px rgba(168, 130, 255, 0.25), 0 0 18px rgba(168, 130, 255, 0.4);
}

/* @mention autocomplete dropdown — anchored above the composer textarea
   since the composer sits at the bottom of the panel and a below-anchored
   list would usually be clipped by the viewport edge. */
.composer-field {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
}
.mention-suggestions {
  position: absolute;
  z-index: 5;
  bottom: 100%;
  left: 0;
  right: 0;
  margin: 0 0 4px;
  padding: 4px;
  list-style: none;
  max-height: 160px;
  overflow-y: auto;
  background: linear-gradient(160deg, #1c1f1a, #0d0f0d);
  border: 1px solid rgba(182, 154, 92, 0.35);
  box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.45);
  border-radius: 2px;
}
.mention-suggestions li {
  padding: 6px 10px;
  font: 500 12px Inter, sans-serif;
  color: var(--pale);
  cursor: pointer;
  border-radius: 2px;
}
.mention-suggestions li.active,
.mention-suggestions li:hover {
  background: rgba(111, 209, 224, 0.14);
  color: #6fd1e0;
}

/* @mentions: the "@Name" token is a real template <span> (v-for over
   messageSegments), not v-html, so it picks up this component's scoped
   data-v-* attribute normally — no :deep() needed. Only the mentioned
   viewer's own client ever has 'mentions-me' set (see messageMentionsMe
   in script), so the glow never appears on anyone else's screen. */
.message .mention {
  color: #6fd1e0;
  font-weight: 700;
  text-shadow: 0 0 6px rgba(111, 209, 224, .45);
}
/* Glossary terms: a real <button> so hover, keyboard focus and click all work
   from one element. Reset hard — the global button rules in style.css would
   otherwise give these padding, uppercase and a border. Inherits the
   surrounding text's font and colour so a marked word reads as prose with a
   rule under it, not as a control dropped into the sentence. */
.message .glossary-term,
.log-entry .glossary-term {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: none;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: help;
  text-decoration: underline dotted rgba(182, 154, 92, .7);
  text-underline-offset: 3px;
  transition: color .12s ease, text-decoration-color .12s ease;
}
.message .glossary-term:hover,
.message .glossary-term:focus-visible,
.log-entry .glossary-term:hover,
.log-entry .glossary-term:focus-visible {
  color: var(--gold2);
  text-decoration-color: var(--gold2);
}

/* Teleported to <body>, so it sits outside .message — but it is still written
   in this component's template and therefore carries the scope attribute. */
.glossary-tip {
  position: fixed;
  z-index: 1200;
  padding: 12px 14px 10px;
  background: linear-gradient(160deg, rgba(24, 26, 21, .99), rgba(13, 15, 13, .99));
  border: 1px solid var(--gold);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .75), inset 0 0 14px rgba(182, 154, 92, .05);
  pointer-events: none;
  animation: tipIn .13s ease;
}
@keyframes tipIn { from { opacity: 0; } }
.glossary-tip .tip-kind {
  display: block;
  font: 700 8px Inter, sans-serif;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 3px;
}
.glossary-tip .tip-kind.heretic { color: #d4534a; }
.glossary-tip .tip-label {
  display: block;
  font: 700 14px Cinzel, serif;
  letter-spacing: .06em;
  color: var(--pale);
  margin-bottom: 6px;
}
.glossary-tip .tip-gloss {
  margin: 0;
  font: 400 12.5px/1.5 Georgia, serif;
  color: #cfcdc0;
}
.glossary-tip .tip-more {
  display: block;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid rgba(182, 154, 92, .18);
  font: 600 8.5px Inter, sans-serif;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--muted);
}

.message.mentions-me p {
  border-color: #6fd1e0;
  border-left-color: #6fd1e0;
  box-shadow:
    0 0 0 1px rgba(111, 209, 224, .4),
    0 0 18px rgba(111, 209, 224, .35);
  animation: mentionGlow 1.4s ease-in-out infinite alternate;
}
.message.mentions-me p::before {
  border-color: rgba(111, 209, 224, .7);
}
@keyframes mentionGlow {
  from { box-shadow: 0 0 0 1px rgba(111, 209, 224, .3), 0 0 10px rgba(111, 209, 224, .22); }
  to   { box-shadow: 0 0 0 1px rgba(111, 209, 224, .55), 0 0 24px rgba(111, 209, 224, .5); }
}
@media (prefers-reduced-motion: reduce) { .message.mentions-me p { animation: none; } }

@keyframes lynchPulse {
  from { box-shadow: 0 0 0 1px rgba(255, 51, 51, 0.35), 0 0 14px rgba(255, 51, 51, 0.25); }
  to   { box-shadow: 0 0 0 1px rgba(255, 51, 51, 0.55), 0 0 28px rgba(255, 51, 51, 0.5); }
}
@keyframes lynchPulseAmber {
  from { box-shadow: 0 0 0 1px rgba(255, 147, 51, 0.32), 0 0 14px rgba(255, 147, 51, 0.22); }
  to   { box-shadow: 0 0 0 1px rgba(255, 147, 51, 0.5), 0 0 28px rgba(255, 147, 51, 0.45); }
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
/* Cabal channel keeps its oxblood glow, but the seal still supplies the
   tone and ink — who is speaking matters more than which channel, and the
   bubble/header already carry the channel colour. */
.message.faction .avatar.mini {
  box-shadow:
    0 0 0 1px #0a0b09,
    0 0 10px rgba(255, 107, 107, .22),
    inset 0 1px 0 rgba(255, 138, 138, .15);
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

/* Warp-taint zone gauge — five segments, one lit: the last zone the Warp
   whispered to this player. Not a numeric readout; drift stays hidden. */
.role-meta .zone-row { grid-column: 1 / -1; }
.role-meta .zone-row dd { display: flex; align-items: center; gap: 8px; }
.zone-gauge { display: inline-flex; gap: 3px; }
.zone-gauge i {
  width: 14px; height: 7px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  clip-path: polygon(2px 0, 100% 0, calc(100% - 2px) 100%, 0 100%);
  transition: background 0.3s ease, box-shadow 0.3s ease;
}
.zone-gauge i.green.lit  { background: #5c8a76; box-shadow: 0 0 8px rgba(92, 138, 118, 0.6); border-color: #5c8a76; }
.zone-gauge i.yellow.lit { background: #c9a961; box-shadow: 0 0 8px rgba(201, 169, 97, 0.6); border-color: #c9a961; }
.zone-gauge i.orange.lit { background: #c07840; box-shadow: 0 0 8px rgba(192, 120, 64, 0.65); border-color: #c07840; }
.zone-gauge i.red.lit    { background: #a32a26; box-shadow: 0 0 9px rgba(163, 42, 38, 0.75); border-color: #c14545; }
.zone-gauge i.black.lit  { background: #171214; box-shadow: 0 0 10px rgba(163, 42, 38, 0.9); border-color: #d4534a; }
.zone-word { font: 700 10px Inter, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; }
.zone-word.green  { color: #7fae97; }
.zone-word.yellow { color: var(--gold2); }
.zone-word.orange { color: #d8945e; }
.zone-word.red    { color: #d4534a; }
.zone-word.black  { color: #e0574c; text-shadow: 0 0 8px rgba(163, 42, 38, 0.8); }

/* Scaled-cost readout — one chip per intensity tier, tinted by the drift zone
   that tier's cost lands the player in. Vocabulary mirrors tier-badge (pill
   shape) and zone-word (zone palette) so it reads as part of the dossier. */
.role-meta .cost-row dd { gap: 6px; flex-wrap: wrap; }
.cost-chip {
  display: inline-flex; align-items: baseline; gap: 4px;
  padding: 2px 7px 3px;
  font: 600 9px/1.4 Inter, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.35);
  white-space: nowrap;
}
.cost-chip .chip-tier { font-weight: 700; opacity: 0.72; letter-spacing: 0.1em; }
.cost-chip .chip-cost { font-weight: 600; letter-spacing: 0.04em; }
.cost-chip.green  { color: #7fae97; border-color: rgba(127, 174, 151, 0.45); box-shadow: 0 0 6px rgba(92, 138, 118, 0.18); }
.cost-chip.yellow { color: var(--gold2); border-color: rgba(201, 169, 97, 0.5); box-shadow: 0 0 6px rgba(201, 169, 97, 0.18); }
.cost-chip.orange { color: #d8945e; border-color: rgba(216, 148, 94, 0.5); box-shadow: 0 0 7px rgba(192, 120, 64, 0.2); }
.cost-chip.red    { color: #d4534a; border-color: rgba(212, 83, 74, 0.55); box-shadow: 0 0 8px rgba(163, 42, 38, 0.28); }
.cost-chip.black  { color: #e0574c; border-color: rgba(224, 87, 76, 0.6); box-shadow: 0 0 10px rgba(163, 42, 38, 0.45); text-shadow: 0 0 8px rgba(163, 42, 38, 0.6); }

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

/* Cabal Directive — Blood Ritual is faction-wide, not a personal role
   ability, so it gets the heretic red tint (matching .role-card.heretic)
   instead of the gold used for every personal night directive. */
.cabal-directive {
  border-color: #6b3030;
  box-shadow:
    0 0 0 1px rgba(193, 69, 69, 0.25),
    0 0 18px rgba(255, 90, 90, 0.14),
    inset 0 0 24px rgba(193, 69, 69, 0.08);
  animation: cabalGlow 2.6s ease-in-out infinite alternate;
}
.cabal-directive .eyebrow {
  color: #d77272;
}
.cabal-hint {
  font: 400 11px/1.5 Georgia, serif;
  color: var(--muted);
  font-style: italic;
  margin: 4px 0 14px;
}
@keyframes cabalGlow {
  from {
    box-shadow:
      0 0 0 1px rgba(193, 69, 69, 0.2),
      0 0 14px rgba(255, 90, 90, 0.1),
      inset 0 0 20px rgba(193, 69, 69, 0.06);
  }
  to {
    box-shadow:
      0 0 0 1px rgba(193, 69, 69, 0.4),
      0 0 26px rgba(255, 90, 90, 0.24),
      inset 0 0 32px rgba(193, 69, 69, 0.12);
  }
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
/* Geometry only — the tone, field and border come from the operative seal
   ([data-seal] in style.css). Status stays on --ring, which now drives just
   the corner pip and the at-risk glow rather than the whole plate, so
   identity and state never fight for the same surface. */
.player-list .portrait {
  --ring: #7d6a3f;
  position: relative;
  display: grid; place-items: center;
  flex: 0 0 34px; width: 34px; height: 34px;
  font: 700 13px Cinzel, serif; line-height: 1;
  clip-path: polygon(28% 0, 72% 0, 100% 28%, 100% 72%, 72% 100%, 28% 100%, 0 72%, 0 28%);
}
.player-list .portrait::after {
  content: ''; position: absolute; right: -1px; bottom: -1px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ring); box-shadow: 0 0 8px var(--ring);
}
.player-list .portrait[data-status="alive"]    { --ring: #b69a5c; }
/* Dead operatives desaturate but keep their field and initial, so you can
   still tell at a glance who the body was. */
.player-list .portrait[data-status="deceased"] { --ring: #3a2f22; filter: grayscale(1) brightness(.75); }
/* Tiered Lynch v1.1.0: tortured yesterday — one more torture
   (as today's lynch leader) away from a free execution. Persistent, unlike
   the live vote-in-progress .lynch-leader border below. */
.player-list .portrait[data-status="at-risk"] {
  --ring: #ff9333;
  animation: at-risk-pulse 1.8s ease-in-out infinite alternate;
}
@keyframes at-risk-pulse {
  from { box-shadow: 0 0 0 0 rgba(255, 147, 51, 0); }
  to   { box-shadow: 0 0 10px 1px rgba(255, 147, 51, .6); }
}
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
.log-time { font: 400 11px Inter, sans-serif; opacity: 0.65; flex: none; white-space: nowrap; }
.log-entry::after {
  content: ''; flex: none; width: 26%; height: 1px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tint) 34%, transparent), transparent);
}
.log-entry--accusation { --tint: #b69a5c; }
.log-entry--vote       { --tint: #8f9c6a; }
.log-entry--execution  { --tint: #c14545; }
.log-entry--torture    { --tint: #c07840; }
.log-entry--death      { --tint: #ff5c4d; }
.log-entry--phase      { --tint: #7f8ca6; }
.log-entry--verdict    { --tint: var(--gold2); }
.log-entry--system     { --tint: var(--muted); }

@media (prefers-reduced-motion: reduce) { .verdict-seal { animation: none; } }
@media (max-width: 460px) { .log-entry::after { display: none; } }
</style>
