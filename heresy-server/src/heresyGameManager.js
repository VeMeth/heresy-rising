import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateRoomCode, sanitizePlayerName, shuffle } from './utils.js';
import { loadGameConfig } from './gameConfig.js';
import { NOTABLE_NAMES } from './notableNames.js';
import { driftZone, intelNoiseRate, noisyResult, murdererGateCue } from './mechanics/drift.js';
import { effectiveCrippleTier, getEffectiveScanTier, isExecuteOnSight, crippleSeverityLabel } from './mechanics/interrogation.js';
import { canProtectSelf, validateRotation, getLastProtectTarget } from './mechanics/protection.js';
import { validateComposition } from './validators/composition.js';
import { saveGameLogSnapshot } from './gameLogs.js';

// Phase-length defaults (ms) for the two lobby modes, and the bounds
// start()/configure() clamp host-supplied overrides into.
const DAY_MS_SYNC_DEFAULT = 300_000;
const NIGHT_MS_SYNC_DEFAULT = 120_000;
// Async mode: day and night are locked at 12h each (not separately
// configurable) — the host instead sets a wall-clock day-start time
// (day_start_minute_utc), and start() aligns the first boundary to it (see
// nextScheduleBoundary below).
const ASYNC_PHASE_MS = 43_200_000;
const DEFAULT_DAY_START_MINUTE_UTC = 540; // 09:00 UTC
const PHASE_MS_FLOOR_START = 10_000;
const PHASE_MS_FLOOR_CONFIGURE = 60_000;
const PHASE_MS_CEILING = 86_400_000;
const MAX_DRIFT_CEILING = 100;

// Async mode's day/night are both exactly 12h, so once the very FIRST
// phase boundary lands on the host's chosen day-start time, every later
// boundary (setPhase() just adds the fixed 12h duration) automatically
// keeps landing on the same wall-clock time forever — no per-transition
// rescheduling needed.
//
// start() always creates the game in 'day' phase (see below), so this first
// boundary is unconditionally "when does Night 1 begin" — the next
// occurrence of dayStartMinuteUtc + 12h. It must NOT be "whichever of
// {day-start, day-start+12h} comes up soonest": if the host starts the game
// after today's day-start+12h instant has already passed, the nearer
// instant is tomorrow's day-start, and locking onto that instead silently
// swaps which 12h half of the day is labelled "day" vs "night" for the
// entire rest of the game (every later boundary is a fixed +12h step from
// whatever this first one was, so a wrong pick here never self-corrects).
function nextScheduleBoundary(now, dayStartMinuteUtc) {
  const DAY_MS = 86_400_000;
  const nightStartMs = (((Number(dayStartMinuteUtc) || 0) + 720) % 1440) * 60_000;
  const todayMidnight = Math.floor(now / DAY_MS) * DAY_MS;
  const candidates = [-1, 0, 1].map(offset => todayMidnight + offset * DAY_MS + nightStartMs);
  return candidates.filter(t => t > now).sort((a, b) => a - b)[0];
}

/**
 * @typedef {Object} GameRow
 * @property {string} code
 * @property {string} host_code
 * @property {string} mode
 * @property {string} phase
 * @property {string|null} day_stage
 * @property {string} status
 * @property {number} round
 * @property {number|null} deadline
 * @property {number} day_ms
 * @property {number} night_ms
 * @property {number} max_drift
 * @property {string} hint_profile
 * @property {string|null} last_tortured_target
 * @property {number} last_torture_tier
 * @property {string|null} winner
 * @property {number} anonymized
 * @property {number} warp_taint_visible
 * @property {number|null} day_start_minute_utc
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * @typedef {Object} PlayerRow
 * @property {string} game_code
 * @property {string} player_code
 * @property {string} name
 * @property {string|null} codename
 * @property {number} seat
 * @property {number} display_order
 * @property {string|null} role_id
 * @property {string|null} faction
 * @property {number} drift
 * @property {number} alive
 * @property {number} ready
 * @property {number} connected
 * @property {number} cripple_tier
 * @property {number|null} tier1_until_round
 * @property {number} confessed
 * @property {number|null} confession_token_round
 * @property {number} skip_next_night
 * @property {number} joined_at
 * @property {number} is_bot
 * @property {string|null} possessed_by
 * @property {number} possession_revealed
 * @property {number} tortured_before
 */

/**
 * @typedef {Object} ActionRow
 * @property {string} game_code
 * @property {number} round
 * @property {string} actor_code
 * @property {string} kind
 * @property {string|null} target_code
 * @property {string|null} variant
 * @property {string|null} data
 * @property {number} created_at
 */

/**
 * @typedef {Object} VoteRow
 * @property {string} game_code
 * @property {number} round
 * @property {string} stage
 * @property {string} voter_code
 * @property {string} choice
 * @property {number} created_at
 */

const schema = `
CREATE TABLE IF NOT EXISTS hr_games(code TEXT PRIMARY KEY,host_code TEXT NOT NULL,mode TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'lobby',day_stage TEXT,status TEXT NOT NULL DEFAULT 'lobby',round INTEGER NOT NULL DEFAULT 0,deadline INTEGER,day_ms INTEGER NOT NULL,night_ms INTEGER NOT NULL,max_drift INTEGER NOT NULL,hint_profile TEXT NOT NULL DEFAULT 'default',last_tortured_target TEXT,last_torture_tier INTEGER NOT NULL DEFAULT 0,winner TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hr_players(game_code TEXT NOT NULL,player_code TEXT NOT NULL,name TEXT NOT NULL,seat INTEGER NOT NULL,role_id TEXT,faction TEXT,drift INTEGER NOT NULL DEFAULT 0,alive INTEGER NOT NULL DEFAULT 1,ready INTEGER NOT NULL DEFAULT 0,connected INTEGER NOT NULL DEFAULT 1,cripple_tier INTEGER NOT NULL DEFAULT 0,tier1_until_round INTEGER,confessed INTEGER NOT NULL DEFAULT 0,confession_token_round INTEGER,skip_next_night INTEGER NOT NULL DEFAULT 0,joined_at INTEGER NOT NULL,PRIMARY KEY(game_code,player_code));
CREATE TABLE IF NOT EXISTS hr_actions(game_code TEXT NOT NULL,round INTEGER NOT NULL,actor_code TEXT NOT NULL,kind TEXT NOT NULL,target_code TEXT,variant TEXT,data TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(game_code,round,actor_code));
CREATE TABLE IF NOT EXISTS hr_votes(game_code TEXT NOT NULL,round INTEGER NOT NULL,stage TEXT NOT NULL,voter_code TEXT NOT NULL,choice TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(game_code,round,stage,voter_code));
CREATE TABLE IF NOT EXISTS hr_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,game_code TEXT NOT NULL,channel TEXT NOT NULL,recipient_code TEXT,player_code TEXT,author TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'player',created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hr_messages_cursor ON hr_messages(game_code,id);
CREATE TABLE IF NOT EXISTS hr_usage(game_code TEXT NOT NULL,player_code TEXT NOT NULL,ability TEXT NOT NULL,uses INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(game_code,player_code,ability));
CREATE TABLE IF NOT EXISTS hr_events(id INTEGER PRIMARY KEY AUTOINCREMENT,game_code TEXT NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
`;

export function isHostileTo(a, b) {
  // TODO(heresy-spec): v1 hostility is the non-canonical two-faction inequality default.
  return a.faction !== b.faction;
}

