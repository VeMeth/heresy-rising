import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateRoomCode, sanitizePlayerName, shuffle } from './utils.js';
import { loadGameConfig } from './gameConfig.js';
import { renderAbility } from './mechanics/abilityText.js';
import { NOTABLE_NAMES } from './notableNames.js';
import { driftZone, intelNoiseRate, noisyResult, murdererGateCue, applyProximitySiphon } from './mechanics/drift.js';
import { effectiveCrippleTier, getEffectiveScanTier, isExecuteOnSight, crippleSeverityLabel } from './mechanics/interrogation.js';
import { resolveScaledCost } from './mechanics/scaledCosts.js';
import { validateRotation, getLastProtectTarget } from './mechanics/protection.js';
import { getVisitorsForRound, getVisitorsUnion } from './mechanics/astropath.js';
import { validateComposition } from './validators/composition.js';
import { resolveManualAssignment } from './validators/manualAssignment.js';
import { saveGameLogSnapshot } from './gameLogs.js';

// Phase-length defaults (ms) for the two lobby modes, the bounds
// start()/configure() clamp host-supplied overrides into, and the async
// day-start default are all in game_data/phases.json (this.config.phases),
// read per-instance rather than as module consts. Async mode: day and night
// are locked at 12h each (not separately configurable) — the host instead
// sets a wall-clock day-start time (day_start_minute_utc), and start()
// aligns the first boundary to it (see nextScheduleBoundary below). See
// game_data/phases.json for why the two floors (start's vs configure's) are
// deliberately asymmetric.

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

/**
 * @typedef {Object} NoteEntry
 * @property {number} id
 * @property {string|null} subjectCode
 * @property {string} body
 * @property {number} round
 * @property {string} phase
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Bookmark
 * @property {number} messageId
 * @property {string|null} subjectCode
 * @property {string} author
 * @property {string} excerpt
 * @property {string} channel
 * @property {string|null} note
 * @property {number} auto
 * @property {number} ownAction
 * @property {number|null} round
 * @property {string|null} phase
 * @property {number} createdAt
 */

const schema = `
CREATE TABLE IF NOT EXISTS hr_games(code TEXT PRIMARY KEY,host_code TEXT NOT NULL,mode TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'lobby',day_stage TEXT,status TEXT NOT NULL DEFAULT 'lobby',round INTEGER NOT NULL DEFAULT 0,deadline INTEGER,day_ms INTEGER NOT NULL,night_ms INTEGER NOT NULL,max_drift INTEGER NOT NULL,hint_profile TEXT NOT NULL DEFAULT 'default',last_tortured_target TEXT,last_torture_tier INTEGER NOT NULL DEFAULT 0,winner TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hr_players(game_code TEXT NOT NULL,player_code TEXT NOT NULL,name TEXT NOT NULL,seat INTEGER NOT NULL,role_id TEXT,faction TEXT,drift INTEGER NOT NULL DEFAULT 0,alive INTEGER NOT NULL DEFAULT 1,ready INTEGER NOT NULL DEFAULT 0,connected INTEGER NOT NULL DEFAULT 1,cripple_tier INTEGER NOT NULL DEFAULT 0,tier1_until_round INTEGER,skip_next_night INTEGER NOT NULL DEFAULT 0,joined_at INTEGER NOT NULL,PRIMARY KEY(game_code,player_code));
CREATE TABLE IF NOT EXISTS hr_player_prefs(player_code TEXT PRIMARY KEY,prefs TEXT NOT NULL DEFAULT '{}',updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hr_actions(game_code TEXT NOT NULL,round INTEGER NOT NULL,actor_code TEXT NOT NULL,kind TEXT NOT NULL,target_code TEXT,variant TEXT,data TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(game_code,round,actor_code));
CREATE TABLE IF NOT EXISTS hr_votes(game_code TEXT NOT NULL,round INTEGER NOT NULL,stage TEXT NOT NULL,voter_code TEXT NOT NULL,choice TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(game_code,round,stage,voter_code));
CREATE TABLE IF NOT EXISTS hr_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,game_code TEXT NOT NULL,channel TEXT NOT NULL,recipient_code TEXT,player_code TEXT,author TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'player',created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hr_messages_cursor ON hr_messages(game_code,id);
CREATE TABLE IF NOT EXISTS hr_usage(game_code TEXT NOT NULL,player_code TEXT NOT NULL,ability TEXT NOT NULL,uses INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(game_code,player_code,ability));
CREATE TABLE IF NOT EXISTS hr_events(id INTEGER PRIMARY KEY AUTOINCREMENT,game_code TEXT NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hr_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,game_code TEXT NOT NULL,owner_code TEXT NOT NULL,subject_code TEXT,body TEXT NOT NULL,round INTEGER NOT NULL,phase TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hr_notes_owner ON hr_notes(game_code,owner_code);
CREATE TABLE IF NOT EXISTS hr_bookmarks(game_code TEXT NOT NULL,owner_code TEXT NOT NULL,message_id INTEGER NOT NULL,subject_code TEXT,author TEXT NOT NULL,excerpt TEXT NOT NULL,channel TEXT NOT NULL,note TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(game_code,owner_code,message_id));
`;

export const DEATH_REVEALS=['alignment','role'];
// Auto-filed bookmarks (autoBookmark) get their own budget, separate from the
// 300-row manual cap toggleBookmark enforces — see autoBookmark's comment.
const AUTO_BOOKMARK_CAP=300;

// One place decides what an execution discloses, so the lynch and torture-death
// paths can never drift apart again. Returns the clause to append to the death
// notice, plus the structured fields for the announcement payload.
export function deathReveal(mode,roleName,faction){
  // Some role displayNames already carry the faction ("Priest (Loyalist)"),
  // so only append it when it isn't already in the name.
  if(mode==='role')return{text:` They were ${roleName}${new RegExp(faction,'i').test(roleName)?'':` (${faction})`}.`,role:roleName,faction};
  return{text:` They were ${faction==='heretic'?'a Heretic':'a Loyalist'}.`,role:null,faction};
}

export function isHostileTo(a, b) {
  // TODO(heresy-spec): v1 hostility is the non-canonical two-faction inequality default.
  return a.faction !== b.faction;
}

export class HeresyGameManager {
  constructor({ databasePath = process.env.GAME_DB_PATH || path.join(process.cwd(), 'data', 'heresy-rising.db'), now = () => Date.now(), random = Math.random, adminPlayerCodes = new Set() } = {}) {
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
    // Splits "is this player marked" (tortured_before, engine truth) from "does
    // the TABLE know they're marked" (mark_public). A public day-vote torture
    // sets both; the Interrogator's Red night-scan sets only the former. Before
    // this split, a scan silently raised the public TORTURED badge on a player
    // who had never been tortured, which told the whole table — the cabal
    // included — that an Interrogator exists and just read that player Red.
    // Nothing that identifies a role may be publicly derivable, or players can
    // prove their own role with it.
    this.ensureColumn('hr_players','mark_public',"INTEGER NOT NULL DEFAULT 0");
    // What a day-phase execution tells the table about the dead. Host-chosen in
    // the lobby; 'alignment' is the quieter opt-in. Default is 'role' by owner
    // ruling, which is deliberately louder than rules.md / day-phase.md /
    // tiered-lynch.md, all of which say alignment only -- the setting exists so
    // a host can pick, and the spec wording describes the opt-in, not the floor.
    // Before this the two execution paths disagreed with each other and with the
    // specs: torture-death announced the full role, a lynch announced nothing.
    this.ensureColumn('hr_games','death_reveal',"TEXT NOT NULL DEFAULT 'role'");
    // Marks a bookmark the engine filed on the player's behalf rather than one
    // they saved by hand, so the dossier can label it. Removable either way.
    this.ensureColumn('hr_bookmarks','auto',"INTEGER NOT NULL DEFAULT 0");
    // own_action: this row is filed because the OWNER chose the action the
    // underlying message describes (a protect, a scan, a kill attempt...),
    // as opposed to subject_code, which says who the message is ABOUT. The
    // two are independent and both can be true (you protected them — it's
    // about them AND it's your own action). This is what lets one row serve
    // both "under their dossier tab" and a separate "my actions" view without
    // a second row and a second shot at the cap (option A, bugfix-round §3a —
    // widening the PK to (game,owner,message,subject) and inserting twice was
    // rejected: it duplicates content, doubles cap pressure, and makes
    // un-bookmarking ambiguous).
    this.ensureColumn('hr_bookmarks','own_action',"INTEGER NOT NULL DEFAULT 0");
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
    this.ensureColumn('hr_players','death_cause',"TEXT");
    // H7 Poxwalker (roles/poxwalker.md v1.0.0). Two columns, not the seven the
    // dispatch sketched: `plague_source` is derivable (it is whoever
    // hr_games.patient_zero names), `sourceGone` is derivable (patient_zero
    // set + that player dead), `activePoxwalker` is derivable (the roster's
    // poxwalker), and the per-night cripple roll is a transient inside one
    // resolve pass, not state. What genuinely has to persist is who Patient
    // Zero is, and which players have ever touched them — carriers keep
    // climbing for the rest of the game, including after the source dies.
    this.ensureColumn('hr_games','patient_zero',"TEXT");
    this.ensureColumn('hr_players','plague_carrier',"INTEGER NOT NULL DEFAULT 0");
    // Voter-supplied reasoning, persisted onto the vote row itself so the
    // tally tooltip can show it alongside each voter's name — previously
    // this only ever existed as a public chat message (see vote()/voteAs()).
    this.ensureColumn('hr_votes','justification',"TEXT");
    // When an engine-filed bookmark happened, in game time rather than wall
    // time — mirrors hr_notes' round/phase stamp so "My Actions" can show
    // N3/D4 the same way manual notes already do. Nullable and left NULL for
    // manual bookmarks (toggleBookmark): a player picking a chat message to
    // save has no equivalent "when I formed this read" moment worth stamping,
    // and the client only renders the stamp when phase is present.
    this.ensureColumn('hr_bookmarks','round',"INTEGER");
    this.ensureColumn('hr_bookmarks','phase',"TEXT");
    this.now = now; this.random = random; this.adminPlayerCodes = adminPlayerCodes; this.config = loadGameConfig();
    this._announcementListeners = [];
    this._botPromptListeners = [];
    this._chatMessageListeners = [];
    this._bookmarkListeners = [];
  }
  onAnnouncement(fn){this._announcementListeners.push(fn);}
  emitAnnouncement(c,a){a.createdAt=new Date().toISOString();for(const fn of this._announcementListeners)try{fn(c,a);}catch{}}
  onBotPrompt(fn){this._botPromptListeners.push(fn);}
  emitBotPrompt(c,payload){for(const fn of this._botPromptListeners)try{fn(c,payload);}catch{}}
  // Fired only for the owner the bookmark was filed for — never a room
  // broadcast. autoBookmark is the sole caller; index.js targets delivery to
  // that one player's socket the same way broadcastBotPrompt already does for
  // onBotPrompt, so an auto-filed note updates the client's bookmark list
  // live instead of waiting for the next notes:list reload (bugfix-round §4).
  onBookmark(fn){this._bookmarkListeners.push(fn);}
  emitBookmark(c,ownerCode,bookmark){for(const fn of this._bookmarkListeners)try{fn(c,ownerCode,bookmark);}catch{}}
  onChatMessage(fn){this._chatMessageListeners.push(fn);}
  emitChatMessage(c,message){for(const fn of this._chatMessageListeners)try{fn(c,message);}catch{}}

  // Small per-player, cross-game preference store (currently just the seal
  // style) keyed by playerCode rather than by any specific game — this is
  // what lets a preference chosen on one device follow the same identity
  // when restored on another, where localStorage starts out empty. The
  // client already normalizes/falls back on an unknown value (it owns the
  // list of what a valid preference looks like), so this only needs to
  // store and hand back a small flat object without choking on garbage.
  getPlayerPrefs(playerCode){
    const row=/** @type {{prefs:string}|undefined} */ (this.db.prepare('SELECT prefs FROM hr_player_prefs WHERE player_code=?').get(playerCode));
    if(!row)return{};
    try{const parsed=JSON.parse(row.prefs);return(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))?parsed:{};}catch{return{};}
  }
  setPlayerPrefs(playerCode,patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid preferences payload');
    // Flat, primitive-valued keys only, and capped — this is a small settings
    // blob, not a general-purpose store, so garbage/oversized input is
    // dropped rather than rejecting the whole request over one bad key.
    const entries=Object.entries(patch).filter(([k,v])=>typeof k==='string'&&k.length<=64&&['string','number','boolean'].includes(typeof v)).slice(0,32);
    const merged={...this.getPlayerPrefs(playerCode),...Object.fromEntries(entries)};
    const serialized=JSON.stringify(merged);
    if(serialized.length>4000)throw new Error('Preferences payload too large');
    this.db.prepare('INSERT INTO hr_player_prefs(player_code,prefs,updated_at) VALUES(?,?,?) ON CONFLICT(player_code) DO UPDATE SET prefs=excluded.prefs,updated_at=excluded.updated_at').run(playerCode,serialized,this.now());
    return merged;
  }

  // ── Private notes & bookmarks ──────────────────────────────────────────
  // Per-game, per-owner dossier: freeform notes about other players (or a
  // "General" bucket, subjectCode null) plus bookmarked chat messages.
  // Both are strictly private — every read path below is scoped to
  // owner_code=ownerCode, and there is no per-player socket room in this
  // codebase to accidentally broadcast one into, so nothing here is ever
  // pushed through io.to(code).emit — only back through the request's own
  // ack. Never expose a row whose owner_code isn't the caller's.

  /** @returns {NoteEntry} */
  noteRow(id) {
    return /** @type {NoteEntry} */ (this.db.prepare(
      'SELECT id,subject_code AS subjectCode,body,round,phase,created_at AS createdAt,updated_at AS updatedAt FROM hr_notes WHERE id=?'
    ).get(id));
  }
  /** @returns {Bookmark|undefined} */
  bookmarkRow(c, ownerCode, messageId) {
    return /** @type {Bookmark|undefined} */ (this.db.prepare(
      'SELECT message_id AS messageId,subject_code AS subjectCode,author,excerpt,channel,note,auto,own_action AS ownAction,round,phase,created_at AS createdAt FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND message_id=?'
    ).get(c, ownerCode, messageId));
  }

  // Everything this owner has stashed for this game — their private notes
  // and their bookmarked messages. Scoped by owner_code in the SQL itself,
  // not filtered after the fact, so there is no code path here that can
  // ever hand back another player's row.
  listNotes(c, ownerCode) {
    const notes = /** @type {NoteEntry[]} */ (this.db.prepare(
      'SELECT id,subject_code AS subjectCode,body,round,phase,created_at AS createdAt,updated_at AS updatedAt FROM hr_notes WHERE game_code=? AND owner_code=? ORDER BY created_at,id'
    ).all(c, ownerCode));
    const bookmarks = /** @type {Bookmark[]} */ (this.db.prepare(
      'SELECT message_id AS messageId,subject_code AS subjectCode,author,excerpt,channel,note,auto,own_action AS ownAction,round,phase,created_at AS createdAt FROM hr_bookmarks WHERE game_code=? AND owner_code=? ORDER BY created_at,message_id'
    ).all(c, ownerCode));
    return { notes, bookmarks };
  }

  // Adds one dossier entry, stamped with the game's CURRENT round/phase —
  // that stamp is what turns a flat list of notes into a chronological
  // record of when the observation was formed, and editNote below is
  // careful never to move it. subjectCode is either a real player_code in
  // this game or null/omitted for the "General" bucket (a note not about
  // any one player); anything else is rejected rather than silently
  // dropped, since a stray subjectCode would otherwise misfile a note
  // under the wrong dossier tab.
  addNote(c, ownerCode, subjectCode, body) {
    const g = this.requireGame(c);
    this.requirePlayer(c, ownerCode);
    const trimmed = String(body || '').trim();
    if (!trimmed) throw new Error('Note is empty');
    if (trimmed.length > 500) throw new Error('Note is too long');
    let cleanSubject = null;
    if (subjectCode !== null && subjectCode !== undefined && subjectCode !== '') {
      if (!this.player(c, subjectCode)) throw new Error('Unknown subject');
      cleanSubject = subjectCode;
    }
    // Cap is per (game, owner, subject) — a chatty player filling up notes
    // on one target shouldn't crowd out room to note anyone else.
    const { n } = /** @type {{n:number}} */ (this.db.prepare(
      'SELECT COUNT(*) AS n FROM hr_notes WHERE game_code=? AND owner_code=? AND subject_code IS ?'
    ).get(c, ownerCode, cleanSubject));
    if (n >= 200) throw new Error('Note limit reached for this subject');
    const now = this.now();
    const result = this.db.prepare(
      'INSERT INTO hr_notes(game_code,owner_code,subject_code,body,round,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(c, ownerCode, cleanSubject, trimmed, g.round, g.phase, now, now);
    return this.noteRow(result.lastInsertRowid);
  }

  // Changes body (and bumps updated_at) only. round/phase/created_at — and
  // therefore the note's position in listNotes' created_at,id ordering —
  // are frozen at addNote time and never touched here: the stamp records
  // when the observation was FORMED, not when it was last tidied up.
  // updated_at > created_at is the only "this was edited" signal there
  // is — deliberately no separate boolean flag to keep in sync with it.
  editNote(c, ownerCode, noteId, body) {
    const trimmed = String(body || '').trim();
    if (!trimmed) throw new Error('Note is empty');
    if (trimmed.length > 500) throw new Error('Note is too long');
    // Ownership lives IN the UPDATE's WHERE clause, not a prior
    // SELECT-then-check: id is a bare autoincrement primary key, so
    // without owner_code in the predicate a player could edit another
    // player's private note purely by guessing an integer. A zero-row
    // result throws the exact same "not found" error a genuinely missing
    // id would — the response never reveals that some OTHER owner's note
    // exists at that id.
    const result = this.db.prepare(
      'UPDATE hr_notes SET body=?,updated_at=? WHERE id=? AND game_code=? AND owner_code=?'
    ).run(trimmed, this.now(), noteId, c, ownerCode);
    if (result.changes === 0) throw new Error('Note not found');
    return this.noteRow(noteId);
  }

  // Same ownership-in-the-WHERE-clause reasoning as editNote above — a
  // DELETE that isn't scoped by owner_code would let any player erase any
  // other player's private notes by id-guessing.
  deleteNote(c, ownerCode, noteId) {
    const result = this.db.prepare(
      'DELETE FROM hr_notes WHERE id=? AND game_code=? AND owner_code=?'
    ).run(noteId, c, ownerCode);
    if (result.changes === 0) throw new Error('Note not found');
    return true;
  }

  // Bookmarks a chat message, or un-bookmarks it if it's already saved
  // (returns null in that case — this is a toggle, not an add-only call).
  // Files a private event message into the recipient's own dossier as they
  // receive it, so an Interrogator's scan is already waiting under the player
  // they scanned instead of having to be hunted down in the log and saved by
  // hand. Covers both directions: results of your own action, and things done
  // TO you that the game tells you about (a Blood Ritual crippling, a
  // bodyguard taking a strike meant for you, a catalyst turning you).
  //
  // The subject falls out of that distinction on its own and cannot leak. Your
  // own action carries meta.target -- a player you already chose, so filing it
  // under them tells you nothing new. Anything done to you has no target in its
  // meta, precisely because the actor is hidden from you, so it lands in the
  // General bucket where it belongs. There is deliberately no path here that
  // consults the true actor.
  //
  // No visibility check: unlike toggleBookmark, the caller is the server
  // handing a player their own private message, not a client naming an
  // arbitrary id. Idempotent, so a replayed or duplicated message can't
  // double-file, and it never overwrites a bookmark the player already made.
  //
  // ownAction: true when the message describes something the OWNER chose
  // (a protect, a scan, a night-action report — see the resolveNight morning
  // report and resolveIntel) rather than something merely done TO them. It is
  // never derived from meta — meta is also what gets broadcast/stored on the
  // message itself and bot-manager reads it, so this stays a separate
  // argument precisely so adding it here can never change a message's meta
  // payload (bugfix-round §5 requires interrogate's meta to stay byte-
  // identical). Stored in its own column, independent of subject_code.
  //
  // Cap: auto-filed rows are counted and capped SEPARATELY from manual ones
  // (auto=1 vs auto=0 — see toggleBookmark's mirrored check below). Night
  // resolution can now file several rows per player per round (bugfix-round
  // §3b), so sharing one 300-row budget with hand-picked bookmarks would let
  // the engine's own record-keeping silently crowd out a player's manual
  // saves, or vice versa. Hitting the auto cap is logged via event() (not
  // thrown — this runs inside night resolution and a full dossier must never
  // take the game down with it) so the drop is detectable instead of silent.
  autoBookmark(c, ownerCode, message, meta, ownAction = false) {
    if (!message?.id || !ownerCode) return null;
    const existing = this.db.prepare('SELECT 1 FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND message_id=?').get(c, ownerCode, message.id);
    if (existing) return null;
    const { n } = /** @type {{n:number}} */ (this.db.prepare('SELECT COUNT(*) AS n FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND auto=1').get(c, ownerCode));
    if (n >= AUTO_BOOKMARK_CAP) { this.event(c, 'bookmark-cap-hit', { ownerCode, messageId: message.id, scope: 'auto' }); return null; }
    const subject = meta?.target && this.player(c, meta.target) ? meta.target : null;
    // Stamped with the game's CURRENT round/phase, same as addNote — for a
    // night report this runs before resolveNight's setPhase call, so it
    // still reads the night just resolved, not the day it's about to become.
    const g = this.requireGame(c);
    this.db.prepare(
      'INSERT INTO hr_bookmarks(game_code,owner_code,message_id,subject_code,author,excerpt,channel,note,created_at,auto,own_action,round,phase) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)'
    ).run(c, ownerCode, message.id, subject, message.author, String(message.body || '').slice(0, 300), message.channel, null, this.now(), ownAction ? 1 : 0, g.round, g.phase);
    const row = this.bookmarkRow(c, ownerCode, message.id);
    this.emitBookmark(c, ownerCode, row);
    return row;
  }
  toggleBookmark(c, ownerCode, messageId) {
    const g = this.requireGame(c);
    const player = this.requirePlayer(c, ownerCode);
    const existing = this.db.prepare(
      'SELECT 1 FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND message_id=?'
    ).get(c, ownerCode, messageId);
    if (existing) {
      this.db.prepare('DELETE FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND message_id=?').run(c, ownerCode, messageId);
      return null;
    }
    const message = /** @type {any} */ (this.db.prepare('SELECT * FROM hr_messages WHERE id=? AND game_code=?').get(messageId, c));
    if (!message) throw new Error('Message not found');
    // SECURITY — this is the one real attack surface in the whole
    // notes/bookmarks feature. Without this check, any player could read
    // ANY message in the game — including enemy faction chat, or another
    // player's private messages — just by bookmarking an arbitrary
    // integer message id and reading the stored excerpt back out of
    // listNotes(). 'private' is handled separately from the
    // authorizeChannel(..., false) call below rather than being folded
    // into it: authorizeChannel's channel list intentionally excludes
    // 'private' because it's also the gate chat:history uses, and
    // chat:history's own query has no per-recipient filter — teaching
    // authorizeChannel to accept 'private' as a generally-readable channel
    // would let ANY player pull every private message in the game through
    // chat:history, not just their own. So: for 'private' messages, the
    // recipient_code check below is the ENTIRE visibility check; for every
    // other channel, authorizeChannel(..., false) enforces the same
    // read-access rules chat:history does. Do not simplify this away.
    if (message.channel === 'private') {
      if (message.recipient_code !== ownerCode) throw new Error('Message not found');
    } else {
      this.authorizeChannel(g, player, message.channel, false);
    }
    // Counts only manual (auto=0) rows — its own budget, independent of the
    // auto-filed cap in autoBookmark above, so the engine's own night-report
    // filing can never crowd out a player's hand-picked saves.
    const { n } = /** @type {{n:number}} */ (this.db.prepare(
      'SELECT COUNT(*) AS n FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND auto=0'
    ).get(c, ownerCode));
    if (n >= 300) throw new Error('Bookmark limit reached');
    // Subject resolution deliberately does NOT use hr_messages.player_code.
    // A possessed puppet's message is stored under the POSSESSOR's
    // player_code (see sendMessageAs above) but DISPLAYS the puppet's
    // name — keying subjectCode off player_code would hand the viewer
    // exactly who is possessing whom, a game-breaking information leak.
    // Matching the stored `author` string against each roster player's
    // CURRENT displayName() instead resolves to the puppet, which is both
    // what the viewer actually believed they were reading and what the
    // bookmark should say. System messages are authored 'The Vox' (see
    // system() above), which never matches a roster name, so they fall
    // through to subjectCode=null (the General bucket) — that's intended,
    // not a bug. This resolution happens once, here, at bookmark time,
    // and is stored rather than recomputed on read — so a later switch
    // into anonymized mode (which changes what displayName() returns)
    // can't retroactively orphan an already-created bookmark.
    const roster = this.players(c);
    const subjectPlayer = roster.find(pl => this.displayName(g, pl) === message.author);
    const subjectCode = subjectPlayer ? subjectPlayer.player_code : null;
    const excerpt = String(message.body || '').slice(0, 300);
    this.db.prepare(
      'INSERT INTO hr_bookmarks(game_code,owner_code,message_id,subject_code,author,excerpt,channel,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(c, ownerCode, messageId, subjectCode, message.author, excerpt, message.channel, null, this.now());
    return this.bookmarkRow(c, ownerCode, messageId);
  }

  // Attaches (or clears, if note is blank) the owner's own annotation to
  // an already-bookmarked message. Scoped by owner_code in the UPDATE's
  // WHERE clause for the same id-guessing reason as editNote/deleteNote.
  annotateBookmark(c, ownerCode, messageId, note) {
    const trimmed = String(note || '').trim();
    if (trimmed.length > 300) throw new Error('Bookmark note is too long');
    const result = this.db.prepare(
      'UPDATE hr_bookmarks SET note=? WHERE game_code=? AND owner_code=? AND message_id=?'
    ).run(trimmed || null, c, ownerCode, messageId);
    if (result.changes === 0) throw new Error('Bookmark not found');
    return this.bookmarkRow(c, ownerCode, messageId);
  }

  // Every conclave this playerCode has an hr_players row in — the "which
  // games am I in" list for the conclave switcher, so a player never has to
  // remember or bookmark a room code. Spectators are NOT included: spectating
  // never inserts an hr_players row (see the game:spectate handler), so
  // there is nothing persisted to list.
  // Ended games stay listed for `endedWithinMs` (default 24h) so a player can
  // jump back to see the final judgement, but are always sorted after every
  // non-ended game regardless of recency — the switcher is primarily a place
  // to resume play, not a history log.
  listPlayerGames(playerCode,{endedWithinMs=24*60*60*1000}={}){
    const cutoff=this.now()-endedWithinMs;
    const rows=/** @type {any[]} */ (this.db.prepare(`
      SELECT g.code,g.mode,g.phase,g.day_stage,g.status,g.round,g.winner,g.updated_at,g.host_code,
        (SELECT COUNT(*) FROM hr_players hp2 WHERE hp2.game_code=g.code) AS player_count,
        (SELECT COUNT(*) FROM hr_players hp2 WHERE hp2.game_code=g.code AND hp2.alive=1) AS alive_count
      FROM hr_players hp JOIN hr_games g ON g.code=hp.game_code
      WHERE hp.player_code=? AND (g.status!='ended' OR g.updated_at>=?)
      ORDER BY (g.status='ended') ASC, g.updated_at DESC
    `).all(playerCode,cutoff));
    return rows.map(r=>({code:r.code,mode:r.mode,phase:r.phase,dayStage:r.day_stage,status:r.status,round:r.round,winner:r.winner,updatedAt:r.updated_at,playerCount:r.player_count,aliveCount:r.alive_count,isHost:r.host_code===playerCode}));
  }
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
  // Q31: scaled-cost roles (e.g. Interrogator) need THIS game's actual
  // roster size to show an exact per-tier cost — gameConfig.js's boot-time
  // render has no game yet, so it renders a table-size range instead (see
  // abilityText.js). Re-render with the live count wherever a player
  // actually reads their dossier; every other role is returned unchanged.
  roleForDisplay(role,playerCount){if(!role||!role.scaledCostKey)return role;return{...role,ability:renderAbility(role,this.config.drift,{playerCount})};}
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
    const code=generateRoomCode(this.codes(),6),now=this.now(),dayMs=mode==='async'?this.config.phases.ASYNC_PHASE_MS:(Number(options.dayMs)||this.config.phases.SYNC_DAY_MS),nightMs=mode==='async'?this.config.phases.ASYNC_PHASE_MS:(Number(options.nightMs)||this.config.phases.SYNC_NIGHT_MS),max=Math.max(1,Number(options.maxDrift)||this.config.drift.MAX_DRIFT),hintProfile=this.config.hintProfiles[options.hintProfile] ? options.hintProfile : 'default';
    const rawDayStart=Number(options.dayStartMinuteUtc),dayStartMinuteUtc=mode==='async'?Math.max(0,Math.min(1439,Number.isFinite(rawDayStart)?Math.round(rawDayStart):this.config.phases.DEFAULT_DAY_START_MINUTE_UTC)):null;
    this.db.prepare('INSERT INTO hr_games(code,host_code,mode,day_ms,night_ms,max_drift,hint_profile,warp_taint_visible,day_start_minute_utc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(code,playerCode,mode,dayMs,nightMs,max,hintProfile,0,dayStartMinuteUtc,now,now);
    this.db.prepare('INSERT INTO hr_players(game_code,player_code,name,seat,joined_at) VALUES(?,?,?,?,?)').run(code,playerCode,sanitizePlayerName(name),0,now); return {code,state:this.state(code,playerCode)};
  }
  // Admin-only: give up a seat you already hold in a lobby you're already
  // in, converting to the same seatless full-visibility mode game:spectate/
  // game:state silently upgrade into — the "I want to run a bot game
  // without playing in it" path. Lobby-phase-only, same as kick(); host_code
  // is left pointing at the vacated code (nobody resolves as host to real
  // players from then on) rather than reassigned.
  vacateSeat(c,p){
    this.requireAdmin(p);
    const g=this.requireGame(c);
    if(g.phase!=='lobby')throw new Error('You can only vacate your seat while still in the lobby');
    this.requirePlayer(c,p);
    this.db.prepare('DELETE FROM hr_players WHERE game_code=? AND player_code=?').run(c,p);
    return this.adminState(c);
  }
  join({code,playerCode,name}){const g=this.requireGame(code);let p=this.player(code,playerCode);if(!p){if(g.phase!=='lobby')throw new Error('Game already started');const count=this.players(code).length;if(count>=this.config.rules.MAX_PLAYERS)throw new Error('Game is full');this.db.prepare('INSERT INTO hr_players(game_code,player_code,name,seat,joined_at) VALUES(?,?,?,?,?)').run(code,playerCode,sanitizePlayerName(name),count,this.now());}else this.db.prepare('UPDATE hr_players SET connected=1 WHERE game_code=? AND player_code=?').run(code,playerCode);return this.state(code,playerCode);}
  disconnect(playerCode,gameCode){if(gameCode)this.db.prepare('UPDATE hr_players SET connected=0 WHERE game_code=? AND player_code=?').run(gameCode,playerCode);else this.db.prepare('UPDATE hr_players SET connected=0 WHERE player_code=?').run(playerCode);}
  // Explicit "Leave conclave" — distinct from disconnect() (a dropped
  // socket, reconnectable with the same player code). Still-in-lobby games
  // keep the leaver's hr_players row on a plain leave (that row is exactly
  // what lets them return with the same code, and it's what the conclave
  // switcher/roster show while they're gone) — UNLESS they were the only
  // row left, in which case there is nothing to return TO: the lobby is
  // disbanded outright rather than orphaned as an empty shell that would
  // otherwise sit forever in nobody's roster and nobody's switcher.
  // Scoped to the lobby on purpose — an active or ended game keeps its
  // record regardless of who's still connected.
  leave(c,p){
    const g=this.requireGame(c);
    if(g.phase==='lobby'&&this.player(c,p)&&this.players(c).length<=1){this.adminDeleteGame(c);return{disbanded:true};}
    this.disconnect(p,c);
    return{disbanded:false};
  }
reconnect(c,p){this.requirePlayer(c,p);this.db.prepare('UPDATE hr_players SET connected=1 WHERE game_code=? AND player_code=?').run(c,p);return this.state(c,p);}
  kick(c,hostCode,targetCode){const g=this.requireHost(c,hostCode);const target=this.requirePlayer(c,targetCode);if(target.player_code===hostCode)throw new Error('Host cannot kick themselves');if(g.phase!=='lobby')throw new Error('Kick is only allowed in the lobby');this.db.prepare('DELETE FROM hr_players WHERE game_code=? AND player_code=?').run(c,targetCode);return this.state(c,hostCode);}
  ready(c,p,value){this.requirePlayer(c,p);this.db.prepare('UPDATE hr_players SET ready=? WHERE game_code=? AND player_code=?').run(value===undefined?1:+!!value,c,p);return this.state(c,p);}
  /**
   * @param {object} [params]
   * @param {number} [params.maxDrift]
   * @param {number} [params.dayMs]
   * @param {number} [params.nightMs]
   * @param {{source:'preset'|'custom',presetId?:string,roster?:string[],confirmedWarnings?:string[],manualAssignments?:Record<string,string>}} [params.composition]
   */
  start(c,p,params={}){const{maxDrift,dayMs,nightMs,composition}=params;
    const g=this.requireHostOrAdmin(c,p),players=this.players(c);
    if(g.phase!=='lobby')throw new Error('Already started');
    const{MIN_PLAYERS,MAX_PLAYERS}=this.config.rules;
    if(players.length<MIN_PLAYERS||players.length>MAX_PLAYERS)throw new Error(`Games require ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
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

    const assigned=(this.isAdmin(p)&&composition?.manualAssignments&&Object.keys(composition.manualAssignments).length)
      ?resolveManualAssignment({ids,players,manualAssignments:composition.manualAssignments})
      :shuffle(ids);
    // Async mode: day/night are locked at 12h regardless of what's passed
    // in (defense in depth, same as configure()). Day 1's deadline is the
    // next occurrence of Night's start (day-start + 12h) rather than a
    // flat 12h from "now" — so Day 1 can run anywhere from a few minutes
    // up to just under 24h depending on when the host actually clicks
    // start relative to that wall-clock time, but every phase after it
    // lands exactly on the host's chosen schedule, forever (see
    // nextScheduleBoundary above).
    const resolvedDayMs=g.mode==='async'?this.config.phases.ASYNC_PHASE_MS:Math.max(this.config.phases.PHASE_MS_FLOOR_START,Math.min(this.config.phases.PHASE_MS_CEILING,Number(dayMs)||this.config.phases.SYNC_DAY_MS));
    const resolvedNightMs=g.mode==='async'?this.config.phases.ASYNC_PHASE_MS:Math.max(this.config.phases.PHASE_MS_FLOOR_START,Math.min(this.config.phases.PHASE_MS_CEILING,Number(nightMs)||this.config.phases.SYNC_NIGHT_MS));
    const startDeadline=g.mode==='async'?nextScheduleBoundary(this.now(),g.day_start_minute_utc??this.config.phases.DEFAULT_DAY_START_MINUTE_UTC):this.now()+resolvedDayMs;
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
      players.forEach((x,i)=>{const r=this.role(assigned[i]);if(codenames)this.db.prepare('UPDATE hr_players SET role_id=?,faction=?,drift=0,alive=1,cripple_tier=0,codename=?,display_order=? WHERE game_code=? AND player_code=?').run(r.id,r.faction,codenames[i],displayOrder[i],c,x.player_code);else this.db.prepare('UPDATE hr_players SET role_id=?,faction=?,drift=0,alive=1,cripple_tier=0,display_order=? WHERE game_code=? AND player_code=?').run(r.id,r.faction,displayOrder[i],c,x.player_code);});
      this.db.prepare("UPDATE hr_games SET phase='day',day_stage='vote',status='active',round=1,max_drift=?,day_ms=?,night_ms=?,deadline=?,updated_at=? WHERE code=?").run(Math.max(1,Math.min(this.config.phases.MAX_DRIFT_CEILING,Number(maxDrift)||g.max_drift)),resolvedDayMs,resolvedNightMs,startDeadline,this.now(),c);
      // Wipe lobby chatter so the live game starts with a clean transcript.
      this.db.prepare("DELETE FROM hr_messages WHERE game_code=?").run(c);
      this.system(c,'Roles sealed. Day 1 begins — review your dossier and discuss.');
    })();
    players.forEach((x,i)=>{const r=this.role(assigned[i]);this.privateSystem(c,x.player_code,`Your role is ${r.displayName}. ${r.objective}`,null,{autoBookmark:false});this.emitAnnouncement(c,{type:'role-reveal',title:'YOUR DOSSIER',message:`You are a ${r.displayName}. ${r.objective}`,role:r.displayName,objective:r.objective,faction:r.faction,round:1,phase:'day',targetCode:x.player_code});});
    return this.player(c,p)?this.state(c,p):this.adminState(c);
  }
  configure(c,p,options={}){const g=this.requireGame(c);if(g.phase!=='lobby')throw new Error('Game has already started');this.requireHostOrAdmin(c,p);
    // Async mode: day/night are locked at 12h — any client-supplied
    // dayMs/nightMs is ignored (defense in depth; the lobby UI doesn't even
    // offer those fields for async). Host instead tunes day_start_minute_utc.
    const isAsync=g.mode==='async';
    const dayMs=isAsync?this.config.phases.ASYNC_PHASE_MS:Math.max(this.config.phases.PHASE_MS_FLOOR_CONFIGURE,Math.min(this.config.phases.PHASE_MS_CEILING,Number(options.dayMs)||g.day_ms));
    const nightMs=isAsync?this.config.phases.ASYNC_PHASE_MS:Math.max(this.config.phases.PHASE_MS_FLOOR_CONFIGURE,Math.min(this.config.phases.PHASE_MS_CEILING,Number(options.nightMs)||g.night_ms));
    const maxDrift=Math.max(1,Math.min(this.config.phases.MAX_DRIFT_CEILING,Number(options.maxDrift)||g.max_drift)),anonymized=options.anonymized!==undefined?(options.anonymized?1:0):g.anonymized;
    const warpTaintVisible=options.warpTaintVisible!==undefined?(options.warpTaintVisible?1:0):g.warp_taint_visible;
    const deathReveal=DEATH_REVEALS.includes(options.deathReveal)?options.deathReveal:g.death_reveal;
    const rawDayStart=Number(options.dayStartMinuteUtc);
    const dayStartMinuteUtc=isAsync?(Number.isFinite(rawDayStart)?Math.max(0,Math.min(1439,Math.round(rawDayStart))):(g.day_start_minute_utc??this.config.phases.DEFAULT_DAY_START_MINUTE_UTC)):g.day_start_minute_utc;
    this.db.prepare('UPDATE hr_games SET day_ms=?,night_ms=?,max_drift=?,anonymized=?,warp_taint_visible=?,day_start_minute_utc=?,death_reveal=?,updated_at=? WHERE code=?').run(dayMs,nightMs,maxDrift,anonymized,warpTaintVisible,dayStartMinuteUtc,deathReveal,this.now(),c);return this.player(c,p)?this.state(c,p):this.adminState(c);}
  advance(c,p){this.requireHost(c,p);return this.resolve(c,true);}
  resolve(c,force=false){const g=this.requireGame(c);if(g.status!=='active')throw new Error('Game is not active');if(!force&&g.deadline&&g.deadline>this.now())throw new Error('Phase is active');if(g.phase==='night')this.resolveNight(g);else if(g.phase==='day')this.resolveDay(g);return this.game(c);}
  setPhase(c,phase,round,dayStage=null){const g=this.game(c),duration=phase==='night'?g.night_ms:g.day_ms,deadline=this.now()+duration,stage=phase==='day'?(dayStage||'vote'):dayStage;this.db.prepare('UPDATE hr_games SET phase=?,round=?,day_stage=?,deadline=?,updated_at=? WHERE code=?').run(phase,round,stage,deadline,this.now(),c);if(phase==='day'){this.db.prepare('UPDATE hr_players SET cripple_tier=0,tier1_until_round=NULL WHERE game_code=? AND cripple_tier=1 AND tier1_until_round<?').run(c,round);const votingEnabled=round>=this.config.rules.day.FIRST_VOTING_ROUND;this.system(c,votingEnabled?`Day ${round}: vote for a target or stand down.`:`Day ${round} begins — no vote today. Introduce yourself and observe.`);}
  // Bot prompts: nudge bot sockets to act. Night → night_action_prompt; voting-enabled day → day_vote_prompt. Day 1 has no vote (Q28) → no prompt.
  const aliveBots=this.players(c).filter(p=>p.alive&&p.is_bot);
  if(phase==='night')for(const p of aliveBots)this.emitBotPrompt(c,{kind:'night_action_prompt',playerCode:p.player_code,round,deadline});
  else if(phase==='day'&&round>=this.config.rules.day.FIRST_VOTING_ROUND){const alivePlayers=this.players(c).filter(x=>x.alive);for(const p of aliveBots){const targets=alivePlayers.filter(x=>x.player_code!==p.player_code).map(x=>x.player_code);this.emitBotPrompt(c,{kind:'day_vote_prompt',playerCode:p.player_code,round,votingEnabled:true,deadline,legalTargets:targets});}}}
  resolveNight(g){const c=g.code,players=this.players(c).filter(p=>p.alive),totalPlayers=this.players(c).length,actions=this.actions(c,g.round),traps=new Map(actions.filter(a=>a.kind==='boobytrap').map(a=>[a.target_code,a]));const protectedIds=new Set(),bodyguards=new Map(),nightCharges=new Map();
    // Q31 (dispatch 2026-07-27-q31-interrogator-cost.md): roles flagged with
    // scaledCostKey pay cost = round(max(floor, base/players)) instead of a
    // flat role.driftWeight, scaled against the TOTAL roster size (not the
    // alive-only count) — the "cell" a scaled role is working against
    // doesn't shrink as people die, it's the table size chosen at setup.
    for(const p of players){const a=actions.find(x=>x.actor_code===p.player_code),role=this.role(p.role_id);if(p.skip_next_night){this.db.prepare('UPDATE hr_players SET skip_next_night=0 WHERE game_code=? AND player_code=?').run(c,p.player_code);continue;}if(!a){this.changeDrift(c,p.player_code,this.config.drift.NIGHTLY_SLEEP_RECOVERY,'sleep');continue;}if(a.kind==='kill'||a.kind==='blood-ritual'||a.kind==='possess'||a.kind==='sermon'||a.kind==='corrupt-sermon')continue;const cost=role.scaledCostKey?resolveScaledCost(this.config.drift.scaledCosts,role.scaledCostKey,'t'+(Number(String(a.variant||'T1').replace('T',''))||1),totalPlayers):role.driftWeight;this.changeDrift(c,p.player_code,cost,'night-action');if(cost>0)nightCharges.set(p.player_code,(nightCharges.get(p.player_code)||0)+cost);}
    // H7 Poxwalker cure: a landed protect cleanses whoever it lands on. There
    // is no separate `cure` action — ruled 2026-08-03, deliberately diverging
    // from poxwalker.md v1.0.0's one-shot T3 Chirurgeon cure (see
    // POXWALKER_PLAN.md § 9; the source spec needs a v1.0.1 re-lock).
    // Consequences that are load-bearing here:
    //   - SILENT. clearPlague emits nothing, and reportNightActions still
    //     sends the same "Last night you protected X." either way. The
    //     Chirurgeon must not be able to read plague state off their own
    //     action — same law as "does not learn whether their protection
    //     fired" (see the comment above reportNightActions).
    //   - A trapped protect cures nothing, exactly as it protects nothing.
    //   - Runs BEFORE the infect pass below, so a protect cannot pre-empt an
    //     infection landing the same night — it only lifts plague already
    //     carried. And before the plague pass, so a cure stops tonight's tick.
    for(const a of actions.filter(x=>x.kind==='protect'))if(!this.trapBlocks(c,g,a,traps)){protectedIds.add(a.target_code);this.clearPlague(c,g,a.target_code);}
    for(const a of actions.filter(x=>x.kind==='bodyguard'))if(!this.trapBlocks(c,g,a,traps))bodyguards.set(a.target_code,a.actor_code);
    // H7 Poxwalker infect. Only sets Patient Zero — the +3 self-drift is
    // charged by the generic per-action loop above (kind 'infect' is not in
    // its exclusion list), so nothing is charged here or this would double.
    // The one shot is consumed on use regardless of outcome, matching Animus:
    // a trapped infect still burns the game's only infection. g.patient_zero
    // is updated in memory too — resolvePlague below reads it this same pass.
    for(const a of actions.filter(x=>x.kind==='infect')){if(!this.player(c,a.actor_code)?.alive)continue;this.incrementUsage(c,a.actor_code,'infect');if(this.trapBlocks(c,g,a,traps))continue;if(!this.player(c,a.target_code)?.alive)continue;this.db.prepare('UPDATE hr_games SET patient_zero=? WHERE code=?').run(a.target_code,c);g.patient_zero=a.target_code;this.event(c,'night-action',{round:g.round,kind:'poxwalker:infect',actor:a.actor_code,target:a.target_code});}
    for(const a of actions.filter(x=>['sermon','corrupt-sermon'].includes(x.kind))){if(this.trapBlocks(c,g,a,traps))continue;const s=this.config.drift.sermons[a.variant],actorRole=this.role(this.player(c,a.actor_code).role_id);
      // Warp Litany's drift gate, enforced here rather than at submission so a
      // Heretic Priest can't probe a target's hidden drift by reading the ack.
      // Below the gate the whole sermon fizzles: no self cost, no target drift,
      // no usage burned, and no message to either side (heretic-kit.md v1.4.0).
      if(a.kind==='corrupt-sermon'&&a.variant==='warp-litany'&&(this.player(c,a.target_code)?.drift??0)<(s.target_zone_min_drift??10))continue;
      const selfCost=actorRole.scaledCostKey?resolveScaledCost(this.config.drift.scaledCosts,actorRole.scaledCostKey,a.variant,totalPlayers):s.self;this.changeDrift(c,a.actor_code,selfCost,'sermon-self');if(selfCost>0)nightCharges.set(a.actor_code,(nightCharges.get(a.actor_code)||0)+selfCost);this.changeDrift(c,a.target_code,s.target,'sermon-target');this.incrementUsage(c,a.actor_code,a.variant);}
    const autoKills=[];for(const a of actions.filter(x=>['investigate','drift-hint','warp-read'].includes(x.kind))){if(this.trapBlocks(c,g,a,traps))continue;const result=this.resolveIntel(c,a,g);if(result?.autoKill)autoKills.push(result);}for(const k of autoKills){const victim=this.player(c,k.targetCode);if(!victim?.alive)continue;this.db.prepare("UPDATE hr_players SET alive=0,death_cause='execute-on-sight' WHERE game_code=? AND player_code=?").run(c,k.targetCode);const victimName=this.displayName(g,victim);this.system(c,`${victimName} was executed by Interrogator. Confirmed warp-touched.`);this.system(c,`${victimName}'s alignment: ${victim.faction}.`);if(k.actorCode)this.privateSystem(c,k.actorCode,`Your scan executed ${victimName}. Warp-touched confirmed.`,{intelKind:'execute_on_sight',action:'interrogate',target:k.targetCode,zone:k.zone,faction:k.faction});this.emitAnnouncement(c,{type:'execution',title:'SUMMARY EXECUTION',message:`${victimName} was executed by order of the Interrogator.`,victim:{name:victimName,faction:victim.faction},round:g.round,phase:'night'});for(const w of players)this.changeDrift(c,w.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}
    for(const a of actions.filter(x=>x.kind==='heretical-catalyst')){const target=this.player(c,a.target_code);if(traps.has(a.target_code))this.changeDrift(c,a.actor_code,this.config.drift.TRAP_DRIFT,'trap');if(target?.drift>=g.max_drift&&!protectedIds.has(a.target_code)){this.clearPlague(c,g,a.target_code);this.db.prepare("UPDATE hr_players SET faction='heretic' WHERE game_code=? AND player_code=?").run(c,a.target_code);this.privateSystem(c,a.target_code,'The catalyst takes hold. Your loyalty has burned away.');}}
    // H1 Murderer drift-gated kill (heretic-kit.md v1.5.0): self-drift cost is
    // charged HERE (not in the generic per-player loop above) so the gate can
    // be checked against the pre-kill drift value. Only the Murderer is
    // gated — any other kill-capable role (e.g. Sanctioned Psyker) keeps its
    // prior unconditional-charge behavior, just relocated into this loop.
    for(const kill of actions.filter(x=>x.kind==='kill')){const killer=this.player(c,kill.actor_code);if(!killer?.alive)continue;const killRole=this.role(killer.role_id),killCost=killRole.driftWeight;
      if(killer.role_id==='murderer'&&killer.drift+killCost>g.max_drift){const zone=driftZone(this.config.drift,killer.drift).id;this.changeDrift(c,kill.target_code,this.config.drift.MURDERER_GATE_TARGET_DRIFT,'murderer-gate-witnessed');this.privateSystem(c,kill.actor_code,murdererGateCue(zone),{intelKind:'murderer_kill_gated',zone});this.event(c,'night-action',{round:g.round,kind:'murderer:kill-gated',actor:kill.actor_code,target:kill.target_code});continue;}
      this.changeDrift(c,kill.actor_code,killCost,'night-action');nightCharges.set(kill.actor_code,(nightCharges.get(kill.actor_code)||0)+killCost);
      if(traps.has(kill.actor_code)){this.changeDrift(c,kill.actor_code,this.config.drift.TRAP_DRIFT,'trap');continue;}if(traps.has(kill.target_code))this.changeDrift(c,kill.actor_code,this.config.drift.TRAP_DRIFT,'trap');let victim=kill.target_code,bodyguardRedirected=false;if(bodyguards.has(victim)){const guardCode=bodyguards.get(victim);this.privateSystem(c,guardCode,'You absorbed a strike meant for your proxy and died.');victim=guardCode;bodyguardRedirected=true;}if(!bodyguardRedirected&&protectedIds.has(kill.target_code))victim=null;if(victim){this.db.prepare("UPDATE hr_players SET alive=0,death_cause='murder' WHERE game_code=? AND player_code=?").run(c,victim);const victimName=this.displayName(g,this.player(c,victim));
        // The public message below is deliberately the ordinary 'slain' flavor.
        // A deathFlavor `bodyguardRedirect` pool once existed for this branch and
        // was deleted: every one of its strings named the protected {target},
        // which would broadcast both that a redirect happened and who was being
        // guarded — leaking exactly what the design below keeps private. Do not
        // reintroduce redirect-specific PUBLIC flavor text here.
        //
        // Arbitrator (roles/arbitrator.md): "both learn the proxy fired" means
        // the guard (already privately told above) and the protected target —
        // NOT the whole table. The public side sees an ordinary death, exactly
        // like any other kill, with no tell that a redirect happened.
        if(bodyguards.has(kill.target_code))this.privateSystem(c,kill.target_code,'Something struck at you in the dark. Someone else took the blow meant for you.');
        const slainBody=this.flavor('slain',{victim:victimName});this.system(c,slainBody,{eventType:'night-kill'});this.emitAnnouncement(c,{type:'kill',title:'SLAIN IN THE NIGHT',message:slainBody,victim:{name:victimName},round:g.round,phase:'night'});
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
    for(const sv of actions.filter(x=>x.kind==='blood-ritual')){const attacker=this.player(c,sv.actor_code);if(!attacker?.alive)continue;const brCost=this.config.drift.BLOOD_RITUAL_ATTACKER_COST;this.changeDrift(c,sv.actor_code,brCost,'night-action');nightCharges.set(sv.actor_code,(nightCharges.get(sv.actor_code)||0)+brCost);if(traps.has(sv.target_code))this.changeDrift(c,sv.actor_code,this.config.drift.TRAP_DRIFT,'trap');
      const previous=this.previousBloodRitual(c,g.round),escalate=previous?.outcome==='cripple'&&previous.target===sv.target_code&&this.player(c,sv.target_code)?.alive;
      let victim=sv.target_code,bodyguardRedirected=false;if(bodyguards.has(victim)){const guardCode=bodyguards.get(victim);this.privateSystem(c,guardCode,escalate?'You absorbed a killing blow meant for your proxy and died.':'You absorbed a strike meant for your proxy and were crippled instead.');victim=guardCode;bodyguardRedirected=true;}if(!bodyguardRedirected&&protectedIds.has(sv.target_code))victim=null;
      if(escalate){if(victim){this.db.prepare("UPDATE hr_players SET cripple_tier=3,alive=0,death_cause='blood-ritual' WHERE game_code=? AND player_code=?").run(c,victim);const victimName=this.displayName(g,this.player(c,victim));const slainBody=this.flavor('slain',{victim:victimName});this.system(c,slainBody,{eventType:'night-kill'});this.emitAnnouncement(c,{type:'kill',title:'SLAIN IN THE NIGHT',message:slainBody,victim:{name:victimName},round:g.round,phase:'night'});for(const witness of this.players(c).filter(x=>x.alive))this.changeDrift(c,witness.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}this.event(c,'blood-ritual',{round:g.round,attacker:sv.actor_code,target:sv.target_code,outcome:'kill',landed:!!victim});}
      // tier1_until_round is g.round+1, not g.round: setPhase's T1-recovery
      // check (`cripple_tier=1 AND tier1_until_round<round`) fires on the
      // night->day transition that happens moments later in THIS SAME
      // resolveNight() call. Day-phase torture sets tier1_until_round
      // while still in the day, so it survives the coming night before that
      // check ever runs against it; a night-phase cripple needs the +1 or it
      // recovers in the same breath it was applied.
      else{if(victim){const tier=Math.min(this.config.rules.cripple.MAX_TIER,(Number(this.player(c,victim).cripple_tier)||0)+1);this.db.prepare('UPDATE hr_players SET cripple_tier=?,tier1_until_round=? WHERE game_code=? AND player_code=?').run(tier,tier===1?g.round+1:null,c,victim);const victimName=this.displayName(g,this.player(c,victim));const crippleBody=this.flavor('bloodRitualCripple',{victim:victimName});this.privateSystem(c,victim,crippleBody,{target:victim});this.emitAnnouncement(c,{type:'blood-ritual-cripple',title:'BROKEN IN THE NIGHT',message:crippleBody,victim:{name:victimName},round:g.round,phase:'night',targetCode:victim});}this.event(c,'blood-ritual',{round:g.round,attacker:sv.actor_code,target:sv.target_code,outcome:'cripple',landed:!!victim});}}
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
    for(const pos of actions.filter(x=>x.kind==='possess')){const actorPlayer=this.player(c,pos.actor_code);if(!actorPlayer?.alive)continue;const possRole=this.role(actorPlayer.role_id);nightCharges.set(pos.actor_code,(nightCharges.get(pos.actor_code)||0)+possRole.driftWeight);this.incrementUsage(c,pos.actor_code,'possess');if(traps.has(pos.actor_code)){this.changeDrift(c,pos.actor_code,this.config.drift.TRAP_DRIFT,'trap');continue;}const target=this.player(c,pos.target_code);if(!target?.alive)continue;if(traps.has(pos.target_code))this.changeDrift(c,pos.actor_code,this.config.drift.TRAP_DRIFT,'trap');const zone=driftZone(this.config.drift,target.drift).id;if(zone==='red'&&!protectedIds.has(pos.target_code)){this.db.prepare('UPDATE hr_players SET possessed_by=?,skip_next_night=1 WHERE game_code=? AND player_code=?').run(pos.actor_code,c,pos.target_code);this.privateSystem(c,pos.actor_code,`The summoning takes hold. The Neverborn reaches across the Warp and finds purchase in ${this.displayName(g,target)}. Speak as them tomorrow.`,{intelKind:'animus_possess',outcome:'success',target:pos.target_code});this.privateSystem(c,pos.target_code,'Something cold moves behind your eyes. You cannot speak tomorrow.');}else{this.privateSystem(c,pos.actor_code,'You reach for the Warp. The Neverborn finds no purchase. The ritual wastes.',{intelKind:'animus_possess',outcome:'fail'});}}
    // H7 Poxwalker plague tick — LAST of the drift passes, after every action
    // has resolved and paid its own cost, because the spec prices visitor
    // drift as "on top of their own action's normal drift cost" and evaluates
    // the black-zone roll "after applying drift at night-end". Deliberately
    // not folded into nightCharges: the proximity siphon prices night actions,
    // and the plague is not one.
    this.resolvePlague(c,g,actions);
    applyProximitySiphon(this.players(c),nightCharges,this.config.rules.proximitySiphon,(pc,delta)=>this.changeDrift(c,pc,delta,'proximity-siphon'));
    this.reportNightActions(c,g,actions,players);
    if(!this.finishIfWon(c)){this.setPhase(c,'day',g.round+1,'vote');}}
  // "What you did last night" — resolveIntel already tells a scanning actor
  // their result; every other night kind (protect, bodyguard, boobytrap,
  // kill, sermon/corrupt-sermon) resolves completely silently today, so
  // nothing lands in the actor's dossier even though they made a real choice
  // (bugfix-round §3b). One private line per actor, auto-filed under their
  // target as an own_action entry.
  //
  // Built from the RAW submitted action row, never from how it resolved —
  // the line names only the target the actor already chose, nothing the
  // engine decided. That is the hard constraint (loyalist-kit.md: "Chirurgeon
  // does not learn whether their protection fired" — they "learn only that
  // they used their night action"): the SAME line is sent whether a protect
  // landed or was wasted, whether a kill connected, was blocked by a
  // Chirurgeon, redirected onto an Arbitrator, or gated by the Murderer's
  // drift cap, and whether a corrupt-sermon connected or fizzled silently
  // below Warp Litany's drift floor (the branch above that deliberately
  // sends "no message to either side" so a Heretic Priest can't probe a
  // target's hidden drift by reading the ack — this report must never become
  // a second channel for that same probe, so it is unconditional on outcome).
  //
  // possess, interrogate, drift-hint and heretical-catalyst are excluded:
  // the first three already carry their own actor-facing message (resolveIntel,
  // the possess loop above); heretical-catalyst and blood-ritual currently
  // tell their ACTOR nothing at all, on either success or failure — a
  // pre-existing gap this method does not attempt to close (see report).
  reportNightActions(c,g,actions,players){
    const VERB={protect:'protected',bodyguard:'moved to guard',boobytrap:'set a trap for',sermon:'preached to','corrupt-sermon':'preached to',kill:'moved against',infect:'breathed the pox over'};
    for(const a of actions){const verb=VERB[a.kind];if(!verb)continue;const target=this.player(c,a.target_code);if(!target)continue;this.privateSystem(c,a.actor_code,`Last night you ${verb} ${this.displayName(g,target)}.`,{target:a.target_code},{ownAction:true});}
    // Sleep only counts as a CHOICE when nothing blocked the actor from
    // choosing otherwise — skip_next_night (torture, possession) means the
    // engine took the night away from them, not that they rested; telling
    // them "you slept" there would misstate what happened, so they get no
    // report at all rather than a misleading one.
    for(const p of players){if(p.skip_next_night)continue;if(actions.some(a=>a.actor_code===p.player_code))continue;this.privateSystem(c,p.player_code,`You slept. Drift eased by ${Math.abs(this.config.drift.NIGHTLY_SLEEP_RECOVERY)}.`,null,{ownAction:true});}
  }
  // H7 Poxwalker (roles/poxwalker.md v1.0.0). Persistent contagion: Patient
  // Zero climbs, and anyone who has ever TOUCHED Patient Zero — visited them
  // with a night action, or been the target of Patient Zero's own — keeps
  // climbing a milder tick for the rest of the game. Detection is purely
  // mechanical: hr_actions already stores one (actor, kind, target) row per
  // actor per round, so "who visited Patient Zero tonight" is a filter over
  // this round's rows and needs no new plumbing.
  //
  // Carrier marking is CUMULATIVE and never re-derived: once marked, a player
  // carries it until cured individually, converted, or dead. That is what makes
  // losing the source survivable for the plague — new infections stop (the
  // visit scan below only runs while a live source exists) but existing
  // carriers tick on regardless.
  //
  // Note there is deliberately NO `if (!g.patient_zero) return` guard here.
  // Losing the source — to a cure or to a coffin — must not stop the carriers,
  // and an early return keyed on patient_zero would silently do exactly that
  // for the cure path (death leaves patient_zero set; a cure nulls it).
  resolvePlague(c,g,actions){
    const d=this.config.drift,pz=g.patient_zero?this.player(c,g.patient_zero):null;
    if(pz?.alive){
      const touched=new Set();
      for(const a of actions){
        // The infection itself is not a visit. Without this the Poxwalker
        // catches their own plague the moment they cast it — the infect row
        // targets Patient Zero like any other action — and spec is explicit
        // that the Poxwalker is the carrier, not the infected.
        if(!a.target_code||a.kind==='infect')continue;
        if(a.target_code===g.patient_zero&&a.actor_code!==g.patient_zero)touched.add(a.actor_code);
        if(a.actor_code===g.patient_zero)touched.add(a.target_code);
      }
      for(const code of touched)if(this.player(c,code)?.alive)this.db.prepare('UPDATE hr_players SET plague_carrier=1 WHERE game_code=? AND player_code=?').run(c,code);
      this.changeDrift(c,g.patient_zero,d.PLAGUE_SOURCE_DRIFT,'plague-source');
    }
    const carriers=this.players(c).filter(p=>p.alive&&p.plague_carrier&&p.player_code!==g.patient_zero);
    if(!carriers.length&&!pz?.alive)return;
    for(const p of carriers)this.changeDrift(c,p.player_code,d.PLAGUE_CARRIER_DRIFT,'plague-carrier');
    // Black-zone roll. No death — the plague disables. Re-rolled every night,
    // but skipped entirely for anyone already carrying any cripple tier, which
    // is what "no stacking, just binary on/off" means here AND what keeps the
    // roll from ever downgrading permanent (tier 2+) torture damage. Tier 1
    // with tier1_until_round = round+1 is the same one-night cripple Blood
    // Ritual uses; see the comment in that branch for why it is +1 and not
    // g.round (setPhase's T1-recovery check fires moments later in this call).
    for(const p of this.players(c)){
      if(!p.alive||(Number(p.cripple_tier)||0)>0)continue;
      if(p.player_code!==g.patient_zero&&!p.plague_carrier)continue;
      if(driftZone(d,p.drift).id!=='black')continue;
      if(this.random()>=d.PLAGUE_BLACK_CRIPPLE_CHANCE)continue;
      this.db.prepare('UPDATE hr_players SET cripple_tier=1,tier1_until_round=? WHERE game_code=? AND player_code=?').run(g.round+1,c,p.player_code);
      this.privateSystem(c,p.player_code,'Your body will not answer you. Whatever is in you has the reins tonight.');
      this.event(c,'plague-cripple',{round:g.round,playerCode:p.player_code});
    }
  }
  // Lifts the plague off ONE player, and only that player. SILENT by contract —
  // the only caller is the protect pass, and the Chirurgeon must never be able
  // to read plague state off their own action (see reportNightActions' comment).
  //
  // Curing the source stops the source: no more +2 on them, and no more new
  // carriers, because the visit scan needs a live Patient Zero. It does NOT
  // cleanse anyone already carrying it — they keep climbing and each has to be
  // cured on their own. This is a designer ruling (2026-08-04) that overrides
  // poxwalker.md v1.0.0's "full plague termination" line, and it makes a cure
  // and a coffin behave identically: either way the source is gone and the
  // contagion outlives it. See POXWALKER_PLAN.md § 9.
  //
  // Cripple lifting is capped at tier 1 on purpose. Plague-cripple and
  // torture-cripple share cripple_tier, so an uncapped clear would let a
  // nightly protect launder permanent lynch damage off an ally and defeat the
  // Tiered Lynch entirely. Tier 1 is temporary either way — it expires at the
  // next day transition — so clearing it is worth at most one night, whatever
  // set it. Tier 2+ is never touched.
  clearPlague(c,g,code){
    if(!code)return;
    if(g.patient_zero===code){this.db.prepare('UPDATE hr_games SET patient_zero=NULL WHERE code=?').run(c);g.patient_zero=null;}
    else if(!this.player(c,code)?.plague_carrier)return;
    this.db.prepare('UPDATE hr_players SET plague_carrier=0 WHERE game_code=? AND player_code=?').run(c,code);
    this.db.prepare('UPDATE hr_players SET cripple_tier=0,tier1_until_round=NULL WHERE game_code=? AND player_code=? AND cripple_tier=1').run(c,code);
  }
  trapBlocks(c,g,a,traps){if(!traps.has(a.target_code))return false;this.changeDrift(c,a.actor_code,this.config.drift.TRAP_DRIFT,'trap');const trap=traps.get(a.target_code);this.privateSystem(c,trap.actor_code,`Your trap caught ${this.displayName(g,this.player(c,a.actor_code))} targeting ${this.displayName(g,this.player(c,a.target_code))}.`);return !['kill','heretical-catalyst'].includes(a.kind);}
  resolveIntel(c,a,g){const actor=this.player(c,a.actor_code),target=this.player(c,a.target_code),role=this.role(actor.role_id);if(a.kind==='drift-hint'){const targetZone=driftZone(this.config.drift,target.drift);const rate=intelNoiseRate(this.config.drift,this.config.rules,target.drift,role.driftWeight);const truth=targetZone.id;const zones=this.config.drift.zones;const truthIdx=zones.findIndex(z=>z.id===truth);let shown=truth;if(this.random()<rate){const left=truthIdx>0?truthIdx-1:truthIdx+1;const right=truthIdx<zones.length-1?truthIdx+1:truthIdx-1;
      // Unbiased left/right coin — not a tuning knob, so this 0.5 stays literal.
      const adj=this.random()<0.5?left:right;shown=zones[adj].id;}this.privateSystem(c,a.actor_code,this.hints(c)[shown],{intelKind:'drift-hint',action:'scan_drift',target:a.target_code,zone:shown},{ownAction:true});return{};}
    // L8 Astropath (locked spec, 2026-08-05). Names-only visitor intel, never
    // what a visitor did or their faction — reads hr_actions (the same
    // durable per-round action log the Chirurgeon/Interrogator rotation
    // checks already query, see mechanics/protection.js) via
    // mechanics/astropath.js's helpers. Resolved from inside resolveNight for
    // round g.round, so "the last fully-resolved night" (T1) is g.round-1,
    // and T2/T3's two-night window is [g.round-2, g.round-1] — g.round itself
    // is the night currently resolving, not history yet.
    if(a.kind==='warp-read'){
      const intensity=Number(String(a.variant||'T1').replace('T',''))||1;
      const nameFor=code=>this.displayName(g,this.player(c,code));
      const targetName=nameFor(a.target_code);
      let text;
      if(intensity===1){
        const visitors=getVisitorsForRound(this.db,c,a.target_code,g.round-1).map(nameFor);
        text=visitors.length?`On the faintest current of the Warp, you taste ${visitors.join(', ')} lingering on ${targetName}'s shadow — recent arrivals.`:`No one crossed ${targetName}'s path last night.`;
      }else if(intensity===2){
        const visitors=getVisitorsUnion(this.db,c,a.target_code,g.round-2,g.round-1).map(nameFor);
        text=visitors.length?`Across two nights of memory, the residue on ${targetName} pulls together: ${visitors.join(', ')}. You cannot tell which night each arrived.`:`No one crossed ${targetName}'s path across the last two nights.`;
      }else{
        const recent=getVisitorsForRound(this.db,c,a.target_code,g.round-1).map(nameFor);
        const older=getVisitorsForRound(this.db,c,a.target_code,g.round-2).map(nameFor);
        text=`On the night past, ${recent.length?recent.join(', '):'no one'} moved through ${targetName}. On the night before that, ${older.length?older.join(', '):'no one'} stood where they stood.`;
      }
      this.privateSystem(c,a.actor_code,text,{intelKind:'warp-read',tier:intensity,target:a.target_code},{ownAction:true});
      return{};
    }
    const intensity=Number(String(a.variant||'T1').replace('T',''))||1;const targetZone=driftZone(this.config.drift,target.drift);if(isExecuteOnSight(this.config.rules,intensity,targetZone.id))return{autoKill:true,actorCode:a.actor_code,targetCode:a.target_code,zone:targetZone.id,faction:target.faction};if(intensity===1){const groundTruth=targetZone.id==='green'?'Clean':'Tainted';const isTrue=this.random()<this.config.rules.interrogation.T1_ACCURACY;const display=isTrue?groundTruth:(groundTruth==='Clean'?'Tainted':'Clean');
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
      if(targetZone.id==='green'&&target.tortured_before){this.db.prepare('UPDATE hr_players SET tortured_before=0,mark_public=0 WHERE game_code=? AND player_code=?').run(c,a.target_code);markNote=' Your read is clean enough to absolve them — their torture mark is lifted.';}
      else if(targetZone.id==='red'){if(!target.tortured_before)this.db.prepare('UPDATE hr_players SET tortured_before=1 WHERE game_code=? AND player_code=?').run(c,a.target_code);markNote=' Your read comes back guilty — their next torture will be an execution.';}
      this.privateSystem(c,a.actor_code,`${this.displayName(g,target)} is ${display.toLowerCase()}.${markNote}`,{intelKind:'interrogate',tier:1,target:a.target_code,zone:targetZone.id,result:display.toLowerCase()},{ownAction:true});return{};}const effectiveTier=getEffectiveScanTier(this.config.rules,intensity,targetZone.id);const rate=intelNoiseRate(this.config.drift,this.config.rules,actor.drift,role.driftWeight);if(effectiveTier>=3){const name=this.displayName(g,target);const text=target.faction==='loyalist'?`Confirmed: ${name} is a Loyalist. The Emperor's light is unbroken in them.`:`Confirmed: ${name} is a Heretic. The warp taint is undeniable.`;this.privateSystem(c,a.actor_code,text,{intelKind:'interrogate',tier:intensity,effectiveTier,target:a.target_code,zone:targetZone.id,faction:target.faction},{ownAction:true});return{};}const truth=target.faction==='loyalist';const result=noisyResult(this.config.rules,truth,rate,this.random);let text=result==='unclear'?'You learned nothing.':result?`${this.displayName(g,target)}'s story holds together.`:`${this.displayName(g,target)}'s story does not add up.`;
    // Interrogation-result (faction hint) and drift-zone reading are two
    // INDEPENDENT signals — a flat concatenation ("...does not add up. You
    // sense their drift zone: green.") reads as the zone corroborating the
    // accusation, when a Green Heretic is entirely possible. Appended as its
    // own clause, explicitly flagged as a separate reading, so neither fact
    // is mistaken for evidence about the other. Adds no new information —
    // same two facts the old concatenation carried, meta byte-identical.
    if(effectiveTier>=2){const zoneLabel=targetZone.id.charAt(0).toUpperCase()+targetZone.id.slice(1);text+=` Separately, your own senses read their drift as ${zoneLabel} — a different measure, not a verdict on the story.`;}
    this.privateSystem(c,a.actor_code,text,{intelKind:'interrogate',tier:intensity,effectiveTier,target:a.target_code,zone:effectiveTier>=2?targetZone.id:null,factionHint:result==='unclear'?null:(result?'loyalist':'heretic')},{ownAction:true});return{};}
  resolveDay(g){const votingEnabled=g.round>=this.config.rules.day.FIRST_VOTING_ROUND;if(!votingEnabled){const payload={round:g.round,outcome:'skip',target:null,reason:'day1-no-vote',voterResults:[],witnessedDrift:0,alignmentRevealed:null,crippleTier:null};this.event(g.code,'day-resolution',payload);this.system(g.code,`Day ${g.round} concludes with no vote. The conclave disperses.`);this.applyHereticCap(g.code,g.round);this.resolvePossessionDetonation(g.code);if(!this.finishIfWon(g.code))this.setPhase(g.code,'night',g.round);return payload;}const payload=this.resolveDayVote(g);this.resolvePossessionDetonation(g.code);return payload;}
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
  resolvePossessionDetonation(c){const g=this.game(c),target=this.players(c).find(p=>p.possessed_by&&!p.possession_revealed);if(!target)return;const animusCode=target.possessed_by;this.db.prepare("UPDATE hr_players SET alive=0,drift=0,possession_revealed=1,death_cause='animus' WHERE game_code=? AND player_code=?").run(c,target.player_code);const roleName=target.role_id?this.role(target.role_id).displayName:'Unknown';const targetName=this.displayName(g,target);const revealBody=`${targetName}'s body ruptures. Smoke and warp-light spill from the torn armor. A Neverborn finds its mark. The heretic is exposed.`;this.system(c,revealBody);this.system(c,`${targetName} was ${roleName} (${target.faction}).`);this.emitAnnouncement(c,{type:'neverborn-reveal',title:'THE BODY RUPTURES',message:revealBody,victim:{name:targetName,role:roleName,faction:target.faction,drift:target.drift},round:g.round,phase:'day'});for(const p of this.players(c).filter(x=>x.alive&&x.player_code!==animusCode))this.changeDrift(c,p.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');}
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
    if(skipCount>totalAlive*this.config.rules.day.STAND_DOWN_MAJORITY){this.system(c,`Vote tally — Stand down carried: ${skipCount} of ${totalAlive} voted to stand down. The conclave dispersed.`);return this.skipDay(g,'skip-majority');}
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
    const targetCode=leaderCodes[0],targetPlayerForTally=this.player(c,targetCode),targetName=targetPlayerForTally?this.displayName(g,targetPlayerForTally):'someone',targetVotes=votes.filter(v=>v.choice===targetCode),voterNames=targetVotes.map(v=>{const voter=this.player(c,v.voter_code);return voter?this.displayName(g,voter):'?';}).filter(Boolean),threshold=Math.ceil(totalAlive*this.config.rules.day.EXECUTION_THRESHOLD),markedForEscalation=!!this.player(c,targetCode)?.tortured_before,outcome=(top>=threshold||markedForEscalation)?'lynch':'torture';
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
    const previous=this.previousDayResolution(c,g.round),baseTier=(previous?.outcome==='torture'&&previous.target===targetCode)?previous.crippleTier:(Number(target.cripple_tier)||0),tier=Math.min(this.config.rules.cripple.MAX_TIER,baseTier+1),voters=this.dayVotes(c,g.round).filter(v=>v.choice===targetCode);
    // At Tier 2 (second torture), the body breaks and the role is revealed
    if(tier>=2){
      this.db.prepare("UPDATE hr_players SET cripple_tier=2,alive=0,death_cause='torture' WHERE game_code=? AND player_code=?").run(c,targetCode);
      const targetDisplay=this.displayName(g,target),roleName=target.role_id?this.role(target.role_id).displayName:'Unknown';
      const voterResults=voters.map(v=>({voter:v.voter_code,votedFor:v.choice,driftDelta:0}));
      const reveal=deathReveal(g.death_reveal,roleName,target.faction);
      this.system(c,`${targetDisplay} was tortured and expired under interrogation.`);
      this.system(c,`${targetDisplay} is dead.${reveal.text}`);
      this.emitAnnouncement(c,{type:'torture-death',title:'INTERROGATION DEATH',message:`${targetDisplay} was tortured and expired under interrogation.${reveal.text}`,victim:{name:targetDisplay,role:reveal.role,faction:reveal.faction},round:g.round,phase:'day'});
      for(const p of this.players(c).filter(x=>x.alive))this.changeDrift(c,p.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');
      const payload={round:g.round,outcome:'torture',target:targetCode,voterResults,witnessedDrift:this.config.drift.WITNESSED_VIOLENCE,alignmentRevealed:target.faction,crippleTier:2};
      this.event(c,'day-resolution',payload);
      this.applyHereticCap(c,g.round);
      if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);
      return payload;
    }
    this.db.prepare('UPDATE hr_players SET cripple_tier=?,tier1_until_round=?,skip_next_night=1,tortured_before=1,mark_public=1 WHERE game_code=? AND player_code=?').run(tier,tier===1?g.round:null,c,targetCode);const voterResults=voters.map(v=>({voter:v.voter_code,votedFor:v.choice,driftDelta:0}));const payload={round:g.round,outcome:'torture',target:targetCode,voterResults,witnessedDrift:0,alignmentRevealed:null,crippleTier:tier};this.event(c,'day-resolution',payload);const targetDisplay=this.displayName(g,target);const tortureBody=this.flavor('tortureChamber',{victim:targetDisplay,tier,severity:crippleSeverityLabel(tier)});this.system(c,tortureBody);this.emitAnnouncement(c,{type:'torture-chamber',title:'TORTURE CHAMBER',message:tortureBody,victim:{name:targetDisplay},round:g.round,phase:'day'});this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return payload;}
  applyLynch(g,targetCode){const c=g.code,target=this.player(c,targetCode),votes=this.dayVotes(c,g.round).filter(v=>v.choice===targetCode),voterResults=votes.map(v=>({voter:v.voter_code,votedFor:v.choice,driftDelta:0})),targetDisplay=this.displayName(g,target);this.db.prepare("UPDATE hr_players SET cripple_tier=3,alive=0,death_cause='lynch' WHERE game_code=? AND player_code=?").run(c,targetCode);// A lynch deliberately reveals NOTHING -- not role, not alignment. That is a
    // standing ruling (e6cf9e2 "hide role on lynch, reveal role on torture death"),
    // not drift: it makes torture-as-interrogation a real strategic alternative to
    // lynching, since only the torture path buys you information. rules.md and
    // tiered-lynch.md still say a lynch reveals alignment -- they predate the
    // ruling. Do not wire death_reveal in here without overturning e6cf9e2 first.
    this.system(c,`${targetDisplay} was lynched.`);this.emitAnnouncement(c,{type:'lynch',title:'SENTENCE EXECUTED',message:`${targetDisplay} was lynched.`,victim:{name:targetDisplay},round:g.round,phase:'day'});for(const p of this.players(c).filter(x=>x.alive))this.changeDrift(c,p.player_code,this.config.drift.WITNESSED_VIOLENCE,'witnessed-violence');if(target.faction==='loyalist')for(const result of voterResults){result.driftDelta=this.config.drift.WRONG_LYNCH;this.changeDrift(c,result.voter,this.config.drift.WRONG_LYNCH,'wrong-lynch');}const payload={round:g.round,outcome:'lynch',target:targetCode,voterResults,witnessedDrift:this.config.drift.WITNESSED_VIOLENCE,alignmentRevealed:null,crippleTier:3};this.event(c,'day-resolution',payload);this.applyHereticCap(c,g.round);if(!this.finishIfWon(c))this.setPhase(c,'night',g.round);return payload;}
  applyHereticCap(c,day){if(day!==this.config.drift.HERETIC_CAP_DAY)return;for(const p of this.players(c).filter(x=>x.alive&&x.faction==='heretic'&&x.drift<this.config.drift.HERETIC_DRIFT_CAP))this.changeDrift(c,p.player_code,this.config.drift.HERETIC_CAP_SPIKE,'heretic-cap');}
  vote(c,p,choice,justification=''){const g=this.requireGame(c),v=this.requireAlive(c,p),cleanChoice=String(choice||'');if(g.phase!=='day'||g.round<this.config.rules.day.FIRST_VOTING_ROUND)throw new Error('Voting is closed');
    // H6 Animus: mirrors authorizeChannel's chat block — a possessed player
    // cannot cast their own vote at all (their controller does it for them
    // via voteAs). Client-side this is preempted the same way chat is (the
    // vote UI is disabled while possessed), so this throw is a defensive
    // backstop, not something a normal client ever hits.
    if(v.possessed_by)throw new Error('You are possessed and cannot vote today');
    if(cleanChoice!=='skip')this.requireAlive(c,cleanChoice);
    // Resubmitting the same choice (double-click, retry, etc.) doesn't touch
    // the tally — skip the system message and DB write so "X stood down."
    // doesn't spam the log every time the same vote is re-cast. A
    // justification riding along is still posted though: that's how a voter
    // updates the reasoning behind a vote they've already cast.
    const existingVote=this.db.prepare("SELECT choice FROM hr_votes WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").get(c,g.round,v.player_code);
    if(existingVote&&existingVote.choice===cleanChoice){const cleanJust=justification?String(justification).trim().slice(0,300):null;if(cleanJust)this.db.prepare("UPDATE hr_votes SET justification=? WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").run(cleanJust,c,g.round,v.player_code);return{votes:this.voteState(c),message:justification?this.insertMessage(c,'public',null,p,this.displayName(g,v),`Vote justification: ${String(justification).trim().slice(0,300)}`,'vote'):null};}
    const votePlayer=cleanChoice==='skip'?null:this.player(c,cleanChoice);const targetName=cleanChoice==='skip'?null:(votePlayer?this.displayName(g,votePlayer):'Unknown');const voterDisplay=this.displayName(g,v);const voteMsg=targetName?`${voterDisplay} accused ${targetName}.`:`${voterDisplay} stood down.`;this.system(c,voteMsg);const message=justification?this.insertMessage(c,'public',null,p,voterDisplay,`Vote justification: ${String(justification).trim().slice(0,300)}`,'vote'):null;this.db.prepare('INSERT INTO hr_votes VALUES(?,?,?,?,?,?,?) ON CONFLICT(game_code,round,stage,voter_code) DO UPDATE SET choice=excluded.choice,created_at=excluded.created_at,justification=excluded.justification').run(c,g.round,'target',v.player_code,cleanChoice,this.now(),justification?String(justification).trim().slice(0,300):null);return{votes:this.voteState(c),message};}
  retractVote(c,p){const g=this.requireGame(c),v=this.player(c,p);this.db.prepare("DELETE FROM hr_votes WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").run(c,g.round,p);if(v?.alive)this.system(c,`${this.displayName(g,v)} retracted their accusation.`);return this.voteState(c);}
  // H6 Animus: the vote-side equivalent of sendMessageAs — the possessed
  // target is derived server-side from the live possessed_by record (never
  // client-supplied), so a bot/client can never spoof "vote as" someone it
  // doesn't actually possess. Writes under the TARGET's own voter_code, so
  // it's indistinguishable from a normal vote to everyone else at the table.
  voteAs(c,p,choice,justification=''){const g=this.requireGame(c);if(g.phase!=='day'||g.round<this.config.rules.day.FIRST_VOTING_ROUND)throw new Error('Voting is closed');this.requireAlive(c,p);const target=this.players(c).find(x=>x.possessed_by===p&&x.alive);if(!target)throw new Error('You are not possessing anyone right now');const cleanChoice=String(choice||'');if(cleanChoice!=='skip')this.requireAlive(c,cleanChoice);
    // Same guard as vote(), justification-only update included — see its comment.
    const existingVoteAs=this.db.prepare("SELECT choice FROM hr_votes WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").get(c,g.round,target.player_code);
    if(existingVoteAs&&existingVoteAs.choice===cleanChoice){const cleanJust=justification?String(justification).trim().slice(0,300):null;if(cleanJust)this.db.prepare("UPDATE hr_votes SET justification=? WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").run(cleanJust,c,g.round,target.player_code);return{votes:this.voteState(c),message:justification?this.insertMessage(c,'public',null,p,this.displayName(g,target),`Vote justification: ${String(justification).trim().slice(0,300)}`,'vote'):null};}
    const votePlayer=cleanChoice==='skip'?null:this.player(c,cleanChoice);const targetName=cleanChoice==='skip'?null:(votePlayer?this.displayName(g,votePlayer):'Unknown');const puppetDisplay=this.displayName(g,target);const voteMsg=targetName?`${puppetDisplay} accused ${targetName}.`:`${puppetDisplay} stood down.`;this.system(c,voteMsg);const message=justification?this.insertMessage(c,'public',null,p,puppetDisplay,`Vote justification: ${String(justification).trim().slice(0,300)}`,'vote'):null;this.db.prepare('INSERT INTO hr_votes VALUES(?,?,?,?,?,?,?) ON CONFLICT(game_code,round,stage,voter_code) DO UPDATE SET choice=excluded.choice,created_at=excluded.created_at,justification=excluded.justification').run(c,g.round,'target',target.player_code,cleanChoice,this.now(),justification?String(justification).trim().slice(0,300):null);return{votes:this.voteState(c),message};}
  retractVoteAs(c,p){const g=this.requireGame(c);const target=this.players(c).find(x=>x.possessed_by===p&&x.alive);if(!target)throw new Error('You are not possessing anyone right now');this.db.prepare("DELETE FROM hr_votes WHERE game_code=? AND round=? AND stage='target' AND voter_code=?").run(c,g.round,target.player_code);this.system(c,`${this.displayName(g,target)} retracted their accusation.`);return this.voteState(c);}
  voteState(c){const g=this.game(c);if(!g)return[];return /** @type {{stage:string,voterCode:string,choice:string,createdAt:number,justification:string|null}[]} */ (this.db.prepare("SELECT stage,voter_code AS voterCode,choice,created_at AS createdAt,justification FROM hr_votes WHERE game_code=? AND round=? AND stage='target'").all(c,g.round));}
  /**
   * @param {object} [params]
   * @param {string} [params.targetCode]
   * @param {string} [params.variant]
   * @param {any} [params.data]
   * @param {string} [params.body]
   * @param {string} [params.asPlayerCode]
   *
   * Cripple is enforced here as ONE blanket rule: a crippled actor is blocked
   * from every action except protect/bodyguard (silent no-op) and drift-hint.
   * The per-role `crippleProfile` in game_data/roles-40k.json is descriptive
   * metadata that this engine deliberately does not read — do not "wire it up"
   * without a balance decision first. Cripple never gates voting; see vote().
   */
  submitAction(c,p,params={}){const{targetCode,variant,data,body,asPlayerCode}=params;const g=this.requireGame(c),actor=this.requireAlive(c,p),role=this.role(actor.role_id),action=g.phase==='night'?role.actions.night:role.actions.day;if(!action||action.kind==='sleep')throw new Error('Your role has no active action now');if(action.kind==='protect'&&effectiveCrippleTier(this.config.rules,actor,g.round)>0)return{kind:'protect',targetCode,silent:true};if(action.kind==='bodyguard'&&effectiveCrippleTier(this.config.rules,actor,g.round)>0)return{kind:'bodyguard',targetCode,silent:true};if(action.kind==='drift-hint'&&effectiveCrippleTier(this.config.rules,actor,g.round)>0)return{kind:'drift-hint',targetCode,silent:true};if(action.kind==='warp-read'&&effectiveCrippleTier(this.config.rules,actor,g.round)>0)return{kind:'warp-read',targetCode,silent:true};if(effectiveCrippleTier(this.config.rules,actor,g.round)>0)throw new Error('Torture damage blocks this action');if(action.kind==='kill'&&role.killLimit){const killUses=this.usage(c,p,'kill');if(killUses>=1)throw new Error('You can only use your kill once per game');}if(action.kind==='possess'&&role.possessLimit&&this.usage(c,p,'possess')>=1)throw new Error('The Animus is spent — one possession per game');
    // H7 Poxwalker: one infect per game, and no re-target while Patient Zero
    // still lives (poxwalker.md § Targeting rules). Both are submission-time
    // rejections with no cost, per the spec's targeting table. The "alive,
    // non-Heretic, not self" rules need no code here — actions.night.target
    // is 'hostile', so submitAction's existing requireAlive + isHostileTo
    // checks below already cover all three, exactly as they do for Animus.
    if(action.kind==='infect'){if(role.infectLimit&&this.usage(c,p,'infect')>=1)throw new Error('The plague is already loosed — one infection per game');if(g.patient_zero&&this.player(c,g.patient_zero)?.alive)throw new Error('Your plague already has a host');}
if(action.kind==='forgery')return this.forge(c,p,asPlayerCode,body);const target=this.requireAlive(c,targetCode);if(action.target==='other'&&targetCode===p)throw new Error('Choose another player');if(action.kind==='protect'&&!validateRotation(this.db,c,p,targetCode,g.round))throw new Error('Cannot protect the same target on consecutive nights');if(action.kind==='bodyguard'&&!validateRotation(this.db,c,p,targetCode,g.round))throw new Error('Cannot proxy the same target on consecutive nights');if(action.target==='hostile'&&!isHostileTo(actor,target))throw new Error('Target is not hostile');if(action.kind==='possess'&&target.possessed_by)throw new Error('That player is already possessed');if(action.variants&&!action.variants.includes(variant))throw new Error('Invalid action variant');if(['sermon','corrupt-sermon'].includes(action.kind)){const s=this.config.drift.sermons[variant],uses=this.usage(c,p,variant);if(s.limit!==null&&uses>=s.limit)throw new Error('Sermon limit reached');
      // The Warp Litany drift gate is deliberately NOT checked here. It used to
      // early-return {ok:false,silent:true}, which differs from an accepted
      // submission's {kind,targetCode,variant} — so a Heretic Priest could read
      // the ack and learn whether any target sat above or below drift 10, a
      // side channel around the rule that no client ever sees numeric drift.
      // heretic-kit.md v1.4.0 requires "no notification to either party", so the
      // gate now runs at resolution (see the sermon loop in resolveNight) where
      // it is unobservable: the submission is stored and acked exactly like a
      // landed one, and simply has no effect.
    }
    // H6 Animus (roles/animus.md): self-drift is charged at SUBMISSION time,
    // not at night-end resolution like every other night action — the spec
    // is explicit ("cost is paid at submission... target zone is not yet
    // checked"). Only charge once per round: a resubmission that just
    // retargets (still kind==='possess', same actor, same round) must not
    // pay twice, so check for an existing row BEFORE the upsert below.
    if(action.kind==='possess'&&!this.actions(c,g.round).some(a=>a.actor_code===p&&a.kind==='possess'))this.changeDrift(c,p,role.driftWeight,'possess-attempt');
    this.db.prepare('INSERT INTO hr_actions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_code,round,actor_code) DO UPDATE SET kind=excluded.kind,target_code=excluded.target_code,variant=excluded.variant,data=excluded.data,created_at=excluded.created_at').run(c,g.round,p,action.kind,targetCode,variant,data?JSON.stringify(data):null,this.now());if(g.phase==='night'&&actor.faction==='heretic'){const targetDisplayForCabal=this.displayName(g,target);const cabalLabel=action.kind==='kill'?`marked ${targetDisplayForCabal} for death`:action.kind==='boobytrap'?`set a trap on ${targetDisplayForCabal}`:action.kind==='corrupt-sermon'?`targets ${targetDisplayForCabal} with a corrupt sermon`:action.kind==='heretical-catalyst'?`invokes the catalyst on ${targetDisplayForCabal}`:action.kind==='possess'?`stirs the Warp toward ${targetDisplayForCabal}`:action.kind==='infect'?`breathes the pox over ${targetDisplayForCabal}`:`uses ${action.kind}`;this.factionSystem(c,`Cabalite ${this.displayName(g,actor)} ${cabalLabel}.`);}return {kind:action.kind,targetCode,variant};}
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
  submitFactionAction(c,p,params={}){const{targetCode}=params;const g=this.requireGame(c),actor=this.requireAlive(c,p);if(g.phase!=='night')throw new Error('Blood Ritual is night-only');if(actor.faction!=='heretic')throw new Error('Only Heretics may take Blood Ritual');if(effectiveCrippleTier(this.config.rules,actor,g.round)>0)throw new Error('Torture damage blocks this action');const target=this.requireAlive(c,targetCode);if(target.faction==='heretic')throw new Error('Target is not hostile');if(targetCode===p)throw new Error('Choose another player');if(this.actions(c,g.round).some(a=>a.kind==='blood-ritual'&&a.actor_code!==p))throw new Error('Blood Ritual has already been claimed tonight');this.db.prepare('INSERT INTO hr_actions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_code,round,actor_code) DO UPDATE SET kind=excluded.kind,target_code=excluded.target_code,variant=excluded.variant,data=excluded.data,created_at=excluded.created_at').run(c,g.round,p,'blood-ritual',targetCode,null,null,this.now());this.factionSystem(c,`Cabalite ${this.displayName(g,actor)} moves against ${this.displayName(g,target)}.`);return {kind:'blood-ritual',targetCode};}
  // TODO(heresy-spec): Saboteur trap frequency is once per night; the action table enforces one submission per actor and round.
  /** @returns {ActionRow[]} */
  actions(c,r){return /** @type {ActionRow[]} */ (this.db.prepare('SELECT * FROM hr_actions WHERE game_code=? AND round=?').all(c,r));}
  retractAction(c,p){const g=this.game(c);this.db.prepare('DELETE FROM hr_actions WHERE game_code=? AND round=? AND actor_code=?').run(c,g.round,p);}
  forge(c,p,asPlayerCode,body){const g=this.game(c),as=this.requireAlive(c,asPlayerCode);this.requireAlive(c,p);if(g.phase!=='day')throw new Error('Forgery is day-only');if(this.usage(c,p,`forgery-${g.round}`))throw new Error('Forgery already used today');
    // TODO(heresy-spec): Q31 — Conspirator default attributes one daily message to another player.
    const message=this.insertMessage(c,'public',null,p,this.displayName(g,as),String(body||'').slice(0,500),'player');this.incrementUsage(c,p,`forgery-${g.round}`);this.changeDrift(c,p,this.config.drift.FORGERY,'forgery');
    // Forgery resolves synchronously (day-only, no night-report equivalent
    // needed) and is public, so filing it is pure convenience, not a
    // hidden-info concern: it lands under the impersonated player's dossier
    // entry, own_action-flagged since it was the Conspirator's own choice.
    this.autoBookmark(c,p,message,{target:asPlayerCode},true);
    return {message};}
  usage(c,p,a){return /** @type {{uses:number}|undefined} */ (this.db.prepare('SELECT uses FROM hr_usage WHERE game_code=? AND player_code=? AND ability=?').get(c,p,a))?.uses||0;}
  incrementUsage(c,p,a){this.db.prepare('INSERT INTO hr_usage VALUES(?,?,?,1) ON CONFLICT(game_code,player_code,ability) DO UPDATE SET uses=uses+1').run(c,p,a);}
  hints(c){const g=this.game(c);return this.config.hintProfiles[g.hint_profile]||this.config.hintProfiles.default;}
  changeDrift(c,p,delta,reason){const g=this.game(c),player=this.player(c,p);if(!player)return;const before=player.drift,after=Math.max(0,Math.min(g.max_drift,before+delta));this.db.prepare('UPDATE hr_players SET drift=? WHERE game_code=? AND player_code=?').run(after,c,p);const from=driftZone(this.config.drift,before).id,to=driftZone(this.config.drift,after).id;
    // H7 Poxwalker: an infected player gets the plague's cue for this zone
    // INSTEAD of the ordinary one, never in addition to it. One crossing must
    // stay one message — a second line would let them infer their own infected
    // state from the message count, and the cue is deliberately identical for
    // Patient Zero and for carriers so neither can tell which they are. The
    // meta is unchanged either way: the client's Warp-taint gauge reads
    // ownZone off it, so dropping it would freeze the gauge for exactly the
    // players who are infected.
    if(from!==to)this.privateSystem(c,p,(this.isPlagued(g,player)&&this.plagueCue(to))||this.hints(c)[to],{intelKind:'drift_hint',ownZone:to});
    this.event(c,'drift',{playerCode:p,delta,before,after,reason,zone:to,round:g.round,phase:g.phase});}
  isPlagued(g,player){return !!player&&(g.patient_zero===player.player_code||!!player.plague_carrier);}
  // One cue drawn at random from that zone's pool, the same way deathFlavor
  // works. A single fixed string per zone was instantly recognisable to anyone
  // who had seen it once, which handed returning players a free "am I
  // infected?" tell and defeated the ambiguity the cue design exists for.
  // Returns null for a zone with no pool (green, by design) so the caller
  // falls back to the ordinary hint.
  plagueCue(zone){const pool=this.config.plagueHints?.[zone];return Array.isArray(pool)&&pool.length?pool[Math.floor(this.random()*pool.length)]:null;}
  finishIfWon(c){const players=this.players(c),living=players.filter(x=>x.alive),h=living.filter(x=>x.faction==='heretic').length,l=living.filter(x=>x.faction==='loyalist').length;let winner=h>=l?'heretic':null;if(!winner&&players.filter(x=>x.faction==='heretic').every(x=>!x.alive))winner='loyalist';if(!winner)return false;
    // TODO(heresy-spec): Q32 — Pyrrhic/no-clean-win is explicitly deferred from v1.
    this.db.prepare("UPDATE hr_games SET phase='ended',status='ended',winner=?,deadline=NULL WHERE code=?").run(winner,c);this.system(c,`Game over. ${winner} victory.`);const gEnd=this.game(c);this.emitAnnouncement(c,{type:'gameover',title:'GAME OVER',message:`${winner} victory. The conclave is dissolved.`,winner,round:gEnd.round});saveGameLogSnapshot({gameLogId:c,code:c,phase:gEnd.phase,winner:gEnd.winner,round:gEnd.round,maxDrift:gEnd.max_drift,mode:gEnd.mode,status:gEnd.status,players:this.players(c).map(p=>({id:p.player_code,name:p.name,hero:p.role_id||null,playerCode:p.player_code,seat:p.seat,roleId:p.role_id||null,faction:p.faction,drift:p.drift,alive:!!p.alive,crippleTier:p.cripple_tier,isBot:!!p.is_bot})),debugLog:this.db.prepare('SELECT * FROM hr_events WHERE game_code=? ORDER BY id').all(c),history:this.db.prepare('SELECT id,channel,author,body,kind,created_at AS createdAt FROM hr_messages WHERE game_code=? ORDER BY id').all(c),createdAt:gEnd.created_at});return true;}
  // Seatless admin path: no hr_players row, so none of authorizeChannel's
  // alive/phase/possession checks apply to them — deliberate, since an
  // "emergency broadcast" is exactly for the moments normal public chat is
  // closed (night phase, dead-required, etc). Restricted to 'public' only —
  // there's no faction/graveyard/alive state to authorize against for a
  // non-player. adminName is client-supplied (their own saved profile name,
  // see App.vue's sendMessage) purely for display — cosmetic, not identity.
  sendMessage(c,p,channel,body,adminName){const g=this.game(c),player=this.player(c,p);if(!player){this.requireAdmin(p);if(channel!=='public')throw new Error('Admin broadcast is public-channel only');const author='God Emperor of Mankind'+(adminName?` (${String(adminName).trim().slice(0,30)})`:'');return this.insertMessage(c,'public',null,p,author,String(body||'').trim().slice(0,1000),'admin');}this.authorizeChannel(g,player,channel,true);return this.insertMessage(c,channel,null,p,this.displayName(g,player),String(body||'').trim().slice(0,1000),'player');}
  // H6 Animus: unlike Conspirator's forge() (day action, once/day, caller
  // names the target), this is unlimited for the possession day and the
  // target is never client-supplied — always derived from the server's own
  // live possessed_by record, so a bot/client can never spoof "speak as"
  // someone it doesn't actually possess.
  sendMessageAs(c,p,body){const g=this.game(c),actor=this.requireAlive(c,p);this.authorizeChannel(g,actor,'public',true);const target=this.players(c).find(x=>x.possessed_by===p&&x.alive);if(!target)throw new Error('You are not possessing anyone right now');return this.insertMessage(c,'public',null,p,this.displayName(g,target),String(body||'').trim().slice(0,1000),'player');}
  insertMessage(c,ch,recipient,p,author,body,kind,meta=null){if(!body)throw new Error('Message is empty');const x=this.db.prepare('INSERT INTO hr_messages(game_code,channel,recipient_code,player_code,author,body,kind,created_at,meta) VALUES(?,?,?,?,?,?,?,?,?)').run(c,ch,recipient,p,author,body,kind,this.now(),meta?JSON.stringify(meta):null);return this.db.prepare('SELECT id,channel,player_code,recipient_code,author,body,kind,created_at AS createdAt,meta FROM hr_messages WHERE id=?').get(x.lastInsertRowid);}
  system(c,b,meta=null){const m=this.insertMessage(c,'public',null,null,'The Vox',b,'system',meta);this.emitChatMessage(c,m);return m;} privateSystem(c,p,b,meta=null,{autoBookmark=true,ownAction=false}={}){const m=this.insertMessage(c,'private',p,null,'The Vox',b,'system',meta);if(autoBookmark)this.autoBookmark(c,p,m,meta,ownAction);this.emitChatMessage(c,m);return m;} factionSystem(c,b){const m=this.insertMessage(c,'faction',null,null,'The Vox',b,'system');this.emitChatMessage(c,m);return m;}
  flavor(category,vars={}){const list=this.config?.deathFlavor?.[category];if(!list||!list.length)return '';let t=list[Math.floor(this.random()*list.length)];for(const[k,v]of Object.entries(vars))t=t.split(`{${k}}`).join(String(v));return t;}
  /**
   * @param {string} [ch]
   * @param {number|string} [before]
   * @param {number|string} [limit]
   */
  historyMessages(c,p,ch='public',before=Number.MAX_SAFE_INTEGER,limit=50){const g=this.game(c);const player=this.player(c,p);if(!player){if(g.phase==='lobby'||ch!=='public')throw new Error('Access denied');}else{this.authorizeChannel(g,player,ch,false);}const cap=Math.min(100,Number(limit)||50);const priv=ch==='private';const before2=Number(before)||Number.MAX_SAFE_INTEGER;const rows=this.db.prepare(`SELECT id,channel,author,body,kind,created_at AS createdAt,meta FROM hr_messages WHERE game_code=? AND channel=?${priv?' AND recipient_code=?':''} AND id<? ORDER BY id DESC LIMIT ?`).all(...(priv?[c,ch,p,before2,cap+1]:[c,ch,before2,cap+1])).reverse();const hasMore=rows.length>cap;return {messages:hasMore?rows.slice(0,cap):rows,hasMore};}
  // Post-game: once the conclave is 'ended', public chat opens up for
  // everyone — dead, possessed, whatever — so the table can talk about the
  // game afterward. The alive/night/possession gates below only ever apply
  // while the game is still running.
  // 'private' is READ-ONLY and always self-scoped: historyMessages adds
  // `AND recipient_code=?` bound to the authenticated player, exactly the way
  // listNotes scopes a dossier in SQL rather than trusting the caller. Without
  // it a reload lost every private line a player had ever received — role
  // reveal, intel returns, night-action reports — because loadHistory only
  // ever refetched 'public'. Nobody may WRITE to it: private lines are
  // engine-authored (privateSystem) and a client-authored one would let a
  // player forge intel into their own log.
  authorizeChannel(g,p,ch,write){if(!['public','faction','graveyard','private'].includes(ch))throw new Error('Unknown channel');if(ch==='private'&&write)throw new Error('Private channel is read-only');if(ch==='faction'&&p.faction!=='heretic')throw new Error('Faction channel denied');if(ch==='faction'&&!p.alive)throw new Error('Faction channel denied');if(ch==='graveyard'&&p.alive)throw new Error('Graveyard denied');if(write&&ch==='public'&&g.phase!=='ended'){if(!p.alive||g.phase==='night')throw new Error('Public chat is closed');if(p.possessed_by)throw new Error('You are possessed and cannot speak today');}if(write&&ch==='faction'&&g.phase!=='night')throw new Error('Faction chat is night-only');}
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
  // Client-safe projection of a chat row. hr_messages stores the TRUE actor in
  // player_code while `author` holds the DISPLAYED name, and for two mechanics
  // those deliberately disagree: Conspirator forgery (forge) posts under the
  // framed player's name, and Animus puppet-speech (sendMessageAs/voteAs) posts
  // under the puppet's. Broadcasting the raw row therefore handed every client
  // the real author of a message the whole mechanic exists to disguise — and
  // since every client already holds the playerCode->name map from state(), it
  // was a one-line lookup. Neither the client nor anything else renders it, so
  // it leaked purely by being on the wire; chat:history never selected the
  // column at all, which is why a page reload used to "hide" the leak.
  // authorCode carries the APPARENT identity instead: the code of whoever the
  // message appears to be from, resolved through displayName so anonymized
  // mode resolves the same way the reader sees it. recipient_code goes too --
  // it is routing metadata, and broadcastMessage decides delivery before this
  // runs. animus.md: "Animus's identity | No". conspirator.md: "Detection: none
  // at the engine level."
  publicMessage(c,m){const g=this.game(c);const speaker=this.players(c).find(p=>this.displayName(g,p)===m.author);const{player_code,recipient_code,...rest}=m;return{...rest,authorCode:speaker?speaker.player_code:null};}
  // The public narration of a Blood Ritual kill and a Murderer kill is
  // deliberately identical (same 'slain' flavor pool, same SLAIN IN THE NIGHT
  // title) per blood-ritual.md: "No alignment reveal on kill - same as
  // Murderer." Shipping the raw death_cause undid that, since the roster
  // rendered it as a 'Slain (Blood Ritual)' tooltip and told the table which
  // mechanic killed. The DB keeps the true cause for admin and game logs;
  // only the player-facing projection collapses it.
  publicDeathCause(cause){return cause==='blood-ritual'?'murder':cause;}
  atRiskTargets(roster){return roster.filter(p=>p.alive&&p.mark_public).map(p=>p.player_code);}
  state(c,viewerCode){const g=this.requireGame(c),viewer=this.requirePlayer(c,viewerCode),ended=g.status==='ended',roster=this.rosterPlayers(c),players=roster.map(p=>({playerCode:p.player_code,name:this.displayName(g,p),alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,crippleTier:p.cripple_tier,deathCause:this.publicDeathCause(p.death_cause),torturedBefore:!!p.mark_public,...((p.player_code===viewerCode||ended||(!p.alive&&p.possessed_by))?{role:p.role_id?this.roleForDisplay(this.role(p.role_id),roster.length):null,faction:p.faction}:{}),...(viewer.faction==='heretic'&&p.faction==='heretic'?{faction:'heretic'}:{}),...((viewerCode===p.possessed_by||(viewerCode===p.player_code&&p.possessed_by)||(!p.alive&&p.possessed_by)||(ended&&p.possessed_by))?{possessed:true}:{}),...(p.player_code===viewerCode&&this.isAdmin(p.player_code)?{isAdmin:true}:{})}));const privateMessages=/** @type {{id:number,author:string,body:string,kind:string,createdAt:number,meta:string|null}[]} */ (this.db.prepare("SELECT id,author,body,kind,created_at AS createdAt,meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id").all(c,viewerCode)).map(m=>({...m,meta:m.meta?JSON.parse(m.meta):null}));const votingEnabled=g.phase==='day'?g.round>=this.config.rules.day.FIRST_VOTING_ROUND:true;return {code:c,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,dayMs:g.day_ms,nightMs:g.night_ms,anonymized:!!g.anonymized,warpTaintVisible:!!g.warp_taint_visible,deathReveal:g.death_reveal,dayStartMinuteUtc:g.day_start_minute_utc,players,me:players.find(x=>x.playerCode===viewerCode),votes:g.phase==='day'?this.voteState(c):[],myAction:this.db.prepare('SELECT kind,target_code AS targetCode,variant FROM hr_actions WHERE game_code=? AND round=? AND actor_code=?').get(c,g.round,viewerCode)||null,lastProtectTarget:getLastProtectTarget(this.db,g.code,viewerCode),privateMessages,votingEnabled,atRiskTargets:this.atRiskTargets(roster),...(g.phase==='lobby'?{compositionLabel:`${players.length}-operative doctrine`}:{})};}
  spectate(c){const g=this.requireGame(c);if(g.phase==='lobby')throw new Error('Game has not started yet');const ended=g.status==='ended';const roster=this.rosterPlayers(c);const players=roster.map(p=>({playerCode:p.player_code,name:this.displayName(g,p),alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,crippleTier:p.cripple_tier,deathCause:this.publicDeathCause(p.death_cause),torturedBefore:!!p.mark_public,...((ended||(!p.alive&&p.possessed_by))?{role:p.role_id?this.roleForDisplay(this.role(p.role_id),roster.length):null,faction:p.faction}:{}),...((!p.alive&&p.possessed_by)||(ended&&p.possessed_by)?{possessed:true}:{})}));return {code:c,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,dayMs:g.day_ms,nightMs:g.night_ms,anonymized:!!g.anonymized,warpTaintVisible:!!g.warp_taint_visible,deathReveal:g.death_reveal,dayStartMinuteUtc:g.day_start_minute_utc,players,me:null,votes:g.phase==='day'?this.voteState(c):[],myAction:null,lastProtectTarget:null,privateMessages:[],votingEnabled:g.phase==='day'?g.round>=this.config.rules.day.FIRST_VOTING_ROUND:false,atRiskTargets:this.atRiskTargets(roster),isSpectator:true};}
  // Full-visibility admin observer: unlike state()/spectate(), role/faction are
  // ALWAYS included (no phase/ended gating) and chat/actions/votes are raw DB
  // rows (true sender/recipient, not publicMessage()'s apparent-identity
  // projection) — this view is for the admin identity only, gated upstream by
  // requireAdmin() in the game:admin-observe handler, never exposed to players.
  adminState(c){const g=this.requireGame(c),roster=this.rosterPlayers(c),players=roster.map(p=>({playerCode:p.player_code,name:this.displayName(g,p),alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,crippleTier:p.cripple_tier,deathCause:this.publicDeathCause(p.death_cause),torturedBefore:!!p.mark_public,drift:p.drift,isBot:!!p.is_bot,role:p.role_id?this.roleForDisplay(this.role(p.role_id),roster.length):null,faction:p.faction})),allMessages=this.db.prepare('SELECT id,channel,recipient_code AS recipientCode,player_code AS playerCode,author,body,kind,created_at AS createdAt FROM hr_messages WHERE game_code=? ORDER BY id LIMIT 2000').all(c),allActions=/** @type {{round:number,actorCode:string,kind:string,targetCode:string|null,variant:string|null,data:string|null,createdAt:number}[]} */ (this.db.prepare('SELECT round,actor_code AS actorCode,kind,target_code AS targetCode,variant,data,created_at AS createdAt FROM hr_actions WHERE game_code=? ORDER BY round,created_at').all(c)).map(a=>({...a,data:a.data?JSON.parse(a.data):null})),allVotes=this.db.prepare('SELECT round,stage,voter_code AS voterCode,choice,created_at AS createdAt FROM hr_votes WHERE game_code=? ORDER BY round,created_at').all(c);return {code:c,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,dayMs:g.day_ms,nightMs:g.night_ms,anonymized:!!g.anonymized,warpTaintVisible:!!g.warp_taint_visible,deathReveal:g.death_reveal,dayStartMinuteUtc:g.day_start_minute_utc,players,votes:g.phase==='day'?this.voteState(c):[],allMessages,allActions,allVotes,isAdminObserver:true,...(g.phase==='lobby'?{compositionLabel:`${players.length}-operative doctrine`}:{})};}
  adminRole(id){if(!id)return null;const r=this.config.roles.get(id);return r?{id:r.id,displayName:r.displayName,faction:r.faction,driftWeight:r.driftWeight,objective:r.objective,ability:r.ability}:null;}
  adminPlayer(p,g){return {playerCode:p.player_code,name:p.name,seat:p.seat,roleId:p.role_id,role:this.adminRole(p.role_id),faction:p.faction,drift:p.drift,alive:!!p.alive,ready:!!p.ready,connected:!!p.connected,isHost:p.player_code===g.host_code,isBot:!!p.is_bot,crippleTier:p.cripple_tier,tier1UntilRound:p.tier1_until_round,skipNextNight:!!p.skip_next_night,joinedAt:p.joined_at};}
  adminGameSummary(g){const players=this.players(g.code),messages=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_messages WHERE game_code=?').get(g.code)).count,events=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_events WHERE game_code=?').get(g.code)).count,actions=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_actions WHERE game_code=?').get(g.code)).count,votes=/** @type {{count:number}} */ (this.db.prepare('SELECT COUNT(*) AS count FROM hr_votes WHERE game_code=?').get(g.code)).count;return {code:g.code,mode:g.mode,phase:g.phase,dayStage:g.day_stage,status:g.status,round:g.round,deadline:g.deadline,winner:g.winner,maxDrift:g.max_drift,hintProfile:g.hint_profile,createdAt:g.created_at,updatedAt:g.updated_at,hostCode:g.host_code,hostName:players.find(p=>p.player_code===g.host_code)?.name??null,playerCount:players.length,botCount:players.filter(p=>p.is_bot).length,aliveCount:players.filter(p=>p.alive).length,connectedCount:players.filter(p=>p.connected).length,readyCount:players.filter(p=>p.ready).length,averageDrift:players.length?players.reduce((sum,p)=>sum+p.drift,0)/players.length:0,maxPlayerDrift:players.length?Math.max(...players.map(p=>p.drift)):0,hereticCount:players.filter(p=>p.faction==='heretic').length,loyalistCount:players.filter(p=>p.faction==='loyalist').length,messageCount:messages,eventCount:events,actionCount:actions,voteCount:votes};}
  adminOverview(){const games=this.db.prepare('SELECT * FROM hr_games ORDER BY updated_at DESC').all().map(g=>this.adminGameSummary(g));return {games,roles:this.roleDefinitions().map(r=>({id:r.id,displayName:r.displayName,faction:r.faction,driftWeight:r.driftWeight,objective:r.objective,ability:r.ability})),totals:{games:games.length,active:games.filter(g=>g.status==='active').length,lobby:games.filter(g=>g.status==='lobby').length,ended:games.filter(g=>g.status==='ended').length,players:games.reduce((sum,g)=>sum+g.playerCount,0),messages:games.reduce((sum,g)=>sum+g.messageCount,0)}};}
  adminGame(c){const g=this.requireGame(c),players=this.players(c).map(p=>this.adminPlayer(p,g)),actions=/** @type {{round:number,actorCode:string,kind:string,targetCode:string|null,variant:string|null,data:string|null,createdAt:number}[]} */ (this.db.prepare('SELECT round,actor_code AS actorCode,kind,target_code AS targetCode,variant,data,created_at AS createdAt FROM hr_actions WHERE game_code=? ORDER BY round DESC,created_at DESC').all(c)).map(a=>({...a,data:a.data?JSON.parse(a.data):null})),votes=this.db.prepare('SELECT round,stage,voter_code AS voterCode,choice,created_at AS createdAt FROM hr_votes WHERE game_code=? ORDER BY round DESC,created_at DESC').all(c),messages=this.db.prepare('SELECT id,channel,recipient_code AS recipientCode,player_code AS playerCode,author,body,kind,created_at AS createdAt FROM hr_messages WHERE game_code=? ORDER BY id DESC LIMIT 200').all(c).reverse(),events=/** @type {{id:number,type:string,payload:string|null,createdAt:number}[]} */ (this.db.prepare('SELECT id,type,payload,created_at AS createdAt FROM hr_events WHERE game_code=? ORDER BY id DESC LIMIT 200').all(c)).reverse().map(e=>({...e,payload:e.payload?JSON.parse(e.payload):null}));return {game:this.adminGameSummary(g),players,actions,votes,messages,events};}
  adminUpdatePlayer(c,p,updates={}){const existing=this.requirePlayer(c,p),g=this.requireGame(c),fields=[],values=[];const bools={alive:'alive',ready:'ready',connected:'connected',skipNextNight:'skip_next_night'};for(const [input,column] of Object.entries(bools))if(updates[input]!==undefined){fields.push(`${column}=?`);values.push(updates[input]?1:0);}if(updates.drift!==undefined){fields.push('drift=?');values.push(Math.max(0,Math.min(g.max_drift,Number(updates.drift)||0)));}if(updates.crippleTier!==undefined){fields.push('cripple_tier=?');values.push(Math.max(0,Math.min(3,Number(updates.crippleTier)||0)));}if(updates.faction!==undefined&&['loyalist','heretic'].includes(updates.faction)){fields.push('faction=?');values.push(updates.faction);}if(updates.roleId!==undefined){if(updates.roleId&& !this.config.roles.has(updates.roleId))throw new Error('Unknown role');fields.push('role_id=?');values.push(updates.roleId||null);}if(!fields.length)return this.adminPlayer(existing,g);this.db.prepare(`UPDATE hr_players SET ${fields.join(', ')} WHERE game_code=? AND player_code=?`).run(...values,c,p);return this.adminPlayer(this.player(c,p),g);}
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
    const MAX_BOTS_PER_GAME=Number(process.env.MAX_BOTS_PER_GAME)||5;
    if(botCount>=MAX_BOTS_PER_GAME)throw new Error(`Bot limit (${MAX_BOTS_PER_GAME} per Conclave) reached`);
    if(players.length>=this.config.rules.MAX_PLAYERS)throw new Error('Conclave is full');
    let seat;
    if(seatHint!=null&&seatHint!==''){const s=Math.max(0,Number(seatHint)|0);if(s>=this.config.rules.MAX_PLAYERS||players.some(p=>p.seat===s))throw new Error('Requested seat is taken or out of range');seat=s;}
    else{const taken=new Set(players.map(p=>p.seat));seat=0;while(taken.has(seat))seat++;}
    const playerCode=this.generateBotPlayerCode();
    // Per-conclave name uniqueness: hard guard against collisions with humans
    // OR other bots so a bare default ('Heretic Bot') or a randomly-generated
    // notableName that happens to roll the same as an existing seat can never
    // produce two rosters entries with the same displayName. The client's
    // pickBotName() already filters, but the engine is the source of truth.
    const baseName=sanitizePlayerName(name)||'Heretic Bot';
    const taken=new Set(players.map(p=>p.name));
    let finalName=baseName;
    if(taken.has(finalName)){
      const cap=20; // MAX_NAME_LENGTH in utils.js
      let n=2;
      do{
        const suffix=` ${n}`;
        const head=baseName.slice(0,Math.max(0,cap-suffix.length));
        finalName=head+suffix;
        n++;
      }while(taken.has(finalName)&&n<1000);
    }
    this.db.prepare('INSERT INTO hr_players(game_code,player_code,name,seat,joined_at,is_bot,ready) VALUES(?,?,?,?,?,1,1)').run(code,playerCode,finalName,seat,this.now());
    return {playerCode,seat,isBot:true,name:finalName,conclaveCode:code};
  }
  adminDespawnBot(code,playerCode){
    const p=this.requirePlayer(code,playerCode);
    if(!p.is_bot)throw new Error('Not a bot');
    const g=this.requireGame(code);
    if(g.phase!=='lobby')throw new Error('Bots can only be removed while the Conclave is in the lobby');
    this.db.prepare('DELETE FROM hr_players WHERE game_code=? AND player_code=?').run(code,playerCode);
    return {despawned:true,playerCode,conclaveCode:code};
  }
  adminListPlayers(){
    const rows=this.db.prepare(`
      SELECT DISTINCT p.player_code,
        MAX(p.name) as name,
        MAX(p.is_bot) as is_bot,
        COUNT(DISTINCT p.game_code) as game_count,
        COUNT(DISTINCT CASE WHEN g.status='ended' THEN p.game_code END) as ended_count,
        MAX(g.updated_at) as last_seen,
        GROUP_CONCAT(DISTINCT CASE WHEN g.status!='ended' THEN p.game_code END) as active_games
      FROM hr_players p
      JOIN hr_games g ON p.game_code = g.code
      GROUP BY p.player_code
      ORDER BY last_seen DESC
    `).all();
    return {players:rows.map(r=>({
      playerCode:r.player_code,
      name:r.name,
      isBot:!!r.is_bot,
      gameCount:r.game_count,
      endedCount:r.ended_count,
      activeGames:(r.active_games||'').split(',').filter(x=>x),
      lastSeen:r.last_seen
    }))};
  }
  adminMergePlayer(fromPlayerCode,toPlayerCode){
    if(!fromPlayerCode||!toPlayerCode)throw new Error('Both fromPlayerCode and toPlayerCode are required');
    if(fromPlayerCode===toPlayerCode)throw new Error('Cannot merge a profile with itself');
    const fromGames=this.db.prepare('SELECT DISTINCT game_code FROM hr_players WHERE player_code=?').all(fromPlayerCode);
    const toGames=this.db.prepare('SELECT DISTINCT game_code FROM hr_players WHERE player_code=?').all(toPlayerCode);
    const fromGameCodes=new Set(fromGames.map(r=>r.game_code));
    const toGameCodes=new Set(toGames.map(r=>r.game_code));
    const overlap=Array.from(fromGameCodes).filter(code=>toGameCodes.has(code));
    if(overlap.length>0)throw new Error(`Cannot merge: both profiles have entries in ${overlap.length} game(s) (${overlap.slice(0,3).join(', ')}${overlap.length>3?'...':''})`);
    const now=this.now();
    this.db.exec('BEGIN TRANSACTION');
    try{
      this.db.prepare('UPDATE hr_players SET player_code=? WHERE player_code=?').run(toPlayerCode,fromPlayerCode);
      this.db.prepare('UPDATE hr_actions SET actor_code=? WHERE actor_code=?').run(toPlayerCode,fromPlayerCode);
      this.db.prepare('UPDATE hr_votes SET voter_code=? WHERE voter_code=?').run(toPlayerCode,fromPlayerCode);
      this.db.prepare('UPDATE hr_messages SET player_code=? WHERE player_code=?').run(toPlayerCode,fromPlayerCode);
      this.db.prepare('UPDATE hr_usage SET player_code=? WHERE player_code=?').run(toPlayerCode,fromPlayerCode);
      const fromPrefs=this.db.prepare('SELECT prefs FROM hr_player_prefs WHERE player_code=?').get(fromPlayerCode);
      if(fromPrefs){
        const toPrefs=this.db.prepare('SELECT prefs FROM hr_player_prefs WHERE player_code=?').get(toPlayerCode);
        const merged={...JSON.parse(fromPrefs.prefs),...JSON.parse(toPrefs?.prefs||'{}')};
        this.db.prepare('INSERT INTO hr_player_prefs(player_code,prefs,updated_at) VALUES(?,?,?) ON CONFLICT(player_code) DO UPDATE SET prefs=excluded.prefs,updated_at=excluded.updated_at').run(toPlayerCode,JSON.stringify(merged),now);
      }
      this.db.prepare('DELETE FROM hr_player_prefs WHERE player_code=?').run(fromPlayerCode);
      this.db.exec('COMMIT');
      return{merged:true,fromPlayerCode,toPlayerCode,gamesAffected:fromGames.length};
    }catch(e){
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  adminDeletePlayer(playerCode){
    if(!playerCode)throw new Error('playerCode is required');
    const games=this.db.prepare('SELECT game_code FROM hr_players WHERE player_code=? GROUP BY game_code').all(playerCode);
    const activeGames=this.db.prepare('SELECT COUNT(*) as cnt FROM hr_players p JOIN hr_games g ON p.game_code=g.code WHERE p.player_code=? AND g.status!=?').get(playerCode,'ended');
    if(activeGames.cnt>0)throw new Error(`Cannot delete: player still has ${activeGames.cnt} active game(s)`);
    this.db.exec('BEGIN TRANSACTION');
    try{
      this.db.prepare('DELETE FROM hr_players WHERE player_code=?').run(playerCode);
      this.db.prepare('DELETE FROM hr_actions WHERE actor_code=?').run(playerCode);
      this.db.prepare('DELETE FROM hr_votes WHERE voter_code=?').run(playerCode);
      this.db.prepare('DELETE FROM hr_messages WHERE player_code=?').run(playerCode);
      this.db.prepare('DELETE FROM hr_usage WHERE player_code=?').run(playerCode);
      this.db.prepare('DELETE FROM hr_player_prefs WHERE player_code=?').run(playerCode);
      this.db.exec('COMMIT');
      return{deleted:true,playerCode,gamesAffected:games.length};
    }catch(e){
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  botIds(c){return this.players(c).filter(p=>p.is_bot).map(p=>p.player_code);}
  botSessionInit(c,playerCode){
    const g=this.requireGame(c),p=this.requirePlayer(c,playerCode);
    if(!p.is_bot)return null;
    if(g.phase==='lobby')return {kind:'session_init',botId:playerCode,playerCode,role:null,faction:null,round:0,phase:'lobby',votingEnabled:false,alivePlayers:this.players(c).map(x=>x.player_code),deadPlayers:[],publicAnnouncements:[],botIds:this.botIds(c)};
    const role=p.role_id?this.role(p.role_id):null;
    return {kind:'session_init',botId:playerCode,playerCode,role:role?.id||null,faction:p.faction,round:g.round,phase:g.phase,votingEnabled:g.phase==='day'?g.round>=this.config.rules.day.FIRST_VOTING_ROUND:false,alivePlayers:this.players(c).filter(x=>x.alive).map(x=>x.player_code),deadPlayers:this.players(c).filter(x=>!x.alive).map(x=>x.player_code),publicAnnouncements:[],botIds:this.botIds(c)};
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
  isAdmin(p){return this.adminPlayerCodes.has(p);}
  requireAdmin(p){if(!this.isAdmin(p))throw new Error('Admin permission required');return true;}
  requireHostOrAdmin(c,p){const g=this.requireGame(c);if(g.host_code!==p&&!this.isAdmin(p))throw new Error('Host or admin permission required');return g;}
}