export class HeresyGameManager {
  constructor({ databasePath = process.env.GAME_DB_PATH || path.join(process.cwd(), 'data', 'heresy-rising.db'), now = () => Date.now(), random = Math.random } = {}) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath); this.db.pragma('journal_mode = WAL'); this.db.exec(schema);this.ensureColumn('hr_games','hint_profile',"TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn('hr_players','is_bot',"INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn('hr_messages','meta',"TEXT");
    // H6 Animus (roles/animus.md v1.0.0): the possessed player's own code, set
    // when a Red-zone target is confirmed possessed at night-end, cleared on
    // the day-end Neverborn detonation (which also kills them). At most one
    // living player can carry this at a time — Animus is one-shot per game.
    this.ensureColumn('hr_players','possessed_by',"TEXT");
    this.ensureColumn('hr_players','possession_revealed',"INTEGER NOT NULL DEFAULT 0");
    // Tiered Lynch v1.2.0 (tiered-lynch.md): set the first time this player is
    // tortured (<60%, survives) and never cleared except by death — the
    // mark persists across skip days, other targets being tortured in
    // between, anything, per spec ("no cabal defense, no pivot reset"). A
    // second torture on a marked player escalates to execution
    // regardless of how many days or which other targets came between.
    // (Renamed from interrogated_before/last_interrogated_target/
    // last_interrogation_tier — "interrogation" was overloaded between this
    // day-vote outcome and the unrelated L2 Interrogator role's night scan.
    // "Torture" is the day-vote outcome; "Interrogator" stays the role name.)
    this.renameColumn('hr_players','interrogated_before','tortured_before',"INTEGER NOT NULL DEFAULT 0");
    this.renameColumn('hr_games','last_interrogated_target','last_tortured_target',"TEXT");
    this.renameColumn('hr_games','last_interrogation_tier','last_torture_tier',"INTEGER NOT NULL DEFAULT 0");
    // Anonymized mode (Operational Parameters, lobby-only, off by default):
    // when on, start() assigns each player row a codename drawn from
    // NOTABLE_NAMES; displayName() below is the single place that decides
    // whether narrative text/state payloads show it or the real `name`.
    this.ensureColumn('hr_games','anonymized',"INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn('hr_players','codename',"TEXT");
    // Warp-taint gauge (Operational Parameters, lobby-only, off by default):
    // when on, the client's dossier shows the last-sensed-zone gauge. This
    // is a pure display preference — the server always computes and sends
    // the zone hint privately regardless of this flag; only the client's
    // rendering of it is gated. See state()/spectate() below.
    this.ensureColumn('hr_games','warp_taint_visible',"INTEGER NOT NULL DEFAULT 0");
    // Roster display order, assigned as a fresh random permutation at start().
    // The in-game roster is ordered by this instead of by seat, for two
    // reasons: seat is join order, so a seat-ordered roster gives whoever
    // joined first a permanent position advantage (primacy bias in a game
    // whose core act is voting on a list); and because codenames are handed
    // out in seat order, a seat-ordered roster kept the SAME row position
    // across the lobby -> game transition, which handed anyone who glanced
    // at the lobby a complete codename -> real-name mapping and defeated
    // anonymized mode outright. Persisted rather than shuffled per request
    // so the roster doesn't reshuffle under players on every state push.
    // Defaults to 0: pre-existing games fall back to seat order via the
    // (display_order, seat) sort in state()/spectate().
    this.ensureColumn('hr_players','display_order',"INTEGER NOT NULL DEFAULT 0");
    // Async mode's host-chosen day-start time (minutes since midnight UTC,
    // 0-1439); unused/null for live games. See nextScheduleBoundary above.
    this.ensureColumn('hr_games','day_start_minute_utc',"INTEGER");
    this.now = now; this.random = random; this.config = loadGameConfig();
    this._announcementListeners = [];
    this._botPromptListeners = [];
    this._chatMessageListeners = [];
  }
  onAnnouncement(fn){this._announcementListeners.push(fn);}
  emitAnnouncement(c,a){for(const fn of this._announcementListeners)try{fn(c,a);}catch{}}
  onBotPrompt(fn){this._botPromptListeners.push(fn);}
  emitBotPrompt(c,payload){for(const fn of this._botPromptListeners)try{fn(c,payload);}catch{}}
  onChatMessage(fn){this._chatMessageListeners.push(fn);}
  emitChatMessage(c,message){for(const fn of this._chatMessageListeners)try{fn(c,message);}catch{}}
  close(){this.db.close();}
  ensureColumn(table,column,definition){if(!/** @type {{name:string}[]} */ (this.db.prepare(`PRAGMA table_info(${table})`).all()).some(x=>x.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
  // Renames a column in place on existing DBs (e.g. a mid-life terminology
  // rename); a brand-new DB already has `newColumn` from the base CREATE
  // TABLE/a prior ensureColumn, so this only acts when the old name is
  // still there and the new one isn't.
  renameColumn(table,oldColumn,newColumn,definition){const cols=/** @type {{name:string}[]} */ (this.db.prepare(`PRAGMA table_info(${table})`).all());if(cols.some(x=>x.name===oldColumn)&&!cols.some(x=>x.name===newColumn))this.db.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldColumn} TO ${newColumn}`);else this.ensureColumn(table,newColumn,definition);}
  /** @returns {GameRow|undefined} */
  game(c){return /** @type {GameRow|undefined} */ (this.db.prepare('SELECT * FROM hr_games WHERE code=?').get(c));}
  /** @returns {PlayerRow[]} */
  players(c){return /** @type {PlayerRow[]} */ (this.db.prepare('SELECT * FROM hr_players WHERE game_code=? ORDER BY seat').all(c));}
  // Roster as the players themselves see it: the shuffled display order set at
  // start(). Kept separate from players() — that stays in seat order because
  // game logic (role dealing, codename assignment, iteration) is indexed by it.
  // Falls back to seat for lobby rows and pre-migration games, which all carry
  // display_order 0.
  /** @returns {PlayerRow[]} */
  rosterPlayers(c){return /** @type {PlayerRow[]} */ (this.db.prepare('SELECT * FROM hr_players WHERE game_code=? ORDER BY display_order,seat').all(c));}
  /** @returns {PlayerRow|undefined} */
  player(c,p){return /** @type {PlayerRow|undefined} */ (this.db.prepare('SELECT * FROM hr_players WHERE game_code=? AND player_code=?').get(c,p));}
  // The one place that decides real name vs. anonymized-mode codename for
  // anything player-facing (chat authors, narrative text, state payloads).
  // adminPlayer()/saveGameLogSnapshot() deliberately bypass this and read
  // row.name directly — admin/audit tooling always sees the real identity.
  displayName(g,row){return (g?.anonymized&&row?.codename)?row.codename:row?.name;}
  role(id){const role=this.config.roles.get(id);if(!role)throw new Error('Unknown role data');return role;}
  codes(){return new Set(/** @type {{code:string}[]} */ (this.db.prepare('SELECT code FROM hr_games').all()).map(x=>x.code));}
  presetFor(count){
    // TODO(heresy-spec): Entire 5–12 composition table and priority fallback are non-canonical, unplaytested defaults.
    const exact=this.config.composition[String(count)]; if(exact)return [...exact];
    const roles=this.config.composition.fallbackPriority.slice(0,Math.max(0,count-1));
    while(roles.length<count)roles.push('imperial-citizen'); return roles.slice(0,count);
  }
  roleDefinitions(){return this.config.roleList.map(({ability,objective,...role})=>({...role,ability,objective}));}
  /**
   * @param {object} params
   * @param {string} params.playerCode
   * @param {string} params.name
   * @param {string} [params.mode]
   * @param {{dayMs?:number,nightMs?:number,maxDrift?:number,hintProfile?:string,dayStartMinuteUtc?:number}} [params.options]
   */
  create({playerCode,name,mode='live',options={}}){
    if(!playerCode)throw new Error('playerCode is required'); if(!['live','async'].includes(mode))throw new Error('Invalid game mode');
    const code=generateRoomCode(this.codes(),6),now=this.now(),dayMs=mode==='async'?ASYNC_PHASE_MS:(Number(options.dayMs)||DAY_MS_SYNC_DEFAULT),nightMs=mode==='async'?ASYNC_PHASE_MS:(Number(options.nightMs)||NIGHT_MS_SYNC_DEFAULT),max=Math.max(1,Number(options.maxDrift)||this.config.drift.MAX_DRIFT),hintProfile=this.config.hintProfiles[options.hintProfile] ? options.hintProfile : 'default';
    const rawDayStart=Number(options.dayStartMinuteUtc),dayStartMinuteUtc=mode==='async'?Math.max(0,Math.min(1439,Number.isFinite(rawDayStart)?Math.round(rawDayStart):DEFAULT_DAY_START_MINUTE_UTC)):null;
    this.db.prepare('INSERT INTO hr_games(code,host_code,mode,day_ms,night_ms,max_drift,hint_profile,day_start_minute_utc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(code,playerCode,mode,dayMs,nightMs,max,hintProfile,dayStartMinuteUtc,now,now);
    this.db.prepare('INSERT INTO hr_players(game_code,player_code,name,seat,joined_at) VALUES(?,?,?,?,?)').run(code,playerCode,sanitizePlayerName(name),0,now); return {code,state:this.state(code,playerCode)};
  }
  join({code,playerCode,name}){const g=this.requireGame(code);let p=this.player(code,playerCode);if(!p){if(g.phase!=='lobby')throw new Error('Game already started');const count=this.players(code).length;if(count>=12)throw new Error('Game is full');this.db.prepare('INSERT INTO hr_players(game_code,player_code,name,seat,joined_at) VALUES(?,?,?,?,?)').run(code,playerCode,sanitizePlayerName(name),count,this.now());}else this.db.prepare('UPDATE hr_players SET connected=1 WHERE game_code=? AND player_code=?').run(code,playerCode);return this.state(code,playerCode);}
  disconnect(playerCode,gameCode){if(gameCode)this.db.prepare('UPDATE hr_players SET connected=0 WHERE game_code=? AND player_code=?').run(gameCode,playerCode);else this.db.prepare('UPDATE hr_players SET connected=0 WHERE player_code=?').run(playerCode);}
reconnect(c,p){this.requirePlayer(c,p);this.db.prepare('UPDATE hr_players SET connected=1 WHERE game_code=? AND player_code=?').run(c,p);return this.state(c,p);}
  kick(c,hostCode,targetCode){const g=this.requireHost(c,hostCode);const target=this.requirePlayer(c,targetCode);if(target.player_code===hostCode)throw new Error('Host cannot kick themselves');if(g.phase!=='lobby')throw new Error('Kick is only allowed in the lobby');this.db.prepare('DELETE FROM hr_players WHERE game_code=? AND player_code=?').run(c,targetCode);return this.state(c,hostCode);}
  ready(c,p,value){this.requirePlayer(c,p);this.db.prepare('UPDATE hr_players SET ready=? WHERE game_code=? AND player_code=?').run(value===undefined?1:+!!value,c,p);return this.state(c,p);}
  /**
   * @param {object} [params]
   * @param {number} [params.maxDrift]
   * @param {number} [params.dayMs]
   * @param {number} [params.nightMs]
   * @param {{source:'preset'|'custom',presetId?:string,roster?:string[],confirmedWarnings?:string[]}} [params.composition]
   */
  start(c,p,params={}){const{maxDrift,dayMs,nightMs,composition}=params;
    const g=this.requireHost(c,p),players=this.players(c);
    if(g.phase!=='lobby')throw new Error('Already started');
    if(players.length<5||players.length>12)throw new Error('Games require 5–12 players');
    if(players.some(x=>x.player_code!==p&&!x.ready))throw new Error('All players must be ready');

    /** @type {string[]} */
    let ids;
    /** @type {'preset'|'custom'} */
    let compositionSource;
    if(!composition){
      ids=this.presetFor(players.length);
      compositionSource='preset';
    }else if(composition.source==='preset'){
      const presetCount=parseInt(String(composition.presetId).replace('p',''))||players.length;
      ids=this.presetFor(presetCount);
      compositionSource='preset';
    }else if(composition.source==='custom'){
      ids=[...composition.roster];
      compositionSource='custom';
    }else{
      throw new Error('Invalid composition source');
    }

    const validation=validateComposition({
      roster:ids,
      playerCount:players.length,
      confirmedWarnings:composition?.confirmedWarnings||[],
      validRoles:this.config.roles,
      hardRules:this.config.hardRules,
      source:compositionSource
    });
    if(!validation.ok)return{ok:false,phase:'lobby',composition:{submitted:ids,source:compositionSource},errors:validation.errors,warnings:validation.warnings};

    const assigned=shuffle(ids);
    // Async mode: day/night are locked at 12h regardless of what's passed
    // in (defense in depth, same as configure()). Day 1's deadline is the
    // next occurrence of Night's start (day-start + 12h) rather than a
    // flat 12h from "now" — so Day 1 can run anywhere from a few minutes
    // up to just under 24h depending on when the host actually clicks
    // start relative to that wall-clock time, but every phase after it
    // lands exactly on the host's chosen schedule, forever (see
    // nextScheduleBoundary above).
    const resolvedDayMs=g.mode==='async'?ASYNC_PHASE_MS:Math.max(PHASE_MS_FLOOR_START,Math.min(PHASE_MS_CEILING,Number(dayMs)||DAY_MS_SYNC_DEFAULT));
    const resolvedNightMs=g.mode==='async'?ASYNC_PHASE_MS:Math.max(PHASE_MS_FLOOR_START,Math.min(PHASE_MS_CEILING,Number(nightMs)||NIGHT_MS_SYNC_DEFAULT));
    const startDeadline=g.mode==='async'?nextScheduleBoundary(this.now(),g.day_start_minute_utc??DEFAULT_DAY_START_MINUTE_UTC):this.now()+resolvedDayMs;
    // Anonymized mode: assign one unique codename per seat (human or bot
    // alike, which also hides which players are bots) for the game's
    // duration. Real names are never touched — displayName() just prefers
    // this column once g.anonymized is set.
    const codenames=g.anonymized?shuffle(NOTABLE_NAMES).slice(0,players.length):null;
    // Fresh roster permutation for this game (see display_order above).
    // Uses this.random rather than the shuffle() util so a seeded manager
    // produces a deterministic order in tests.
    const displayOrder=players.map((_,i)=>i);
    for(let i=displayOrder.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[displayOrder[i],displayOrder[j]]=[displayOrder[j],displayOrder[i]];}
    this.db.transaction(()=>{
      players.forEach((x,i)=>{const r=this.role(assigned[i]);if(codenames)this.db.prepare('UPDATE hr_players SET role_id=?,faction=?,drift=0,alive=1,cripple_tier=0,confessed=0,codename=?,display_order=? WHERE game_code=? AND player_code=?').run(r.id,r.faction,codenames[i],displayOrder[i],c,x.player_code);else this.db.prepare('UPDATE hr_players SET role_id=?,faction=?,drift=0,alive=1,cripple_tier=0,confessed=0,display_order=? WHERE game_code=? AND player_code=?').run(r.id,r.faction,displayOrder[i],c,x.player_code);});
      this.db.prepare("UPDATE hr_games SET phase='day',day_stage='vote',status='active',round=1,max_drift=?,day_ms=?,night_ms=?,deadline=?,updated_at=? WHERE code=?").run(Math.max(1,Math.min(MAX_DRIFT_CEILING,Number(maxDrift)||g.max_drift)),resolvedDayMs,resolvedNightMs,startDeadline,this.now(),c);
      // Wipe lobby chatter so the live game starts with a clean transcript.
      this.db.prepare("DELETE FROM hr_messages WHERE game_code=?").run(c);
      this.system(c,'Roles sealed. Day 1 begins — review your dossier and discuss.');
    })();
    players.forEach((x,i)=>{const r=this.role(assigned[i]);this.privateSystem(c,x.player_code,`Your role is ${r.displayName}. ${r.objective}`);this.emitAnnouncement(c,{type:'role-reveal',title:'YOUR DOSSIER',message:`You are a ${r.displayName}. ${r.objective}`,role:r.displayName,objective:r.objective,faction:r.faction,round:1,phase:'day',targetCode:x.player_code});});
    return this.state(c,p);
  }
  configure(c,p,options={}){const g=this.requireGame(c);if(g.phase!=='lobby')throw new Error('Game has already started');this.requireHost(c,p);
    // Async mode: day/night are locked at 12h — any client-supplied
    // dayMs/nightMs is ignored (defense in depth; the lobby UI doesn't even
    // offer those fields for async). Host instead tunes day_start_minute_utc.
    const isAsync=g.mode==='async';
    const dayMs=isAsync?ASYNC_PHASE_MS:Math.max(PHASE_MS_FLOOR_CONFIGURE,Math.min(PHASE_MS_CEILING,Number(options.dayMs)||g.day_ms));
    const nightMs=isAsync?ASYNC_PHASE_MS:Math.max(PHASE_MS_FLOOR_CONFIGURE,Math.min(PHASE_MS_CEILING,Number(options.nightMs)||g.night_ms));
    const maxDrift=Math.max(1,Math.min(MAX_DRIFT_CEILING,Number(options.maxDrift)||g.max_drift)),anonymized=options.anonymized!==undefined?(options.anonymized?1:0):g.anonymized;
    const warpTaintVisible=options.warpTaintVisible!==undefined?(options.warpTaintVisible?1:0):g.warp_taint_visible;
    const rawDayStart=Number(options.dayStartMinuteUtc);
    const dayStartMinuteUtc=isAsync?(Number.isFinite(rawDayStart)?Math.max(0,Math.min(1439,Math.round(rawDayStart))):(g.day_start_minute_utc??DEFAULT_DAY_START_MINUTE_UTC)):g.day_start_minute_utc;
    this.db.prepare('UPDATE hr_games SET day_ms=?,night_ms=?,max_drift=?,anonymized=?,warp_taint_visible=?,day_start_minute_utc=?,updated_at=? WHERE code=?').run(dayMs,nightMs,maxDrift,anonymized,warpTaintVisible,dayStartMinuteUtc,this.now(),c);return this.state(c,p);}
  advance(c,p){this.requireHost(c,p);return this.resolve(c,true);}
  resolve(c,force=false){const g=this.requireGame(c);if(g.status!=='active')throw new Error('Game is not active');if(!force&&g.deadline&&g.deadline>this.now())throw new Error('Phase is active');if(g.phase==='night')this.resolveNight(g);else if(g.phase==='day')this.resolveDay(g);return this.game(c);}
  setPhase(c,phase,round,dayStage=null){const g=this.game(c),duration=phase==='night'?g.night_ms:g.day_ms,deadline=this.now()+duration,stage=phase==='day'?(dayStage||'vote'):dayStage;this.db.prepare('UPDATE hr_games SET phase=?,round=?,day_stage=?,deadline=?,updated_at=? WHERE code=?').run(phase,round,stage,deadline,this.now(),c);if(phase==='night')this.db.prepare('UPDATE hr_players SET confession_token_round=NULL WHERE game_code=?').run(c);if(phase==='day'){this.db.prepare('UPDATE hr_players SET cripple_tier=0,tier1_until_round=NULL WHERE game_code=? AND cripple_tier=1 AND tier1_until_round<?').run(c,round);const votingEnabled=round!==1;this.system(c,votingEnabled?`Day ${round}: vote for a target or stand down.`:`Day ${round} begins — no vote today. Introduce yourself and observe.`);}
  // Bot prompts: nudge bot sockets to act. Night → night_action_prompt; voting-enabled day → day_vote_prompt. Day 1 has no vote (Q28) → no prompt.
  const aliveBots=this.players(c).filter(p=>p.alive&&p.is_bot);
  if(phase==='night')for(const p of aliveBots)this.emitBotPrompt(c,{kind:'night_action_prompt',playerCode:p.player_code,round,deadline});
  else if(phase==='day'&&round!==1)for(const p of aliveBots){const targets=this.players(c).filter(x=>x.alive&&x.player_code!==p.player_code).map(x=>x.player_code);this.emitBotPrompt(c,{kind:'day_vote_prompt',playerCode:p.player_code,round,votingEnabled:true,deadline,legalTargets:targets});}}
  resolveNight(g){const c=g.code,players=this.players(c).filter(p=>p.alive),actions=this.actions(c,g.round),traps=new Map(actions.filter(a=>a.kind==='boobytrap').map(a=>[a.target_code,a]));const protectedIds=new Set(),bodyguards=new Map();
    for(const p of players){const a=actions.find(x=>x.actor_code===p.player_code),role=this.role(p.role_id);if(p.skip_next_night){this.db.prepare('UPDATE hr_players SET skip_next_night=0 WHERE game_code=? AND player_code=?').run(c,p.player_code);continue;}if(!a){this.changeDrift(c,p.player_code,this.config.drift.NIGHTLY_SLEEP_RECOVERY,'sleep');continue;}if(a.kind==='kill'||a.kind==='blood-ritual'||a.kind==='possess')continue;this.changeDrift(c,p.player_code,role.driftWeight,'night-action');}
    for(const a of actions.filter(x=>x.kind==='protect'))if(!this.trapBlocks(c,g,a,traps))protectedIds.add(a.target_code);
    for(const a of actions.filter(x=>x.kind==='bodyguard'))if(!this.trapBlocks(c,g,a,traps))bodyguards.set(a.target_code,a.actor_code);
    for(const a of actions.filter(x=>['sermon','corrupt-sermon'].includes(x.kind))){if(this.trapBlocks(c,g,a,traps))continue;const s=this.config.drift.sermons[a.variant];this.changeDrift(c,a.actor_code,s.self,'sermon-self');this.changeDrift(c,a.target_code,s.target,'sermon-target');this.incrementUsage(c,a.actor_code,a.variant);}
    const autoKills=[];for(const a of actions.filter(x=>['investigate','drift-hint'].includes(x.kind))){if(this.trapBlocks(c,g,a,traps))continue;const result=this.resolveIntel(c,a,g);if(result?.autoKill)autoKills.push(result);}for(const k of autoKills){const victim=this.player(c,k.targetCode);if(!victim?.alive)continue;this.db.prepare('UPDATE hr_players SET alive=0 WHERE game_code=? AND player_code=?').run(c,k.targetCode);const victimName=this.displayName(g,victim);this.system(c,`${victimName} was executed by Interrogator. Confirmed warp-touched.`);this.system(c,`${victimName}'s alignment: ${victim.faction}.`);if(k.actorCode)this.privateSystem(c,k.actorCode,`Your scan executed ${victimName}. Warp-touched confirmed.`,{intelKind:'execute_on_sight',action:'interrogate',target:k.targetCode,zone:k.zone,faction:k.faction});this.emitAnnouncement(c,{type:'execution',title:'SUMMARY EXECUTION',message:`${victimName} was executed by order of the Interrogator.`,victim:{name:victimName,faction:victim.faction},round:g.round,phase:'night'});for(const w of players)this.changeDrift(c,w.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}
    for(const a of actions.filter(x=>x.kind==='heretical-catalyst')){const target=this.player(c,a.target_code);if(traps.has(a.target_code))this.changeDrift(c,a.actor_code,this.config.drift.TRAP_DRIFT,'trap');if(target?.drift>=g.max_drift&&!protectedIds.has(a.target_code)){this.db.prepare("UPDATE hr_players SET faction='heretic' WHERE game_code=? AND player_code=?").run(c,a.target_code);this.privateSystem(c,a.target_code,'The catalyst takes hold. Your loyalty has burned away.');}}
    // H1 Murderer drift-gated kill (heretic-kit.md v1.5.0): self-drift cost is
    // charged HERE (not in the generic per-player loop above) so the gate can
    // be checked against the pre-kill drift value. Only the Murderer is
    // gated — any other kill-capable role (e.g. Sanctioned Psyker) keeps its
    // prior unconditional-charge behavior, just relocated into this loop.
    for(const kill of actions.filter(x=>x.kind==='kill')){const killer=this.player(c,kill.actor_code);if(!killer?.alive)continue;const killRole=this.role(killer.role_id),killCost=killRole.driftWeight;
      if(killer.role_id==='murderer'&&killer.drift+killCost>g.max_drift){const zone=driftZone(this.config.drift,killer.drift).id;this.changeDrift(c,kill.target_code,this.config.drift.MURDERER_GATE_TARGET_DRIFT,'murderer-gate-witnessed');this.privateSystem(c,kill.actor_code,murdererGateCue(zone),{intelKind:'murderer_kill_gated',zone});this.event(c,'night-action',{round:g.round,kind:'murderer:kill-gated',actor:kill.actor_code,target:kill.target_code});continue;}
      this.changeDrift(c,kill.actor_code,killCost,'night-action');
      if(traps.has(kill.actor_code)){this.changeDrift(c,kill.actor_code,this.config.drift.TRAP_DRIFT,'trap');continue;}if(traps.has(kill.target_code))this.changeDrift(c,kill.actor_code,this.config.drift.TRAP_DRIFT,'trap');let victim=kill.target_code,bodyguardRedirected=false;if(bodyguards.has(victim)){const guardCode=bodyguards.get(victim);this.privateSystem(c,guardCode,'You absorbed a strike meant for your proxy and died.');victim=guardCode;bodyguardRedirected=true;}if(!bodyguardRedirected&&protectedIds.has(kill.target_code))victim=null;if(victim){this.db.prepare('UPDATE hr_players SET alive=0 WHERE game_code=? AND player_code=?').run(c,victim);const victimName=this.displayName(g,this.player(c,victim)),killerName=this.displayName(g,killer);
        // Arbitrator (roles/arbitrator.md): "both learn the proxy fired" means
        // the guard (already privately told above) and the protected target —
        // NOT the whole table. The public side sees an ordinary death, exactly
        // like any other kill, with no tell that a redirect happened.
        if(bodyguards.has(kill.target_code))this.privateSystem(c,kill.target_code,'Something struck at you in the dark. Someone else took the blow meant for you.');
        const slainBody=this.flavor('slain',{victim:victimName});this.system(c,slainBody,{eventType:'night-kill'});this.emitAnnouncement(c,{type:'kill',title:'SLAIN IN THE NIGHT',message:slainBody,victim:{name:victimName},perpetrator:{name:killerName},round:g.round,phase:'night'});
      for(const witness of this.players(c).filter(x=>x.alive))this.changeDrift(c,witness.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}if(killRole.killLimit==='1_per_game')this.incrementUsage(c,kill.actor_code,'kill');}
    // Blood Ritual (blood-ritual.md v1.0.0): faction-wide attack,
    // one per night (enforced at submission in submitFactionAction), two-step
    // escalation mirroring day-phase torture->lynch. Escalation is keyed
    // off whether an SV attack targeted the SAME player on round-1 AND that
    // round's outcome was 'cripple' (not 'kill') — a kill-stage attack (landed
    // or blocked) always consumes the streak, exactly like day-phase's lynch
    // stage never chains into a second lynch. Reuses protectedIds/bodyguards
    // built above for the same Chirurgeon/Arbitrator interrupts as a kill;
    // Saboteur trap gets the same target-trap-only handling as a kill (no
    // actor-trap case — a trapped Heretic simply can't submit any action).
    for(const sv of actions.filter(x=>x.kind==='blood-ritual')){const attacker=this.player(c,sv.actor_code);if(!attacker?.alive)continue;this.changeDrift(c,sv.actor_code,this.config.drift.BLOOD_RITUAL_ATTACKER_COST,'night-action');if(traps.has(sv.target_code))this.changeDrift(c,sv.actor_code,this.config.drift.TRAP_DRIFT,'trap');
      const previous=this.previousBloodRitual(c,g.round),escalate=previous?.outcome==='cripple'&&previous.target===sv.target_code&&this.player(c,sv.target_code)?.alive;
      let victim=sv.target_code,bodyguardRedirected=false;if(bodyguards.has(victim)){const guardCode=bodyguards.get(victim);this.privateSystem(c,guardCode,escalate?'You absorbed a killing blow meant for your proxy and died.':'You absorbed a strike meant for your proxy and were crippled instead.');victim=guardCode;bodyguardRedirected=true;}if(!bodyguardRedirected&&protectedIds.has(sv.target_code))victim=null;
      if(escalate){if(victim){this.db.prepare('UPDATE hr_players SET cripple_tier=3,alive=0 WHERE game_code=? AND player_code=?').run(c,victim);const victimName=this.displayName(g,this.player(c,victim));const slainBody=this.flavor('slain',{victim:victimName});this.system(c,slainBody,{eventType:'night-kill'});this.emitAnnouncement(c,{type:'kill',title:'SLAIN IN THE NIGHT',message:slainBody,victim:{name:victimName},round:g.round,phase:'night'});for(const witness of this.players(c).filter(x=>x.alive))this.changeDrift(c,witness.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}this.event(c,'blood-ritual',{round:g.round,attacker:sv.actor_code,target:sv.target_code,outcome:'kill',landed:!!victim});}
      // tier1_until_round is g.round+1, not g.round: setPhase's T1-recovery
      // check (`cripple_tier=1 AND tier1_until_round<round`) fires on the
      // night->day transition that happens moments later in THIS SAME
      // resolveNight() call. Day-phase torture sets tier1_until_round
      // while still in the day, so it survives the coming night before that
      // check ever runs against it; a night-phase cripple needs the +1 or it
      // recovers in the same breath it was applied.
      else{if(victim){const tier=Math.min(3,(Number(this.player(c,victim).cripple_tier)||0)+1);this.db.prepare('UPDATE hr_players SET cripple_tier=?,tier1_until_round=? WHERE game_code=? AND player_code=?').run(tier,tier===1?g.round+1:null,c,victim);const victimName=this.displayName(g,this.player(c,victim));const crippleBody=this.flavor('bloodRitualCripple',{victim:victimName});this.system(c,crippleBody);this.emitAnnouncement(c,{type:'blood-ritual-cripple',title:'BROKEN IN THE NIGHT',message:crippleBody,victim:{name:victimName},round:g.round,phase:'night'});}this.event(c,'blood-ritual',{round:g.round,attacker:sv.actor_code,target:sv.target_code,outcome:'cripple',landed:!!victim});}}
    // H6 Animus (roles/animus.md): resolved LAST, after every other night
    // pass, so the target's drift reflects everything that happened this
    // same night (kills, sermons, Blood Ritual, catalyst) — spec: "confirmed
    // Red at night-end". Consumed on use regardless of outcome (self-drift
    // was already charged at submission — see submitAction). An
    // actor-trapped Animus has their attempt fully sabotaged (mirrors kill's
    // actor-trap cancellation); a target-trapped Animus pays +5 extra but
    // still resolves normally, matching the spec's counterplay table.
    // Chirurgeon protect on the target blocks the possession itself (not
    // just kill/cripple) — reuses protectedIds built above. The failure
    // looks identical to a wrong-zone guess (same message, no tell), so a
    // protected Red-zone target is indistinguishable from a bad read —
    // consistent with the Animus never learning why an attempt failed.
    for(const pos of actions.filter(x=>x.kind==='possess')){const actorPlayer=this.player(c,pos.actor_code);if(!actorPlayer?.alive)continue;this.incrementUsage(c,pos.actor_code,'possess');if(traps.has(pos.actor_code)){this.changeDrift(c,pos.actor_code,this.config.drift.TRAP_DRIFT,'trap');continue;}const target=this.player(c,pos.target_code);if(!target?.alive)continue;if(traps.has(pos.target_code))this.changeDrift(c,pos.actor_code,this.config.drift.TRAP_DRIFT,'trap');const zone=driftZone(this.config.drift,target.drift).id;if(zone==='red'&&!protectedIds.has(pos.target_code)){this.db.prepare('UPDATE hr_players SET possessed_by=?,skip_next_night=1 WHERE game_code=? AND player_code=?').run(pos.actor_code,c,pos.target_code);this.privateSystem(c,pos.actor_code,`The summoning takes hold. The Neverborn reaches across the Warp and finds purchase in ${this.displayName(g,target)}. Speak as them tomorrow.`,{intelKind:'animus_possess',outcome:'success',target:pos.target_code});this.privateSystem(c,pos.target_code,'Something cold moves behind your eyes. You cannot speak tomorrow.');}else{this.privateSystem(c,pos.actor_code,'You reach for the Warp. The Neverborn finds no purchase. The ritual wastes.',{intelKind:'animus_possess',outcome:'fail'});}}
    if(!this.finishIfWon(c)){this.setPhase(c,'day',g.round+1,'vote');}}
  trapBlocks(c,g,a,traps){if(!traps.has(a.target_code))return false;this.changeDrift(c,a.actor_code,this.config.drift.TRAP_DRIFT,'trap');const trap=traps.get(a.target_code);this.privateSystem(c,trap.actor_code,`Your trap caught ${this.displayName(g,this.player(c,a.actor_code))} targeting ${this.displayName(g,this.player(c,a.target_code))}.`);return !['kill','heretical-catalyst'].includes(a.kind);}
  resolveIntel(c,a,g){const actor=this.player(c,a.actor_code),target=this.player(c,a.target_code),role=this.role(actor.role_id);if(a.kind==='drift-hint'){const targetZone=driftZone(this.config.drift,target.drift);const rate=intelNoiseRate(this.config.drift,target.drift,role.driftWeight);const truth=targetZone.id;const zones=this.config.drift.zones;const truthIdx=zones.findIndex(z=>z.id===truth);let shown=truth;if(this.random()<rate){const left=truthIdx>0?truthIdx-1:truthIdx+1;const right=truthIdx<zones.length-1?truthIdx+1:truthIdx-1;const adj=this.random()<0.5?left:right;shown=zones[adj].id;}this.privateSystem(c,a.actor_code,this.hints(c)[shown],{intelKind:'drift-hint',action:'scan_drift',target:a.target_code,zone:shown});return{};}const intensity=Number(String(a.variant||'T1').replace('T',''))||1;const targetZone=driftZone(this.config.drift,target.drift);if(isExecuteOnSight(intensity,targetZone.id))return{autoKill:true,actorCode:a.actor_code,targetCode:a.target_code,zone:targetZone.id,faction:target.faction};if(intensity===1){const groundTruth=targetZone.id==='green'?'Clean':'Tainted';const isTrue=this.random()<0.7;const display=isTrue?groundTruth:(groundTruth==='Clean'?'Tainted':'Clean');
      // Tiered Lynch v1.3.0: T1 can also clear or reinforce a day-vote
      // torture mark (tortured_before), keyed off the TARGET'S
      // TRUE zone — "the Interrogator's read is treated as definitive" for
      // this purpose, unlike the noisy Clean/Tainted display above (which
      // still has its own 30% flip chance). Green absolves an existing
      // mark outright; Yellow/Orange leave it untouched (too noisy for a
      // binding call); Red sets/reinforces the mark regardless of its
      // prior state — a single Red-reading scan can set someone up for a
      // kill on their very next day-vote torture, "weaponizing" the
      // scan on its own. Black is moot, left untouched.
      let markNote='';
      if(targetZone.id==='green'&&target.tortured_before){this.db.prepare('UPDATE hr_players SET tortured_before=0 WHERE game_code=? AND player_code=?').run(c,a.target_code);markNote=' Your read is clean enough to absolve them — their torture mark is lifted.';}
      else if(targetZone.id==='red'){if(!target.tortured_before)this.db.prepare('UPDATE hr_players SET tortured_before=1 WHERE game_code=? AND player_code=?').run(c,a.target_code);markNote=' Your read comes back guilty — their next torture will be an execution.';}
      this.privateSystem(c,a.actor_code,`${this.displayName(g,target)} is ${display.toLowerCase()}.${markNote}`,{intelKind:'interrogate',tier:1,target:a.target_code,zone:targetZone.id,result:display.toLowerCase()});return{};}const effectiveTier=getEffectiveScanTier(intensity,targetZone.id);const rate=intelNoiseRate(this.config.drift,actor.drift,role.driftWeight);if(effectiveTier>=3){const text=target.faction==='loyalist'?'Confirmed: they are a Loyalist. The Emperor\'s light is unbroken in them.':'Confirmed: they are a Heretic. The warp taint is undeniable.';this.privateSystem(c,a.actor_code,text,{intelKind:'interrogate',tier:intensity,effectiveTier,target:a.target_code,zone:targetZone.id,faction:target.faction});return{};}const truth=target.faction==='loyalist';const result=noisyResult(truth,rate,this.random);let text=result==='unclear'?'You learned nothing.':result?'Their story holds together.':'Something does not add up.';if(effectiveTier>=2)text+=` You sense their drift zone: ${targetZone.id}.`;this.privateSystem(c,a.actor_code,text,{intelKind:'interrogate',tier:intensity,effectiveTier,target:a.target_code,zone:effectiveTier>=2?targetZone.id:null,factionHint:result==='unclear'?null:(result?'loyalist':'heretic')});return{};}
  resolveDay(g){if(g.day_stage==='response')throw new Error('Awaiting torture response or direct ask');const votingEnabled=g.round!==1;if(!votingEnabled){const payload={round:g.round,outcome:'skip',target:null,reason:'day1-no-vote',voterResults:[],witnessedDrift:0,alignmentRevealed:null,crippleTier:null};this.event(g.code,'day-resolution',payload);this.system(g.code,`Day ${g.round} concludes with no vote. The conclave disperses.`);this.applyHereticCap(g.code,g.round);this.resolvePossessionDetonation(g.code);if(!this.finishIfWon(g.code))this.setPhase(g.code,'night',g.round);return payload;}const payload=this.resolveDayVote(g);this.resolvePossessionDetonation(g.code);return payload;}
  // H6 Animus: fires unconditionally after the day's vote tally is announced
  // (E4), regardless of that day's outcome (torture/lynch/skip/tie) —
  // possession runs on its own one-day clock, not tied to whether this
  // day's vote landed on the possessed player. Uses possession_revealed
  // (not alive) to find the pending reveal so E1 (possessed player was
  // ALSO this day's lynch target — applyLynch already set alive=0 and ran
  // its own faction-only reveal, before this runs) still fires the fuller
  // Neverborn reveal on the same, already-dead body. Runs at most once ever
  // per game — Animus is one-shot, so there is never a second possession to
  // find on a later day. Chirurgeon protect / Arbitrator bodyguard never
  // enter into this at all: this path never consults protectedIds/bodyguards
  // (those are night-resolution-local), so there is nothing for them to
  // block — the detonation is a Warp-claim, not a kill-by-role.
  resolvePossessionDetonation(c){const g=this.game(c),target=this.players(c).find(p=>p.possessed_by&&!p.possession_revealed);if(!target)return;const animusCode=target.possessed_by;this.db.prepare('UPDATE hr_players SET alive=0,drift=0,possession_revealed=1 WHERE game_code=? AND player_code=?').run(c,target.player_code);const roleName=target.role_id?this.role(target.role_id).displayName:'Unknown';const targetName=this.displayName(g,target);const revealBody=`${targetName}'s body ruptures. Smoke and warp-light spill from the torn armor. A Neverborn finds its mark. The heretic is exposed.`;this.system(c,revealBody);this.system(c,`${targetName} was ${roleName} (${target.faction}).`);this.emitAnnouncement(c,{type:'neverborn-reveal',title:'THE BODY RUPTURES',message:revealBody,victim:{name:targetName,role:roleName,faction:target.faction,drift:target.drift},round:g.round,phase:'day'});for(const p of this.players(c).filter(x=>x.alive&&x.player_code!==animusCode))this.changeDrift(c,p.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}
  /** @returns {VoteRow[]} */
  dayVotes(c,r){return /** @type {VoteRow[]} */ (this.db.prepare("SELECT * FROM hr_votes WHERE game_code=? AND round=? AND stage='target'").all(c,r));}
  resolveDayVote(g){
    // H6 Animus: a possessed player can no longer submit their own vote at
    // all (vote() rejects them below, mirroring authorizeChannel's chat
    // block) — the only way a vote lands for that seat is via voteAs(), the
    // Animus acting through them. So nothing here needs to filter possessed
    // voters out; whatever's in hr_votes for a round is exactly what should
    // count.
    const c=g.code,living=this.players(c).filter(p=>p.alive),votes=this.dayVotes(c,g.round),skipCount=votes.filter(v=>v.choice==='skip').length,totalAlive=living.length;
    if(skipCount>totalAlive/2){this.system(c,`Vote tally — Stand down carried: ${skipCount} of ${totalAlive} voted to stand down. The conclave dispersed.`);return this.skipDay(g,'skip-majority');}
    const counts=new Map();for(const v of votes){if(v.choice==='skip')continue;const target=this.player(c,v.choice);if(target?.alive)counts.set(v.choice,(counts.get(v.choice)||0)+1);}
    if(counts.size===0){this.system(c,'Vote tally — No votes were cast for any candidate. The conclave dispersed.');return this.skipDay(g,'no-votes');}
    const top=Math.max(...counts.values());
    let leaderCodes=[...counts].filter(([,count])=>count===top).map(([code])=>code);
    if(leaderCodes.length>1){const maxDrift=Math.max(...leaderCodes.map(code=>this.player(c,code)?.drift??-1));leaderCodes=leaderCodes.filter(code=>(this.player(c,code)?.drift??-1)===maxDrift);if(leaderCodes.length!==1){const leaderNames=leaderCodes.map(code=>{const pl=this.player(c,code);return pl?this.displayName(g,pl):null;}).filter(Boolean);this.system(c,`Vote tally — Tied between ${leaderNames.join(', ')} at ${top} votes; drift could not break it. The conclave dispersed.`);return this.skipDay(g,'tied-drift');}}
    // Tiered Lynch (tiered-lynch.md v1.2.0): outcome is decided same-day by
    // what fraction of LIVING votes the leader cleared — >=60% executes
    // outright. v1.2.0's second kill path: if this suspect has EVER been
    // tortured before (tortured_before, set in applyTorture
    // below), today's torture escalates to a kill — no cabal defense,
    // the mark is not cleared by an intervening skip day or a different
    // target being tortured in between (superseded the old v1.1.0
    // "consecutive days only" rule, which used previousDayResolution and
    // reset on any gap).
    const targetCode=leaderCodes[0],targetPlayerForTally=this.player(c,targetCode),targetName=targetPlayerForTally?this.displayName(g,targetPlayerForTally):'someone',targetVotes=votes.filter(v=>v.choice===targetCode),voterNames=targetVotes.map(v=>{const voter=this.player(c,v.voter_code);return voter?this.displayName(g,voter):'?';}).filter(Boolean),threshold=Math.ceil(totalAlive*0.6),markedForEscalation=!!this.player(c,targetCode)?.tortured_before,outcome=(top>=threshold||markedForEscalation)?'lynch':'torture';
    this.system(c,`Vote tally — ${targetName} received ${targetVotes.length} vote(s). Voters: ${voterNames.join(', ')}.`);
    return outcome==='lynch'?this.applyLynch(g,targetCode):this.applyTorture(g,targetCode);
  }
  previousDayResolution(c,round){const row=/** @type {{payload:string}|undefined} */ (this.db.prepare("SELECT payload FROM hr_events WHERE game_code=? AND type='day-resolution' ORDER BY id DESC LIMIT 1").get(c));if(!row)return null;try{const payload=JSON.parse(row.payload);return payload.round===round-1?payload:null;}catch{return null;}}
  previousBloodRitual(c,round){const row=/** @type {{payload:string}|undefined} */ (this.db.prepare("SELECT payload FROM hr_events WHERE game_code=? AND type='blood-ritual' ORDER BY id DESC LIMIT 1").get(c));if(!row)return null;try{const payload=JSON.parse(row.payload);return payload.round===round-1?payload:null;}catch{return null;}}
  skipDay(g,reason='skip'){const c=g.code,payload={round:g.round,outcome:'skip',target:null,reason,voterResults:this.dayVotes(c,g.round).map(v=>({voter:v.voter_code,votedFor:v.choice,driftDelta:0})),witnessedDrift:0,alignmentRevealed:null,crippleTier:null};this.event(c,'day-resolution',payload);this.system(c,'The conclave stands down. No sentence is passed.');this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return payload;}
  // Tiered Lynch E5 (locked): a target already at T3 is STILL tortured
  // — they just lose a night action again; the cripple-tier benefit is
  // saturated (Math.min caps it at 3) but the probe itself never blocks.
  // No drift event fires from torture alone (tiered-lynch.md: "No
  // drift event from torture alone, beyond the player's cripple
  // tier") — this supersedes the old wrong/right-torture drift rows
  // in day-phase.md's drift table; the probe's only cost is the cripple
  // tier plus the lost night action, never drift.
  // (Renamed from applyInterrogation — "interrogation" was overloaded
  // between this day-vote outcome and the L2 Interrogator role's own
  // night-side scan, which is unaffected and unchanged.)
  applyTorture(g,targetCode){const c=g.code,target=this.player(c,targetCode);if(!target?.alive){this.system(c,'Vote tally — The leading candidate was already dead; the conclave dispersed without judgement.');return this.skipDay(g,'invalid-target');}
    // T1's own auto-recovery (setPhase's day-entry check, interrogation.md
    // "T1 recovers after 1 round of no re-torture") fires unconditionally
    // at the START of today, before this vote is known — so a player who was
    // T1 yesterday and is being re-tortured again TODAY already had their
    // live cripple_tier zeroed by the time we get here. Reading the live
    // column would silently reset the escalation (1->1 instead of 1->2) every
    // single time, defeating repeatable torture's whole point. If this
    // exact player was ALSO tortured on the immediately preceding day,
    // escalate from THEIR tier as of that prior torture instead of the
    // (possibly just-reset) live value. Any player at T2/T3 is unaffected —
    // that recovery only ever targets cripple_tier===1.
    const previous=this.previousDayResolution(c,g.round),baseTier=(previous?.outcome==='torture'&&previous.target===targetCode)?previous.crippleTier:(Number(target.cripple_tier)||0),tier=Math.min(3,baseTier+1),voters=this.dayVotes(c,g.round).filter(v=>v.choice===targetCode);this.db.prepare('UPDATE hr_games SET last_tortured_target=?,last_torture_tier=?,day_stage=?,deadline=NULL,updated_at=? WHERE code=?').run(targetCode,tier,null,this.now(),c);this.db.prepare('UPDATE hr_players SET cripple_tier=?,tier1_until_round=?,skip_next_night=1,tortured_before=1 WHERE game_code=? AND player_code=?').run(tier,tier===1?g.round:null,c,targetCode);const voterResults=voters.map(v=>({voter:v.voter_code,votedFor:v.choice,driftDelta:0}));const payload={round:g.round,outcome:'torture',target:targetCode,voterResults,witnessedDrift:0,alignmentRevealed:null,crippleTier:tier};this.event(c,'day-resolution',payload);const targetDisplay=this.displayName(g,target);const tortureBody=this.flavor('tortureChamber',{victim:targetDisplay,tier,severity:crippleSeverityLabel(tier)});this.system(c,tortureBody);this.emitAnnouncement(c,{type:'torture-chamber',title:'TORTURE CHAMBER',message:tortureBody,victim:{name:targetDisplay},round:g.round,phase:'day'});this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return payload;}
  applyLynch(g,targetCode){const c=g.code,target=this.player(c,targetCode),votes=this.dayVotes(c,g.round).filter(v=>v.choice===targetCode),voterResults=votes.map(v=>({voter:v.voter_code,votedFor:v.choice,driftDelta:0})),targetDisplay=this.displayName(g,target);this.db.prepare('UPDATE hr_players SET cripple_tier=3,alive=0 WHERE game_code=? AND player_code=?').run(c,targetCode);this.system(c,`${targetDisplay} was lynched and revealed ${target.faction}.`);this.emitAnnouncement(c,{type:'lynch',title:'SENTENCE EXECUTED',message:`${targetDisplay} was lynched and revealed as ${target.faction}.`,victim:{name:targetDisplay,faction:target.faction},round:g.round,phase:'day'});for(const p of this.players(c).filter(x=>x.alive))this.changeDrift(c,p.player_code,1,'witnessed-violence');if(target.faction==='loyalist')for(const result of voterResults){result.driftDelta=this.config.drift.WRONG_LYNCH;this.changeDrift(c,result.voter,this.config.drift.WRONG_LYNCH,'wrong-lynch');}const payload={round:g.round,outcome:'lynch',target:targetCode,voterResults,witnessedDrift:1,alignmentRevealed:target.faction,crippleTier:3};this.event(c,'day-resolution',payload);this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return payload;}
  respondTorture(c,p,response){const g=this.requireGame(c),target=this.player(c,p);if(g.phase!=='day'||g.day_stage!=='response'||g.last_tortured_target!==p)throw new Error('No response is pending');if(target.cripple_tier>=3)throw new Error('Tier 3 requires a direct ask');if(!['confess','resist','refuse-break'].includes(response))throw new Error('Invalid response');if(response==='confess'){
      // TODO(heresy-spec): Confession token blocks same-day re-torture, expires Day→Night, does not stack, and skips the next night action.
      this.db.prepare('UPDATE hr_players SET confessed=1,confession_token_round=?,skip_next_night=1 WHERE game_code=? AND player_code=?').run(g.round,c,p);const targetDisplay=this.displayName(g,target);this.system(c,`${targetDisplay} confessed: ${this.role(target.role_id).displayName}.`);this.emitAnnouncement(c,{type:'confession',title:'CONFESSION',message:`${targetDisplay} confessed: ${this.role(target.role_id).displayName}.`,victim:{name:targetDisplay},round:g.round,phase:'day'});}else if(response==='resist')this.changeDrift(c,p,1,'resist');else{this.db.prepare('UPDATE hr_players SET cripple_tier=MAX(cripple_tier,2),skip_next_night=1 WHERE game_code=? AND player_code=?').run(c,p);this.changeDrift(c,p,2,'refuse-break');}this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return this.state(c,p);}
  askConfession(c,asker,targetCode){const g=this.requireGame(c);this.requireAlive(c,asker);const target=this.requirePlayer(c,targetCode);if(g.phase!=='day'||g.day_stage!=='response'||targetCode!==g.last_tortured_target||target.cripple_tier<3)throw new Error('This player cannot be asked now');
    // TODO(heresy-spec): Tier 3 confession occurs only on a direct ask and is required for Loyalist victory.
    this.db.prepare('UPDATE hr_players SET confessed=1 WHERE game_code=? AND player_code=?').run(c,targetCode);const targetDisplay=this.displayName(g,target);this.system(c,`${targetDisplay} is forced to confess: ${this.role(target.role_id).displayName}.`);this.emitAnnouncement(c,{type:'confession',title:'FORCED CONFESSION',message:`${targetDisplay} is forced to confess: ${this.role(target.role_id).displayName}.`,victim:{name:targetDisplay},round:g.round,phase:'day'});this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return this.state(c,asker);}
  applyHereticCap(c,day){if(day!==this.config.drift.HERETIC_CAP_DAY)return;for(const p of this.players(c).filter(x=>x.alive&&x.faction==='heretic'&&x.drift<this.config.drift.HERETIC_DRIFT_CAP))this.changeDrift(c,p.player_code,this.config.drift.HERETIC_CAP_SPIKE,'heretic-cap');}
  vote(c,p,choice,justification=''){const g=this.requireGame(c),v=this.requireAlive(c,p),cleanChoice=String(choice||'');if(g.phase!=='day'||g.day_stage==='response'||g.round===1)throw new Error('Voting is closed');
    // H6 Animus: mirrors authorizeChannel's chat block — a possessed player
    // cannot cast their own vote at all (their controller does it for them
    // via voteAs). Client-side this is preempted the same way chat is (the
    // vote UI is disabled while possessed), so this throw is a defensive
    // backstop, not something a normal client ever hits.
    if(v.possessed_by)throw new Error('You are possessed and cannot vote today');
    if(cleanChoice!=='skip')this.requireAlive(c,cleanChoice);if(effectiveCrippleTier(v,g.round)>=2&&!String(justification).trim())throw new Error('Broken players must justify every vote');const votePlayer=cleanChoice==='skip'?null:this.player(c,cleanChoice);const targetName=cleanChoice==='skip'?null:(votePlayer?this.displayName(g,votePlayer):'Unknown');const voterDisplay=this.displayName(g,v);const voteMsg=targetName?`${voterDisplay} accused ${targetName}.`:`${voterDisplay} stood down.`;this.system(c,voteMsg);const message=justification?this.insertMessage(c,'public',null,p,voterDisplay,`Vote justification: ${String(justification).trim().slice(0,300)}`,'vote'):null;this.db.prepare('INSERT INTO hr_votes VALUES(?,?,?,?,?,?) ON CONFLICT(game_code,round,stage,voter_code) DO UPDATE SET choice=excluded.choice,created_at=excluded.created_at').run(c,g.round,'target',v.player_code,cleanChoice,this.now());return{votes:this.voteState(c),message};}
  retractVote(c,p){const g=this.requireGame(c),v=this.player(c,p);this.db.prepare("DELETE FROM hr_votes WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").run(c,g.round,p);if(v?.alive)this.system(c,`${this.displayName(g,v)} retracted their accusation.`);return this.voteState(c);}
  // H6 Animus: the vote-side equivalent of sendMessageAs — the possessed
  // target is derived server-side from the live possessed_by record (never
  // client-supplied), so a bot/client can never spoof "vote as" someone it
  // doesn't actually possess. Writes under the TARGET's own voter_code, so
  // it's indistinguishable from a normal vote to everyone else at the table.
  voteAs(c,p,choice,justification=''){const g=this.requireGame(c);if(g.phase!=='day'||g.day_stage==='response'||g.round===1)throw new Error('Voting is closed');this.requireAlive(c,p);const target=this.players(c).find(x=>x.possessed_by===p&&x.alive);if(!target)throw new Error('You are not possessing anyone right now');const cleanChoice=String(choice||'');if(cleanChoice!=='skip')this.requireAlive(c,cleanChoice);if(effectiveCrippleTier(target,g.round)>=2&&!String(justification).trim())throw new Error('Broken players must justify every vote');const votePlayer=cleanChoice==='skip'?null:this.player(c,cleanChoice);const targetName=cleanChoice==='skip'?null:(votePlayer?this.displayName(g,votePlayer):'Unknown');const puppetDisplay=this.displayName(g,target);const voteMsg=targetName?`${puppetDisplay} accused ${targetName}.`:`${puppetDisplay} stood down.`;this.system(c,voteMsg);const message=justification?this.insertMessage(c,'public',null,p,puppetDisplay,`Vote justification: ${String(justification).trim().slice(0,300)}`,'vote'):null;this.db.prepare('INSERT INTO hr_votes VALUES(?,?,?,?,?,?) ON CONFLICT(game_code,round,stage,voter_code) DO UPDATE SET choice=excluded.choice,created_at=excluded.created_at').run(c,g.round,'target',target.player_code,cleanChoice,this.now());return{votes:this.voteState(c),message};}
  retractVoteAs(c,p){const g=this.requireGame(c);const target=this.players(c).find(x=>x.possessed_by===p&&x.alive);if(!target)throw new Error('You are not possessing anyone right now');this.db.prepare("DELETE FROM hr_votes WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").run(c,g.round,target.player_code);this.system(c,`${this.displayName(g,target)} retracted their accusation.`);return this.voteState(c);}
  voteState(c){const g=this.game(c);if(!g)return[];return /** @type {{stage:string,voterCode:string,choice:string,createdAt:number}[]} */ (this.db.prepare("SELECT stage,voter_code AS voterCode,choice,created_at AS createdAt FROM hr_votes WHERE game_code=? AND round=? AND stage='target'").all(c,g.round));}
  /**
   * @param {object} [params]
   * @param {string} [params.targetCode]
   * @param {string} [params.variant]
   * @param {any} [params.data]
   * @param {string} [params.body]
   * @param {string} [params.asPlayerCode]
   */
  submitAction(c,p,params={}){const{targetCode,variant,data,body,asPlayerCode}=params;const g=this.requireGame(c),actor=this.requireAlive(c,p),role=this.role(actor.role_id),action=g.phase==='night'?role.actions.night:role.actions.day;if(!action||action.kind==='sleep')throw new Error('Your role has no active action now');if(action.kind==='protect'&&effectiveCrippleTier(actor,g.round)>0)return{kind:'protect',targetCode,silent:true};if(action.kind==='bodyguard'&&effectiveCrippleTier(actor,g.round)>0)return{kind:'bodyguard',targetCode,silent:true};if(action.kind==='drift-hint'&&effectiveCrippleTier(actor,g.round)>0)return{kind:'drift-hint',targetCode,silent:true};if(effectiveCrippleTier(actor,g.round)>0)throw new Error('Torture damage blocks this action');if(action.kind==='kill'&&role.killLimit){const killUses=this.usage(c,p,'kill');if(killUses>=1)throw new Error('You can only use your kill once per game');}if(action.kind==='possess'&&role.possessLimit&&this.usage(c,p,'possess')>=1)throw new Error('The Animus is spent — one possession per game');
if(action.kind==='forgery')return this.forge(c,p,asPlayerCode,body);const target=this.requireAlive(c,targetCode);if(action.target==='other'&&!canProtectSelf(role.id)&&targetCode===p)throw new Error('Choose another player');if(action.kind==='protect'&&!validateRotation(this.db,c,p,targetCode,g.round))throw new Error('Cannot protect the same target on consecutive nights');if(action.kind==='bodyguard'&&!validateRotation(this.db,c,p,targetCode,g.round))throw new Error('Cannot proxy the same target on consecutive nights');if(action.target==='hostile'&&!isHostileTo(actor,target))throw new Error('Target is not hostile');if(action.kind==='possess'&&target.possessed_by)throw new Error('That player is already possessed');if(action.variants&&!action.variants.includes(variant))throw new Error('Invalid action variant');if(['sermon','corrupt-sermon'].includes(action.kind)){const s=this.config.drift.sermons[variant],uses=this.usage(c,p,variant);if(s.limit!==null&&uses>=s.limit)throw new Error('Sermon limit reached');
      if(action.kind==='corrupt-sermon'&&variant==='warp-litany'&&target.drift<(s.target_zone_min_drift??10))return{ok:false,silent:true};
    }
    // H6 Animus (roles/animus.md): self-drift is charged at SUBMISSION time,
    // not at night-end resolution like every other night action — the spec
    // is explicit ("cost is paid at submission... target zone is not yet
    // checked"). Only charge once per round: a resubmission that just
    // retargets (still kind==='possess', same actor, same round) must not
    // pay twice, so check for an existing row BEFORE the upsert below.
    if(action.kind==='possess'&&!this.actions(c,g.round).some(a=>a.actor_code===p&&a.kind==='possess'))this.changeDrift(c,p,role.driftWeight,'possess-attempt');
    this.db.prepare('INSERT INTO hr_actions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_code,round,actor_code) DO UPDATE SET kind=excluded.kind,target_code=excluded.target_code,variant=excluded.variant,data=excluded.data,created_at=excluded.created_at').run(c,g.round,p,action.kind,targetCode,variant,data?JSON.stringify(data):null,this.now());if(g.phase==='night'&&actor.faction==='heretic'){const targetDisplayForCabal=this.displayName(g,target);const cabalLabel=action.kind==='kill'?`marked ${targetDisplayForCabal} for death`:action.kind==='boobytrap'?`set a trap on ${targetDisplayForCabal}`:action.kind==='corrupt-sermon'?`targets ${targetDisplayForCabal} with a corrupt sermon`:action.kind==='heretical-catalyst'?`invokes the catalyst on ${targetDisplayForCabal}`:action.kind==='possess'?`stirs the Warp toward ${targetDisplayForCabal}`:`uses ${action.kind}`;this.factionSystem(c,`Cabalite ${this.displayName(g,actor)} ${cabalLabel}.`);}return {kind:action.kind,targetCode,variant};}
  // Blood Ritual (blood-ritual.md v1.0.0): faction-wide, not
  // tied to any one role's actions.night — bypasses submitAction's per-role
  // lookup entirely. Any non-crippled Heretic may take it, including the
  // Murderer — though since both this and a Murderer's own kill write to the
  // same one-action-per-actor-per-round hr_actions slot (ON CONFLICT DO
  // UPDATE), a Murderer taking Blood Ritual on a given night forgoes their
  // own kill that night, and vice versa; they cannot do both. One attack per
  // faction per night overall: the first submission each round locks it in,
  // later submitters are rejected outright (not silently overwritten) so the
  // cabal gets clear feedback rather than a vanished action.
  /**
   * @param {object} [params]
   * @param {string} [params.targetCode]
   */
  submitFactionAction(c,p,params={}){const{targetCode}=params;const g=this.requireGame(c),actor=this.requireAlive(c,p);if(g.phase!=='night')throw new Error('Blood Ritual is night-only');if(actor.faction!=='heretic')throw new Error('Only Heretics may take Blood Ritual');if(effectiveCrippleTier(actor,g.round)>0)throw new Error('Torture damage blocks this action');const target=this.requireAlive(c,targetCode);if(target.faction==='heretic')throw new Error('Target is not hostile');if(targetCode===p)throw new Error('Choose another player');if(this.actions(c,g.round).some(a=>a.kind==='blood-ritual'&&a.actor_code!==p))throw new Error('Blood Ritual has already been claimed tonight');this.db.prepare('INSERT INTO hr_actions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_code,round,actor_code) DO UPDATE SET kind=excluded.kind,target_code=excluded.target_code,variant=excluded.variant,data=excluded.data,created_at=excluded.created_at').run(c,g.round,p,'blood-ritual',targetCode,null,null,this.now());this.factionSystem(c,`Cabalite ${this.displayName(g,actor)} moves against ${this.displayName(g,target)}.`);return {kind:'blood-ritual',targetCode};}
  // TODO(heresy-spec): Saboteur trap frequency is once per night; the action table enforces one submission per actor and round.
  /** @returns {ActionRow[]} */
  actions(c,r){return /** @type {ActionRow[]} */ (this.db.prepare('SELECT * FROM hr_actions WHERE game_code=? AND round=?').all(c,r));}
  retractAction(c,p){const g=this.game(c);this.db.prepare('DELETE FROM hr_actions WHERE game_code=? AND round=? AND actor_code=?').run(c,g.round,p);}
  forge(c,p,asPlayerCode,body){const g=this.game(c),as=this.requireAlive(c,asPlayerCode);this.requireAlive(c,p);if(g.phase!=='day')throw new Error('Forgery is day-only');if(this.usage(c,p,`forgery-${g.round}`))throw new Error('Forgery already used today');
    // TODO(heresy-spec): Q31 — Conspirator default attributes one daily message to another player.
    const message=this.insertMessage(c,'public',null,p,this.displayName(g,as),String(body||'').slice(0,500),'player');this.incrementUsage(c,p,`forgery-${g.round}`);this.changeDrift(c,p,1,'forgery');return {message};}
  usage(c,p,a){return /** @type {{uses:number}|undefined} */ (this.db.prepare('SELECT uses FROM hr_usage WHERE game_code=? AND player_code=? AND ability=?').get(c,p,a))?.uses||0;}
  incrementUsage(c,p,a){this.db.prepare('INSERT INTO hr_usage VALUES(?,?,?,1) ON CONFLICT(game_code,player_code,ability) DO UPDATE SET uses=uses+1').run(c,p,a);}
  hints(c){const g=this.game(c);return this.config.hintProfiles[g.hint_profile]||this.config.hintProfiles.default;}
  changeDrift(c,p,delta,reason){const g=this.game(c),player=this.player(c,p);if(!player)return;const before=player.drift,after=Math.max(0,Math.min(g.max_drift,before+delta));this.db.prepare('UPDATE hr_players SET drift=? WHERE game_code=? AND player_code=?').run(after,c,p);const from=driftZone(this.config.drift,before).id,to=driftZone(this.config.drift,after).id;if(from!==to)this.privateSystem(c,p,this.hints(c)[to],{intelKind:'drift_hint',ownZone:to});this.event(c,'drift',{playerCode:p,delta,before,after,reason,zone:to,round:g.round,phase:g.phase});}
  finishIfWon(c){const players=this.players(c),living=players.filter(x=>x.alive),h=living.filter(x=>x.faction==='heretic').length,l=living.filter(x=>x.faction==='loyalist').length;let winner=h>=l?'heretic':null;if(!winner&&players.filter(x=>x.faction==='heretic').every(x=>!x.alive||(x.cripple_tier>=3&&x.confessed)))winner='loyalist';if(!winner)return false;
    // TODO(heresy-spec): Q32 — Pyrrhic/no-clean-win is explicitly deferred from v1.
    this.db.prepare("UPDATE hr_games SET phase='ended',status='ended',winner=?,deadline=NULL WHERE code=?").run(winner,c);this.system(c,`Game over. ${winner} victory.`);const gEnd=this.game(c);this.emitAnnouncement(c,{type:'gameover',title:'GAME OVER',message:`${winner} victory. The conclave is dissolved.`,winner,round:gEnd.round});saveGameLogSnapshot({gameLogId:c,code:c,phase:gEnd.phase,winner:gEnd.winner,round:gEnd.round,maxDrift:gEnd.max_drift,mode:gEnd.mode,status:gEnd.status,players:this.players(c).map(p=>({id:p.player_code,name:p.name,hero:p.role_id||null,playerCode:p.player_code,seat:p.seat,roleId:p.role_id||null,faction:p.faction,drift:p.drift,alive:!!p.alive,crippleTier:p.cripple_tier,isBot:!!p.is_bot})),debugLog:this.db.prepare('SELECT * FROM hr_events WHERE game_code=? ORDER BY id').all(c),history:this.db.prepare('SELECT id,channel,author,body,kind,created_at AS createdAt FROM hr_messages WHERE game_code=? ORDER BY id').all(c),createdAt:gEnd.created_at});return true;}
  sendMessage(c,p,channel,body){const g=this.game(c),player=this.requirePlayer(c,p);this.authorizeChannel(g,player,channel,true);return this.insertMessage(c,channel,null,p,this.displayName(g,player),String(body||'').trim().slice(0,1000),'player');}
  // H6 Animus: unlike Conspirator's forge() (day action, once/day, caller
  // names the target), this is unlimited for the possession day and the
  // target is never client-supplied — always derived from the server's own
  // live possessed_by record, so a bot/client can never spoof "speak as"
  // someone it doesn't actually possess.
  sendMessageAs(c,p,body){const g=this.game(c),actor=this.requireAlive(c,p);this.authorizeChannel(g,actor,'public',true);const target=this.players(c).find(x=>x.possessed_by===p&&x.alive);if(!target)throw new Error('You are not possessing anyone right now');return this.insertMessage(c,'public',null,p,this.displayName(g,target),String(body||'').trim().slice(0,1000),'player');}
  insertMessage(c,ch,recipient,p,author,body,kind,meta=null){if(!body)throw new Error('Message is empty');const x=this.db.prepare('INSERT INTO hr_messages(game_code,channel,recipient_code,player_code,author,body,kind,created_at,meta) VALUES(?,?,?,?,?,?,?,?,?)').run(c,ch,recipient,p,author,body,kind,this.now(),meta?JSON.stringify(meta):null);return this.db.prepare('SELECT id,channel,player_code,recipient_code,author,body,kind,created_at AS createdAt,meta FROM hr_messages WHERE id=?').get(x.lastInsertRowid);}
  system(c,b,meta=null){const m=this.insertMessage(c,'public',null,null,'The Vox',b,'system',meta);this.emitChatMessage(c,m);return m;} privateSystem(c,p,b,meta=null){const m=this.insertMessage(c,'private',p,null,'The Vox',b,'system',meta);this.emitChatMessage(c,m);return m;} factionSystem(c,b){const m=this.insertMessage(c,'faction',null,null,'The Vox',b,'system');this.emitChatMessage(c,m);return m;}
  flavor(category,vars={}){const list=this.config?.deathFlavor?.[category];if(!list||!list.length)return '';let t=list[Math.floor(this.random()*list.length)];for(const[k,v]of Object.entries(vars))t=t.split(`{${k}}`).join(String(v));return t;}
  /**
   * @param {string} [ch]
   * @param {number|string} [before]
   * @param {number|string} [limit]
   */
  historyMessages(c,p,ch='public',before=Number.MAX_SAFE_INTEGER,limit=50){const g=this.game(c);const player=this.player(c,p);if(!player){if(g.phase==='lobby'||ch!=='public')throw new Error('Access denied');}else{this.authorizeChannel(g,player,ch,false);}const cap=Math.min(100,Number(limit)||50);const rows=this.db.prepare('SELECT id,channel,author,body,kind,created_at AS createdAt,meta FROM hr_messages WHERE game_code=? AND channel=? AND id<? ORDER BY id DESC LIMIT ?').all(c,ch,Number(before)||Number.MAX_SAFE_INTEGER,cap+1).reverse();const hasMore=rows.length>cap;return {messages:hasMore?rows.slice(0,cap):rows,hasMore};}
  // Post-game: once the conclave is 'ended', public chat opens up for
  // everyone — dead, possessed, whatever — so the table can talk about the
  // game afterward. The alive/night/possession gates below only ever apply
  // while the game is still running.
  authorizeChannel(g,p,ch,write){if(!['public','faction','graveyard'].includes(ch))throw new Error('Unknown channel');if(ch==='faction'&&p.faction!=='heretic')throw new Error('Faction channel denied');if(ch==='graveyard'&&p.alive)throw new Error('Graveyard denied');if(write&&ch==='public'&&g.phase!=='ended'){if(!p.alive||g.phase==='night')throw new Error('Public chat is closed');if(p.possessed_by)throw new Error('You are possessed and cannot speak today');}if(write&&ch==='faction'&&g.phase!=='night')throw new Error('Faction chat is night-only');}
  // H6 Animus visibility, per-row on `players[]` (spec: no tell to anyone but
  // the Animus before the reveal): `possessed:true` is included only when
  // (a) viewer IS the Animus who owns this possession, (b) viewer IS the
  // possessed player themselves (they need to know, to explain their own
  // disabled chat client-side — though nobody ELSE can tell from the outside),
  // or (c) the reveal has already fired (post-detonation, everyone learns) —
  // matches the existing role/faction reveal-on-`ended` pattern one line up.
  // Tiered Lynch (tiered-lynch.md v1.2.0): every living player who has ever
  // survived a torture is one more torture away from a free
  // execution — public knowledge, so the whole table can coordinate. Mirrors
  // resolveDayVote's own markedForEscalation check exactly (same
  // tortured_before column), so the flags the client shows are always
  // consistent with what would actually happen if that player is voted
  // leader again. Unlike v1.1.0, this is not "whoever the last day-resolution
  // event happened to be" — the mark is persistent and un-cleared by
  // anything except death, so more than one living player can be marked at
  // once (hence a list, not a single target).
  atRiskTargets(c){return this.players(c).filter(p=>p.alive&&p.tortured_before).map(p=>p.player_code);}
  state(c,viewerCode){const g=this.requireGame(c),viewer=this.requirePlayer(c,viewerCode),ended=g.status==='ended',players=this.rosterPlayers(c).map(p=>({playerCode:p.player_code,name:this.displayName(g,p),alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,crippleTier:p.cripple_tier,confessed:!!p.confessed,...((p.player_code===viewerCode||ended||(!p.alive&&p.possessed_by))?{role:p.role_id?this.role(p.role_id):null,faction:p.faction}:{}),...(viewer.faction==='heretic'&&p.faction==='heretic'?{faction:'heretic'}:{}),...((viewerCode===p.possessed_by||(viewerCode===p.player_code&&p.possessed_by)||(!p.alive&&p.possessed_by)||(ended&&p.possessed_by))?{possessed:true}:{})}));const privateMessages=/** @type {{id:number,author:string,body:string,kind:string,createdAt:number,meta:string|null}[]} */ (this.db.prepare("SELECT id,author,body,kind,created_at AS createdAt,meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id").all(c,viewerCode)).map(m=>({...m,meta:m.meta?JSON.parse(m.meta):null}));const votingEnabled=g.phase==='day'?g.round!==1:true;return {code:c,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,dayMs:g.day_ms,nightMs:g.night_ms,anonymized:!!g.anonymized,warpTaintVisible:!!g.warp_taint_visible,dayStartMinuteUtc:g.day_start_minute_utc,isHost:g.host_code===viewerCode,players,me:players.find(x=>x.playerCode===viewerCode),votes:g.phase==='day'?this.voteState(c):[],myAction:this.db.prepare('SELECT kind,target_code AS targetCode,variant FROM hr_actions WHERE game_code=? AND round=? AND actor_code=?').get(c,g.round,viewerCode)||null,lastProtectTarget:getLastProtectTarget(this.db,g.code,viewerCode),privateMessages,pendingTorture:g.day_stage==='response'?{targetCode:g.last_tortured_target,tier:g.last_torture_tier,canRespond:g.last_tortured_target===viewerCode}:null,votingEnabled,atRiskTargets:this.atRiskTargets(c),...(g.phase==='lobby'?{compositionLabel:`${players.length}-operative doctrine`}:{})};}
  spectate(c){const g=this.requireGame(c);if(g.phase==='lobby')throw new Error('Game has not started yet');const ended=g.status==='ended';const players=this.rosterPlayers(c).map(p=>({playerCode:p.player_code,name:this.displayName(g,p),alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,crippleTier:p.cripple_tier,confessed:!!p.confessed,...((ended||(!p.alive&&p.possessed_by))?{role:p.role_id?this.role(p.role_id):null,faction:p.faction}:{}),...((!p.alive&&p.possessed_by)||(ended&&p.possessed_by)?{possessed:true}:{})}));return {code:c,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,dayMs:g.day_ms,nightMs:g.night_ms,anonymized:!!g.anonymized,warpTaintVisible:!!g.warp_taint_visible,dayStartMinuteUtc:g.day_start_minute_utc,isHost:false,players,me:null,votes:g.phase==='day'?this.voteState(c):[],myAction:null,lastProtectTarget:null,privateMessages:[],pendingTorture:null,votingEnabled:g.phase==='day'?g.round!==1:false,atRiskTargets:this.atRiskTargets(c),isSpectator:true};}
  adminRole(id){if(!id)return null;const r=this.config.roles.get(id);return r?{id:r.id,displayName:r.displayName,faction:r.faction,claim:r.claim,driftWeight:r.driftWeight,objective:r.objective,ability:r.ability}:null;}
  adminPlayer(p,g){return {playerCode:p.player_code,name:p.name,seat:p.seat,roleId:p.role_id,role:this.adminRole(p.role_id),faction:p.faction,drift:p.drift,alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,isBot:!!p.is_bot,crippleTier:p.cripple_tier,tier1UntilRound:p.tier1_until_round,confessed:!!p.confessed,confessionTokenRound:p.confession_token_round,skipNextNight:!!p.skip_next_night,joinedAt:p.joined_at};}
  adminGameSummary(g){const players=this.players(g.code),messages=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_messages WHERE game_code=?').get(g.code)).count,events=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_events WHERE game_code=?').get(g.code)).count,actions=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_actions WHERE game_code=?').get(g.code)).count,votes=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_votes WHERE game_code=?').get(g.code)).count;return {code:g.code,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,hintProfile:g.hint_profile,createdAt:g.created_at,updatedAt:g.updated_at,hostCode:g.host_code,playerCount:players.length,aliveCount:players.filter(p=>p.alive).length,connectedCount:players.filter(p=>p.connected).length,readyCount:players.filter(p=>p.ready).length,averageDrift:players.length?players.reduce((sum,p)=>sum+p.drift,0)/players.length:0,maxPlayerDrift:players.length?Math.max(...players.map(p=>p.drift)):0,hereticCount:players.filter(p=>p.faction==='heretic').length,loyalistCount:players.filter(p=>p.faction==='loyalist').length,messageCount:messages,eventCount:events,actionCount:actions,voteCount:votes};}
  adminOverview(){const games=this.db.prepare('SELECT * FROM hr_games ORDER BY updated_at DESC').all().map(g=>this.adminGameSummary(g));return {games,roles:this.roleDefinitions().map(r=>({id:r.id,displayName:r.displayName,faction:r.faction,claim:r.claim,driftWeight:r.driftWeight,objective:r.objective,ability:r.ability})),totals:{games:games.length,active:games.filter(g=>g.status==='active').length,lobby:games.filter(g=>g.status==='lobby').length,ended:games.filter(g=>g.status==='ended').length,players:games.reduce((sum,g)=>sum+g.playerCount,0),messages:games.reduce((sum,g)=>sum+g.messageCount,0)}};}
  adminGame(c){const g=this.requireGame(c),players=this.players(c).map(p=>this.adminPlayer(p,g)),actions=/** @type {{round:number,actorCode:string,kind:string,targetCode:string|null,variant:string|null,data:string|null,createdAt:number}[]} */ (this.db.prepare('SELECT round,actor_code AS actorCode,kind,target_code AS targetCode,variant,data,created_at AS createdAt FROM hr_actions WHERE game_code=? ORDER BY round DESC,created_at DESC').all(c)).map(a=>({...a,data:a.data?JSON.parse(a.data):null})),votes=this.db.prepare('SELECT round,stage,voter_code AS voterCode,choice,created_at AS createdAt FROM hr_votes WHERE game_code=? ORDER BY round DESC,created_at DESC').all(c),messages=this.db.prepare('SELECT id,channel,recipient_code AS recipientCode,player_code AS playerCode,author,body,kind,created_at AS createdAt FROM hr_messages WHERE game_code=? ORDER BY id DESC LIMIT 200').all(c).reverse(),events=/** @type {{id:number,type:string,payload:string|null,createdAt:number}[]} */ (this.db.prepare('SELECT id,type,payload,created_at AS createdAt FROM hr_events WHERE game_code=? ORDER BY id DESC LIMIT 200').all(c)).reverse().map(e=>({...e,payload:e.payload?JSON.parse(e.payload):null}));return {game:this.adminGameSummary(g),players,actions,votes,messages,events};}
  adminUpdatePlayer(c,p,updates={}){const existing=this.requirePlayer(c,p),g=this.requireGame(c),fields=[],values=[];const bools={alive:'alive',ready:'ready',connected:'connected',confessed:'confessed',skipNextNight:'skip_next_night'};for(const [input,column] of Object.entries(bools))if(updates[input]!==undefined){fields.push(`${column}=?`);values.push(updates[input]?1:0);}if(updates.drift!==undefined){fields.push('drift=?');values.push(Math.max(0,Math.min(g.max_drift,Number(updates.drift)||0)));}if(updates.crippleTier!==undefined){fields.push('cripple_tier=?');values.push(Math.max(0,Math.min(3,Number(updates.crippleTier)||0)));}if(updates.faction!==undefined&&['loyalist','heretic'].includes(updates.faction)){fields.push('faction=?');values.push(updates.faction);}if(updates.roleId!==undefined){if(updates.roleId&& !this.config.roles.has(updates.roleId))throw new Error('Unknown role');fields.push('role_id=?');values.push(updates.roleId||null);}if(!fields.length)return this.adminPlayer(existing,g);this.db.prepare(`UPDATE hr_players SET ${fields.join(', ')} WHERE game_code=? AND player_code=?`).run(...values,c,p);return this.adminPlayer(this.player(c,p),g);}
  adminEndGame(c,winner='admin'){this.requireGame(c);this.db.prepare("UPDATE hr_games SET phase='ended',status='ended',winner=?,deadline=NULL,updated_at=? WHERE code=?").run(String(winner||'admin').slice(0,30),this.now(),c);this.system(c,`Game ended by admin: ${winner}.`);const gEnd=this.game(c);saveGameLogSnapshot({gameLogId:c,code:c,phase:gEnd.phase,winner:gEnd.winner,round:gEnd.round,maxDrift:gEnd.max_drift,mode:gEnd.mode,status:gEnd.status,players:this.players(c).map(p=>({id:p.player_code,name:p.name,hero:p.role_id||null,playerCode:p.player_code,seat:p.seat,roleId:p.role_id||null,faction:p.faction,drift:p.drift,alive:!!p.alive,crippleTier:p.cripple_tier,isBot:!!p.is_bot})),debugLog:this.db.prepare('SELECT * FROM hr_events WHERE game_code=? ORDER BY id').all(c),history:this.db.prepare('SELECT id,channel,author,body,kind,created_at AS createdAt FROM hr_messages WHERE game_code=? ORDER BY id').all(c),createdAt:gEnd.created_at});return this.adminGame(c);}
  adminDeleteGame(c){this.requireGame(c);this.db.transaction(()=>{for(const table of ['hr_actions','hr_votes','hr_messages','hr_usage','hr_events','hr_players'])this.db.prepare(`DELETE FROM ${table} WHERE game_code=?`).run(c);this.db.prepare('DELETE FROM hr_games WHERE code=?').run(c);})();return {deleted:true};}
  due(){return /** @type {{code:string}[]} */ (this.db.prepare("SELECT code FROM hr_games WHERE status='active' AND deadline IS NOT NULL AND deadline<=?").all(this.now())).map(x=>x.code);}
  // ── Bots ───────────────────────────────────────────────────────────────────
  // Spawn authorisation: only callers holding the bot-manager's BOT_API_KEY reach
  // adminSpawnBot/adminDespawnBot (the engine treats those as privileged internal
  // calls; /api/bots/* validates the bearer token before reaching these).
  // Lobby-only gate per locked Q-BOT spawn rule.
  generateBotPlayerCode(){const existing=new Set(/** @type {{player_code:string}[]} */ (this.db.prepare('SELECT player_code FROM hr_players').all()).map(x=>x.player_code));let code;do{code='HR-BOT-'+crypto.randomBytes(8).toString('hex');}while(existing.has(code));return code;}
  adminSpawnBot(code,{name='Heretic Bot',seatHint=null}={}){
    const g=this.requireGame(code);
    if(g.phase!=='lobby')throw new Error('Bots can only be added while the Conclave is in the lobby');
    const players=this.players(code);
    const botCount=players.filter(p=>p.is_bot).length;
    const MAX_BOTS_PER_GAME=Number(process.env.MAX_BOTS_PER_GAME)||4;
    if(botCount>=MAX_BOTS_PER_GAME)throw new Error(`Bot limit (${MAX_BOTS_PER_GAME} per Conclave) reached`);
    if(players.length>=12)throw new Error('Conclave is full');
    let seat;
    if(seatHint!=null&&seatHint!==''){const s=Math.max(0,Number(seatHint)|0);if(s>=12||players.some(p=>p.seat===s))throw new Error('Requested seat is taken or out of range');seat=s;}
    else{const taken=new Set(players.map(p=>p.seat));seat=0;while(taken.has(seat))seat++;}
    const playerCode=this.generateBotPlayerCode();
    this.db.prepare('INSERT INTO hr_players(game_code,player_code,name,seat,joined_at,is_bot,ready) VALUES(?,?,?,?,?,1,1)').run(code,playerCode,sanitizePlayerName(name)||'Heretic Bot',seat,this.now());
    return {playerCode,seat,isBot:true,name:sanitizePlayerName(name)||'Heretic Bot',conclaveCode:code};
  }
  adminDespawnBot(code,playerCode){
    const p=this.requirePlayer(code,playerCode);
    if(!p.is_bot)throw new Error('Not a bot');
    const g=this.requireGame(code);
    if(g.phase!=='lobby')throw new Error('Bots can only be removed while the Conclave is in the lobby');
    this.db.prepare('DELETE FROM hr_players WHERE game_code=? AND player_code=?').run(code,playerCode);
    return {despawned:true,playerCode,conclaveCode:code};
  }
  botIds(c){return this.players(c).filter(p=>p.is_bot).map(p=>p.player_code);}
  botSessionInit(c,playerCode){
    const g=this.requireGame(c),p=this.requirePlayer(c,playerCode);
    if(!p.is_bot)return null;
    if(g.phase==='lobby')return {kind:'session_init',botId:playerCode,playerCode,role:null,faction:null,claim:null,round:0,phase:'lobby',votingEnabled:false,alivePlayers:this.players(c).map(x=>x.player_code),deadPlayers:[],publicAnnouncements:[],botIds:this.botIds(c)};
    const role=p.role_id?this.role(p.role_id):null;
    return {kind:'session_init',botId:playerCode,playerCode,role:role?.id||null,faction:p.faction,claim:role?.claim||null,round:g.round,phase:g.phase,votingEnabled:g.phase==='day'?g.round!==1:false,alivePlayers:this.players(c).filter(x=>x.alive).map(x=>x.player_code),deadPlayers:this.players(c).filter(x=>!x.alive).map(x=>x.player_code),publicAnnouncements:[],botIds:this.botIds(c)};
  }
  event(c,t,p){this.db.prepare('INSERT INTO hr_events(game_code,type,payload,created_at) VALUES(?,?,?,?)').run(c,t,JSON.stringify(p),this.now());}
  /** @returns {GameRow} */
  requireGame(c){const g=this.game(c);if(!g)throw new Error('Game not found');return g;}
  /** @returns {PlayerRow} */
  requirePlayer(c,p){const x=this.player(c,p);if(!x)throw new Error('Not a member');return x;}
  /** @returns {PlayerRow} */
  requireAlive(c,p){const x=this.requirePlayer(c,p);if(!x.alive)throw new Error('Dead players cannot do that');return x;}
  /** @returns {GameRow} */
  requireHost(c,p){const g=this.requireGame(c);if(g.host_code!==p)throw new Error('Host permission required');return g;}
}
