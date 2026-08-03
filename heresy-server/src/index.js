import express from 'express';
import http from 'http';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { config, isDefaultAdminPassword, isDefaultAdminApiKey } from './config.js';
import { HeresyGameManager } from './heresyGameManager.js';
import { loadGameConfig } from './gameConfig.js';
import { normalizeRoomCode, requirePlayerCode, normalizePlayerCode } from './utils.js';
import { SocketRateLimiter } from './socketRateLimiter.js';
import { deleteGameLog, getGameLog, listGameLogs } from './gameLogs.js';
import { validateComposition } from './validators/composition.js';

export function isOriginAllowed(origin, allowed) {
  return !origin || allowed === '*' || allowed.includes(origin);
}

export function isRequestOriginAllowed(req, allowed) {
  if (isOriginAllowed(req.headers.origin, allowed)) return true;
  if (!req.headers.origin || !req.headers.host) return false;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Player-count bounds live in game_data/rules.json (MIN_PLAYERS/MAX_PLAYERS)
// — the single source of truth heresyGameManager.js's start()/join() also
// read from. Loaded once at module scope since publicPresetMetadata (used
// directly by tests) and resolveSimComposition below both need it without a
// gameManager instance in hand.
const { rules: sharedRules } = loadGameConfig();

export function publicPresetMetadata(players) {
  const { MIN_PLAYERS, MAX_PLAYERS } = sharedRules;
  return { count: Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number(players)||MIN_PLAYERS)), minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS };
}

// Engine floor/ceiling for a live game (heresyGameManager.js's start(): players.length<MIN_PLAYERS||>MAX_PLAYERS).
// validateComposition() itself doesn't enforce this — it only checks roster.length===playerCount,
// hard/soft role rules — so a 3p or 13p composition would otherwise sail through pre-validation
// here and only fail once heresy-sim actually starts running real games (its own 500). Both sim
// callers (host socket + admin REST) get a clean rejection up front instead of that round trip.
const SIM_MIN_PLAYERS = sharedRules.MIN_PLAYERS, SIM_MAX_PLAYERS = sharedRules.MAX_PLAYERS;

// Derives {roster, playerCount} from the same `composition` shape heresyGameManager.start()
// accepts, then runs it through the shared validateComposition(). This mirrors (deliberately,
// not accidentally) the tiny presetFor/derivation shim heresy-sim/src/server.js#createSimServer
// already carries for the same reason: neither side can call the other's private preset lookup,
// and pre-validating here — before ever making the network hop — is the whole point of this
// check existing on the heresy-server side at all. Returns {ok:true,roster,playerCount} or
// {ok:false,errors:[...]} — never throws, matching validateComposition's own return convention.
export function resolveSimComposition(composition, gameManager) {
  if (!composition || typeof composition !== 'object' || Array.isArray(composition)) {
    return { ok: false, errors: [{ kind: 'input', rule: 'shape', message: 'composition is required and must be an object.' }] };
  }
  if (composition.source !== 'preset' && composition.source !== 'custom') {
    return { ok: false, errors: [{ kind: 'input', rule: 'source', message: 'composition.source must be "preset" or "custom".' }] };
  }
  let playerCount, roster;
  if (composition.source === 'preset') {
    const match = /^(\d+)/.exec(String(composition.presetId ?? ''));
    if (!match) return { ok: false, errors: [{ kind: 'input', rule: 'presetId', message: 'composition.presetId must start with a number, e.g. "8p".' }] };
    playerCount = parseInt(match[1], 10);
    roster = gameManager.presetFor(playerCount);
  } else {
    if (!Array.isArray(composition.roster) || composition.roster.length === 0) {
      return { ok: false, errors: [{ kind: 'input', rule: 'roster', message: 'composition.roster must be a non-empty array of role IDs.' }] };
    }
    roster = composition.roster;
    playerCount = roster.length;
  }
  if (playerCount < SIM_MIN_PLAYERS || playerCount > SIM_MAX_PLAYERS) {
    return { ok: false, errors: [{ kind: 'hard', rule: 'H0', message: `Player count (${playerCount}) must be between ${SIM_MIN_PLAYERS} and ${SIM_MAX_PLAYERS}.` }] };
  }
  const validation = validateComposition({
    roster,
    playerCount,
    confirmedWarnings: composition.confirmedWarnings || [],
    validRoles: gameManager.config.roles,
    hardRules: gameManager.config.hardRules,
    source: composition.source
  });
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return { ok: true, roster, playerCount };
}

// Canonical identity of a sim composition request, used to tell "the host
// re-submitted the exact same setup" apart from "the host changed the
// roster and wants a fresh test" — deliberately excludes confirmedWarnings
// (an acknowledgement, not part of the setup) and games/seed (batch
// parameters, not the setup itself). Roster order doesn't matter for this
// comparison — a re-sorted but otherwise identical roster is the same setup.
export function simCompositionKey(composition) {
  if (!composition || typeof composition !== 'object') return '';
  if (composition.source === 'preset') return `preset:${composition.presetId}`;
  if (composition.source === 'custom' && Array.isArray(composition.roster)) return `custom:${[...composition.roster].sort().join(',')}`;
  return JSON.stringify(composition);
}

// fetch() with an AbortController-based timeout — mirrors bot-manager's
// OpenAIChat.chat() (bot-manager/src/llm/openaiChat.js), the only other
// outbound-call timeout pattern in this codebase. heresy-sim batches can
// legitimately run for several seconds, so the caller supplies the budget.
export async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** @param {{databasePath?:string,now?:()=>number}} [params] */
export function createHeresyServer({ databasePath, now } = {}) {
  const app=express(), server=http.createServer(app), allowed=config.cors.allowedOrigins;
  const corsOptions=(req,cb)=>cb(null,{origin:isRequestOriginAllowed(req,allowed),credentials:false});
  app.disable('x-powered-by'); app.set('trust proxy',config.trustProxy?1:false); app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}})); app.use(cors(corsOptions)); app.use(express.json({limit:'32kb'})); app.use(rateLimit({...config.rateLimit,max:config.rateLimit.max||120}));
  const gameManager=new HeresyGameManager({databasePath,now});
  gameManager.onAnnouncement((code,a)=>{broadcastAnnouncement(code,a);});
  gameManager.onBotPrompt((code,payload)=>{broadcastBotPrompt(code,payload);});
  gameManager.onChatMessage((code,message)=>{broadcastMessage(code,message);});
  gameManager.onBookmark((code,ownerCode,bookmark)=>{broadcastBookmark(code,ownerCode,bookmark);});
  app.get('/api/health',(req,res)=>res.json({status:'ok',time:Date.now()}));
  app.get('/api/game/presets',(req,res)=>{res.set('Cache-Control','no-store').json(publicPresetMetadata(req.query.players));});
  // In production, a default/unchanged admin password must never grant access — fail closed.
  const adminLocked = config.adminPassword && process.env.NODE_ENV === 'production' && isDefaultAdminPassword();
  if (adminLocked) {
    console.error('[SECURITY] Refusing admin access: ADMIN_PASSWORD is unset or still the shipped default. Set a strong ADMIN_PASSWORD before exposing the admin panel.');
  }
  // Strict, per-IP limiter for admin login attempts to slow brute-forcing of the admin password.
  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many admin login attempts. Try again later.' }
  });
  function requireAdmin(req,res,next){res.set('Cache-Control','no-store');if(adminLocked)return res.status(503).json({error:'Admin access disabled. The admin password must be set to a non-default value.'});if(!constantTimeEquals(req.get('X-Admin-Password'),config.adminPassword))return res.status(401).json({error:'Admin password required'});next();}
  app.post('/api/admin/login',adminLoginLimiter,requireAdmin,(_req,res)=>res.json({ok:true}));
  app.get('/api/admin/overview',requireAdmin,(_req,res)=>{try{res.json(gameManager.adminOverview());}catch(e){res.status(500).json({error:e.message});}});
  app.get('/api/admin/games/:code',requireAdmin,(req,res)=>{try{res.json(gameManager.adminGame(normalizeRoomCode(req.params.code)));}catch(e){res.status(404).json({error:e.message});}});
  app.patch('/api/admin/games/:code/players/:playerCode',requireAdmin,(req,res)=>{try{res.json({player:gameManager.adminUpdatePlayer(normalizeRoomCode(req.params.code),req.params.playerCode,req.body)});}catch(e){res.status(400).json({error:e.message});}});
  app.post('/api/admin/games/:code/end',requireAdmin,(req,res)=>{try{res.json(gameManager.adminEndGame(normalizeRoomCode(req.params.code),req.body?.winner));}catch(e){res.status(400).json({error:e.message});}});
  app.delete('/api/admin/games/:code',requireAdmin,async (req,res)=>{try{const gameCode=normalizeRoomCode(req.params.code);const result=gameManager.adminDeleteGame(gameCode);fetch(config.botManager.url+'/bots/by-conclave/'+encodeURIComponent(gameCode),{method:'DELETE',headers:{'Authorization':`Bearer ${config.botManager.adminApiKey}`,'Content-Type':'application/json'}}).catch(()=>{});res.json(result);}catch(e){res.status(400).json({error:e.message});}});
  app.get('/api/admin/players',requireAdmin,(req,res)=>{try{res.json(gameManager.adminListPlayers());}catch(e){res.status(500).json({error:e.message});}});
  app.post('/api/admin/players/:playerCode/merge',requireAdmin,(req,res)=>{try{const result=gameManager.adminMergePlayer(req.params.playerCode,req.body?.targetPlayerCode);res.json(result);}catch(e){res.status(400).json({error:e.message});}});
  app.delete('/api/admin/players/:playerCode',requireAdmin,(req,res)=>{try{res.json(gameManager.adminDeletePlayer(req.params.playerCode));}catch(e){res.status(400).json({error:e.message});}});
  app.get('/api/admin/game-logs',requireAdmin,(req,res)=>{try{res.json({logs:listGameLogs({limit:String(req.query.limit||'')})});}catch(e){res.status(500).json({error:e.message});}});
  app.get('/api/admin/game-logs/:id',requireAdmin,(req,res)=>{try{const log=getGameLog(req.params.id);if(!log)return res.status(404).json({error:'Game log not found'});res.json({log});}catch(e){res.status(500).json({error:e.message});}});
  app.delete('/api/admin/game-logs/:id',requireAdmin,(req,res)=>{try{res.json({deleted:deleteGameLog(req.params.id)});}catch(e){res.status(400).json({error:e.message});}});
  // ── Bot manager ↔ engine auth ────────────────────────────────────────────
  // The bot-manager talks to us with BOT_API_KEY as a bearer token. Both tokens
  // must be set before these endpoints accept anything — fail-closed.
  function requireBotApiKey(req,res,next){
    res.set('Cache-Control','no-store');
    if(!config.botManager.botApiKey)return res.status(503).json({error:'BOT_API_KEY is not configured on the engine'});
    const header=req.get('Authorization')||'';
    if(!header.startsWith('Bearer ')||!constantTimeEquals(header.slice(7),config.botManager.botApiKey))return res.status(403).json({error:'Bot API key required'});
    next();
  }
  app.post('/api/bots/spawn',requireBotApiKey,(req,res)=>{try{const code=normalizeRoomCode(req.body?.conclaveCode||req.body?.code);const r=gameManager.adminSpawnBot(code,{name:req.body?.name,seatHint:req.body?.seatHint});res.json(r);}catch(e){res.status(400).json({error:e.message});}});
  app.delete('/api/bots/despawn',requireBotApiKey,(req,res)=>{try{const code=normalizeRoomCode(req.body?.conclaveCode||req.body?.code||req.query.code);const playerCode=requirePlayerCode(req.body?.playerCode||req.query.playerCode);res.json(gameManager.adminDespawnBot(code,playerCode));}catch(e){res.status(400).json({error:e.message});}});
  // ── Admin panel → bot-manager proxy ─────────────────────────────────────
  // The browser holds ADMIN_PASSWORD; we validate it (via requireAdmin), then
  // present ADMIN_API_KEY to the bot-manager on the proxy hop. The browser
  // never sees either ADMIN_API_KEY or SIM_BYPASS_TOKEN.
  const botsLocked = process.env.NODE_ENV === 'production' && isDefaultAdminApiKey();
  if (botsLocked) console.error('[SECURITY] Refusing bot admin proxy: ADMIN_API_KEY is unset in production.');
  function botProxy(req,res,subPath,{method,withBody}){const url=`${config.botManager.url}${subPath}`;const init={method,headers:{'Authorization':`Bearer ${config.botManager.adminApiKey}`,'Content-Type':'application/json','X-Proxied-From':'heresy-server'}};if(withBody)init.body=JSON.stringify(req.body||{});fetch(url,init).then(async upstream=>{const text=await upstream.text();res.status(upstream.status);const ct=upstream.headers.get('content-type');if(ct)res.set('Content-Type',ct);res.send(text);}).catch(e=>{res.status(502).json({error:'Bot manager unreachable',detail:e.message});});}
  // botProxy builds its upstream URL from subPath alone — it never looks at
  // req.query, so a GET route that needs to forward query params (like
  // /thoughts's since/conclave/bot/kinds/limit) must bake them into subPath
  // itself. new URL(...).search re-serializes req.originalUrl's query string
  // (or '' if there is none) rather than hand-splicing '?'.
  function forwardQuery(req){return new URL(req.originalUrl,'http://x').search;}
  function requireBotsAdmin(req,res,next){res.set('Cache-Control','no-store');if(botsLocked)return res.status(503).json({error:'ADMIN_API_KEY is not configured'});if(!constantTimeEquals(req.get('X-Admin-Password'),config.adminPassword))return res.status(401).json({error:'Admin password required'});next();}
  app.post('/api/admin/bots',requireBotsAdmin,(req,res)=>botProxy(req,res,'/bots',{method:'POST',withBody:true}));
  app.get('/api/admin/bots',requireBotsAdmin,(req,res)=>botProxy(req,res,'/bots',{method:'GET',withBody:false}));
  // Must be registered before /api/admin/bots/:id — Express matches route
  // order, and :id would otherwise swallow 'profiles' or 'thoughts' as a bot id.
  app.get('/api/admin/bots/profiles',requireBotsAdmin,(req,res)=>botProxy(req,res,'/profiles',{method:'GET',withBody:false}));
  // GET /thoughts — the cross-bot admin feed (BOT_THOUGHTS_FEED_PLAN.md §2.3).
  // Pure hidden information (roles, factions, bot reasoning); requireBotsAdmin
  // gates it exactly like every other bot route. Query string (since/conclave/
  // bot/kinds/limit) is forwarded verbatim to the bot-manager, which does all
  // validation/clamping itself — this hop trusts nothing beyond passing it through.
  app.get('/api/admin/bots/thoughts',requireBotsAdmin,(req,res)=>botProxy(req,res,`/thoughts${forwardQuery(req)}`,{method:'GET',withBody:false}));
  app.get('/api/admin/bots/:id',requireBotsAdmin,(req,res)=>botProxy(req,res,`/bots/${encodeURIComponent(req.params.id)}`,{method:'GET',withBody:false}));
  app.delete('/api/admin/bots/:id',requireBotsAdmin,(req,res)=>botProxy(req,res,`/bots/${encodeURIComponent(req.params.id)}`,{method:'DELETE',withBody:false}));
  app.post('/api/admin/bots/:id/notes',requireBotsAdmin,(req,res)=>botProxy(req,res,`/bots/${encodeURIComponent(req.params.id)}/notes`,{method:'POST',withBody:true}));
  app.get('/api/admin/bots/:id/notes',requireBotsAdmin,(req,res)=>botProxy(req,res,`/bots/${encodeURIComponent(req.params.id)}/notes`,{method:'GET',withBody:false}));
  // ── Admin panel → heresy-sim proxy ──────────────────────────────────────
  // Same shared-secret-on-the-hop model as botProxy above: the browser holds
  // ADMIN_PASSWORD (validated by requireSimAdmin), we then present
  // SIM_BYPASS_TOKEN to heresy-sim on the proxy hop. The browser never sees
  // SIM_BYPASS_TOKEN. requireSimAdmin is deliberately its own middleware —
  // NOT a reuse of requireBotsAdmin — because requireBotsAdmin fails closed
  // on ADMIN_API_KEY (bot-manager's secret), which has nothing to do with
  // whether SIM_BYPASS_TOKEN (heresy-sim's secret) is configured. Mirrors
  // requireBotsAdmin's fail-closed-on-downstream-secret shape, keyed to the
  // secret this route actually depends on.
  const simLocked = process.env.NODE_ENV === 'production' && !config.sim.bypassToken;
  if (simLocked) console.error('[SECURITY] Refusing sim admin proxy: SIM_BYPASS_TOKEN is unset in production.');
  function requireSimAdmin(req,res,next){res.set('Cache-Control','no-store');if(simLocked)return res.status(503).json({error:'SIM_BYPASS_TOKEN is not configured'});if(!constantTimeEquals(req.get('X-Admin-Password'),config.adminPassword))return res.status(401).json({error:'Admin password required'});next();}
  function simProxy(req,res,body){
    if(!config.sim.bypassToken)return res.status(503).json({error:'SIM_BYPASS_TOKEN is not configured'});
    const url=`${config.sim.url}/simulate`;
    const init={method:'POST',headers:{'Authorization':`Bearer ${config.sim.bypassToken}`,'Content-Type':'application/json','X-Proxied-From':'heresy-server'},body:JSON.stringify(body)};
    fetchWithTimeout(url,init,config.sim.fetchTimeoutMs).then(async upstream=>{const text=await upstream.text();res.status(upstream.status);const ct=upstream.headers.get('content-type');if(ct)res.set('Content-Type',ct);res.send(text);}).catch(e=>{const timedOut=e.name==='AbortError';res.status(timedOut?504:502).json({error:timedOut?'heresy-sim request timed out':'heresy-sim unreachable',detail:e.message});});
  }
  app.post('/api/admin/simulate',requireSimAdmin,(req,res)=>{
    const {composition,games,seed}=req.body||{};
    const resolved=resolveSimComposition(composition,gameManager);
    if(!resolved.ok)return res.status(400).json({error:'Invalid composition',details:resolved.errors});
    const clampedGames=Math.max(1,Math.min(config.sim.maxGamesAdmin,Number.isFinite(Number(games))?Math.floor(Number(games)):config.sim.maxGamesAdmin));
    const body={composition,games:clampedGames};
    if(Number.isFinite(Number(seed)))body.seed=Number(seed);
    simProxy(req,res,body);
  });
  app.use((err,req,res,next)=>{if(err?.message==='Origin not allowed')return res.status(403).json({error:'Origin not allowed'});next(err);});
  // Per-lobby simulate cooldown, keyed by game code — NOT by socket.id like
  // socketLimiter below. socketLimiter's rate limiting is trivially bypassed
  // by a host reconnecting on a fresh socket; this Map survives that because
  // it's scoped to the lobby, not the connection. Uses gameManager.now() (the
  // injectable clock) rather than Date.now() so tests can control it exactly
  // like every other time-dependent fixture in this repo.
  const simCooldowns=new Map();// code -> { ts, key: simCompositionKey(lastComposition) }
  const socketLimiter=new SocketRateLimiter({
    'game:create': { points: 5, duration: 60_000 },
    'game:join': { points: 20, duration: 60_000 },
    'chat:send': { points: 12, duration: 10_000 },
    'chat:send-as': { points: 12, duration: 10_000 },
    'vote:submit': { points: 20, duration: 10_000 },
    'vote:submit-as': { points: 20, duration: 10_000 },
    'action:submit': { points: 20, duration: 10_000 },
    'action:submit-faction': { points: 20, duration: 10_000 },
    'game:kick': { points: 6, duration: 60_000 },
    'notes:add': { points: 30, duration: 10_000 },
    'notes:edit': { points: 30, duration: 10_000 },
    'bookmark:toggle': { points: 30, duration: 10_000 }
  });
  const io=new Server(server,{cors:{origin:allowed==='*'?'*':allowed,methods:['GET','POST'],credentials:false},allowRequest(req,cb){cb(null,isRequestOriginAllowed(req,allowed));},maxHttpBufferSize:32768,transports:['websocket'],pingTimeout:10000,pingInterval:20000});
  function ackWrap(socket,event,fn){socket.on(event,async(payload={},ack=(/** @type {any} */ _response)=>{})=>{try{if(socketLimiter.isRateLimited(socket.id,event))throw new Error('Rate limit exceeded');const data=await fn(payload);ack({ok:true,...(data&&typeof data==='object'?data:{data})});}catch(error){ack({ok:false,error:error.message});}});}
  function auth(socket,payload){const supplied=payload.playerCode||socket.handshake.auth?.playerCode;const existing=socket.data.playerCode&&!socket.data.playerCode.startsWith('spec_')?socket.data.playerCode:null;const playerCode=requirePlayerCode(supplied||existing);socket.data.playerCode=playerCode;return playerCode;}
  // Spectator-vs-player is derived fresh per CODE from the DB (does an
  // hr_players row exist for this playerCode in this game?) rather than
  // trusted from socket.data.isSpectator. That flag is set once by
  // game:spectate and never cleared, but a single socket can be a real
  // member of one room and a spectator of another at the same time — the
  // conclave switcher makes hopping between such games routine — so a
  // connection-wide boolean gave every OTHER room that socket is in the
  // same (wrong) spectator verdict the moment it ever spectated anything.
  // Room-scoped socket lookup: these fan-out functions run on nearly every
  // socket event, so they must only touch sockets actually in `code`'s room
  // instead of scanning every socket connected to the server across all
  // concurrent games.
  function socketsInRoom(code){const ids=io.sockets.adapter.rooms.get(code);if(!ids)return[];const out=[];for(const id of ids){const s=io.sockets.sockets.get(id);if(s)out.push(s);}return out;}
  function broadcast(code,event='game:state'){for(const socket of socketsInRoom(code)){const isSpectator=!socket.data.playerCode&&socket.data.spectatorCode;if(!socket.data.playerCode&&!isSpectator)continue;try{const state=socket.data.playerCode?gameManager.state(code,socket.data.playerCode):gameManager.spectate(code);socket.emit(event,{state});if(state.status==='ended')socket.emit('game:ended',{state});}catch{}}}
  function broadcastMessage(code,message){// Sanitized once, outside the loop: routing below still reads the RAW row's
  // recipient_code, but every client receives the projection that carries the
  // apparent author instead of the true one (see publicMessage).
  const safe=gameManager.publicMessage(code,message);for(const client of socketsInRoom(code)){try{const isSpectator=!client.data.playerCode&&client.data.spectatorCode;if(!client.data.playerCode&&!isSpectator)continue;const player=client.data.playerCode?gameManager.player(code,client.data.playerCode):null;if(!player){if(message.channel==='public')client.emit('chat:message',{message:safe});continue;}if(message.channel==='public'||(message.channel==='faction'&&player.faction==='heretic'&&player.alive)||(message.channel==='graveyard'&&!player.alive)||(message.channel==='private'&&message.recipient_code===client.data.playerCode))client.emit('chat:message',{message:safe});}catch{}}}
  function broadcastAnnouncement(code,announcement){
    // Targeted announcements (role-reveal per-player) must never be
    // broadcast to the whole room — deliver only to the intended socket.
    if (announcement.targetCode) {
      for (const s of socketsInRoom(code)) {
        if (s.data.playerCode === announcement.targetCode) {
          s.emit('game:announcement',{announcement});
          return;
        }
      }
      return;
    }
    io.to(code).emit('game:announcement',{announcement});
  }
  // Targeted delivery to a single bot socket (identified by payload.playerCode).
  function broadcastBotPrompt(code,payload){const evt=payload.kind;for(const s of socketsInRoom(code)){if(!s.data.playerCode||s.data.playerCode!==payload.playerCode)continue;s.emit(evt,payload);}}
  // Auto-filed bookmarks (autoBookmark) are hidden information — a dossier
  // entry the engine filed on one player's behalf — so this mirrors
  // broadcastBotPrompt's single-socket targeting rather than broadcastMessage's
  // room fan-out: only the owner's own socket(s) ever see it, never io.to(code).
  // Lets the client append the row to its bookmarks list live instead of
  // waiting for the next notes:list reload (bugfix-round §4).
  function broadcastBookmark(code,ownerCode,bookmark){for(const s of socketsInRoom(code)){if(!s.data.playerCode||s.data.playerCode!==ownerCode)continue;s.emit('bookmark:added',{bookmark});}}
  // Fan-out to every bot socket joined to `code`. `payloadFor(botPlayer)` builds
  // the per-bot payload (so we can stamp botId/role per recipient).
  function broadcastBots(code,event,payloadFor){for(const s of socketsInRoom(code)){if(!s.data.playerCode)continue;try{const player=gameManager.player(code,s.data.playerCode);if(!player||!player.is_bot)continue;s.emit(event,payloadFor(player));}catch{}}}
  io.on('connection',socket=>{
    // Player preferences (seal style, etc.) — not tied to any specific game.
    ackWrap(socket,'player:prefs:get',p=>({prefs:gameManager.getPlayerPrefs(auth(socket,p))}));
    ackWrap(socket,'player:prefs:set',p=>({prefs:gameManager.setPlayerPrefs(auth(socket,p),p.prefs)}));
    // Private notes & bookmarks. Owner is ALWAYS the authenticated socket's
    // own playerCode (auth(socket,p)) — never taken from the payload — and
    // responses go back through the ack ONLY. There is no per-player socket
    // room in this codebase (sockets only join the per-game room), so unlike
    // nearly every other handler above, none of these ever broadcast via
    // io.to(code).emit(...): that would leak one player's private notes to
    // everyone else in the lobby.
    ackWrap(socket,'notes:list',p=>{const code=normalizeRoomCode(p.code),ownerCode=auth(socket,p);return gameManager.listNotes(code,ownerCode);});
    ackWrap(socket,'notes:add',p=>{const code=normalizeRoomCode(p.code),ownerCode=auth(socket,p);return {note:gameManager.addNote(code,ownerCode,p.subjectCode,p.body)};});
    ackWrap(socket,'notes:edit',p=>{const code=normalizeRoomCode(p.code),ownerCode=auth(socket,p);return {note:gameManager.editNote(code,ownerCode,p.noteId,p.body)};});
    ackWrap(socket,'notes:delete',p=>{const code=normalizeRoomCode(p.code),ownerCode=auth(socket,p);gameManager.deleteNote(code,ownerCode,p.noteId);return {};});
    ackWrap(socket,'bookmark:toggle',p=>{const code=normalizeRoomCode(p.code),ownerCode=auth(socket,p);return {bookmark:gameManager.toggleBookmark(code,ownerCode,p.messageId)};});
    ackWrap(socket,'bookmark:note',p=>{const code=normalizeRoomCode(p.code),ownerCode=auth(socket,p);return {bookmark:gameManager.annotateBookmark(code,ownerCode,p.messageId,p.note)};});
    ackWrap(socket,'game:list-mine',p=>({games:gameManager.listPlayerGames(auth(socket,p))}));
    ackWrap(socket,'game:create',p=>{const playerCode=auth(socket,p);const result=gameManager.create({playerCode,name:p.name,mode:p.mode,options:p.options});socket.join(result.code);return result;});
    ackWrap(socket,'game:join',p=>{const playerCode=auth(socket,p),code=normalizeRoomCode(p.code);const state=gameManager.join({code,playerCode,name:p.name});socket.join(code);broadcast(code);return {state};});
    ackWrap(socket,'game:spectate',p=>{const code=normalizeRoomCode(p.code);const normalized=typeof p.playerCode==='string'?normalizePlayerCode(p.playerCode):'';const spectatorCode=normalized.length<4?'spec_'+Math.random().toString(36).slice(2,10)+'_'+Date.now().toString(36).slice(-4):normalized;socket.data.spectatorCode=spectatorCode;socket.join(code);const state=gameManager.spectate(code);return {state,playerCode:spectatorCode};});
    ackWrap(socket,'game:state',p=>{const code=normalizeRoomCode(p.code),playerCode=auth(socket,p);socket.join(code);const isMember=!!gameManager.player(code,playerCode);if(!isMember){const state=gameManager.spectate(code);return {state};}const state=gameManager.reconnect(code,playerCode);broadcast(code);return {state};});
    ackWrap(socket,'game:ready',p=>{const code=normalizeRoomCode(p.code),state=gameManager.ready(code,auth(socket,p),p.ready);broadcast(code);return {state};});
    ackWrap(socket,'game:start',p=>{const code=normalizeRoomCode(p.code);const result=gameManager.start(code,auth(socket,p),p.setup);if(result&&'ok' in result&&result.ok===false)return result;broadcast(code,'phase:updated');// After role seal, push a per-bot session_init so the bot-manager can wire its role/faction/claim block.
      broadcastBots(code,'bot:session_init',(bot)=>gameManager.botSessionInit(code,bot.player_code));return{state:result};});
    ackWrap(socket,'game:configure',p=>{const code=normalizeRoomCode(p.code);gameManager.configure(code,auth(socket,p),p.setup);broadcast(code);return{state:gameManager.state(code,socket.data.playerCode)};});
    ackWrap(socket,'game:advance-phase',p=>{const code=normalizeRoomCode(p.code);gameManager.advance(code,auth(socket,p));broadcast(code,'phase:updated');return {state:gameManager.state(code,socket.data.playerCode)};});
    ackWrap(socket,'chat:history',p=>(gameManager.historyMessages(normalizeRoomCode(p.code),auth(socket,p),p.channel,p.before,p.limit)));
    ackWrap(socket,'chat:send',p=>{const code=normalizeRoomCode(p.code),message=gameManager.sendMessage(code,auth(socket,p),p.channel||'public',p.body);broadcastMessage(code,message);return {message};});
    // H6 Animus's possession-day chat — no once-per-day limit (unlike
    // Conspirator's forge), target is never client-supplied (see
    // sendMessageAs's own comment).
    ackWrap(socket,'chat:send-as',p=>{const code=normalizeRoomCode(p.code),message=gameManager.sendMessageAs(code,auth(socket,p),p.body);broadcastMessage(code,message);return {message};});
    ackWrap(socket,'vote:submit',p=>{const code=normalizeRoomCode(p.code),result=gameManager.vote(code,auth(socket,p),String(p.targetCode||''),p.justification);io.to(code).emit('vote:state',{votes:result.votes});if(result.message)broadcastMessage(code,result.message);return {votes:result.votes};});
    ackWrap(socket,'vote:retract',p=>{const code=normalizeRoomCode(p.code),votes=gameManager.retractVote(code,auth(socket,p));io.to(code).emit('vote:state',{votes});return {votes};});
    ackWrap(socket,'vote:submit-as',p=>{const code=normalizeRoomCode(p.code),result=gameManager.voteAs(code,auth(socket,p),String(p.targetCode||''),p.justification);io.to(code).emit('vote:state',{votes:result.votes});if(result.message)broadcastMessage(code,result.message);return {votes:result.votes};});
    ackWrap(socket,'vote:retract-as',p=>{const code=normalizeRoomCode(p.code),votes=gameManager.retractVoteAs(code,auth(socket,p));io.to(code).emit('vote:state',{votes});return {votes};});
    ackWrap(socket,'action:submit',p=>{const code=normalizeRoomCode(p.code),action=gameManager.submitAction(code,auth(socket,p),p);if(action?.message)broadcastMessage(code,action.message);return {action};});
    ackWrap(socket,'action:retract',p=>{const code=normalizeRoomCode(p.code);gameManager.retractAction(code,auth(socket,p));return {action:null};});
    ackWrap(socket,'action:submit-faction',p=>{const code=normalizeRoomCode(p.code),action=gameManager.submitFactionAction(code,auth(socket,p),p);return {action};});
    ackWrap(socket,'game:leave',p=>{const code=normalizeRoomCode(p.code),playerCode=auth(socket,p);socket.leave(code);const result=gameManager.leave(code,playerCode);if(!result.disbanded)broadcast(code);return result;});
    ackWrap(socket,'game:kick',p=>{const code=normalizeRoomCode(p.code);const hostCode=auth(socket,p);const targetCode=requirePlayerCode(p.targetCode);const state=gameManager.kick(code,hostCode,targetCode);for(const other of io.sockets.sockets.values()){if(other.data.playerCode===targetCode&&other.rooms.has(code)){other.emit('game:kicked',{code});other.disconnect(true);}}broadcast(code);return {state};});
    // Host-only lobby roster preview. Request/response only (ack), never broadcast —
    // other lobby members must not see a host's private test-batch results.
    ackWrap(socket,'game:simulate',async p=>{
      const code=normalizeRoomCode(p.code),playerCode=auth(socket,p);
      const g=gameManager.requireHost(code,playerCode);
      if(g.phase!=='lobby')throw new Error('Simulation is only available while the game is in the lobby');
      const nowTs=gameManager.now();
      const lastRun=simCooldowns.get(code);
      const requestedKey=simCompositionKey(p.composition);
      // Re-submitting the EXACT same setup is blocked outright, regardless of
      // how much cooldown time has elapsed — there's nothing new to learn
      // from re-running an unchanged roster. A genuinely different setup
      // only ever has to clear the standard per-lobby cooldown below.
      if(lastRun!==undefined&&lastRun.key===requestedKey){
        throw new Error('This exact setup was already simulated — change the roster to run it again.');
      }
      if(lastRun!==undefined&&nowTs-lastRun.ts<config.sim.hostCooldownMs){
        const waitS=Math.ceil((config.sim.hostCooldownMs-(nowTs-lastRun.ts))/1000);
        throw new Error(`Simulation is cooling down for this lobby — try again in ${waitS}s.`);
      }
      const games=Math.max(1,Math.min(config.sim.maxGamesHost,Number.isFinite(Number(p.games))?Math.floor(Number(p.games)):config.sim.maxGamesHost));
      const resolved=resolveSimComposition(p.composition,gameManager);
      if(!resolved.ok)throw new Error(`Invalid composition: ${resolved.errors.map(e=>e.message).join(' ')}`);
      if(!config.sim.bypassToken)throw new Error('SIM_BYPASS_TOKEN is not configured on the engine');
      // Cooldown is burned here — only once the request has cleared every
      // rejection path and is actually about to hit heresy-sim over the wire.
      simCooldowns.set(code,{ts:nowTs,key:requestedKey});
      const body={composition:p.composition,games};
      if(Number.isFinite(Number(p.seed)))body.seed=Number(p.seed);
      let upstream;
      try{
        upstream=await fetchWithTimeout(`${config.sim.url}/simulate`,{method:'POST',headers:{'Authorization':`Bearer ${config.sim.bypassToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)},config.sim.fetchTimeoutMs);
      }catch(e){
        throw new Error(e.name==='AbortError'?`Simulation request timed out after ${config.sim.fetchTimeoutMs}ms`:`heresy-sim unreachable: ${e.message}`);
      }
      const text=await upstream.text();
      let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
      if(upstream.status<200||upstream.status>=300)throw new Error(data?.error||`heresy-sim returned ${upstream.status}`);
      return {result:data};
    });
    socket.on('disconnecting',()=>{socketLimiter.clear(socket.id);if(socket.data.playerCode){gameManager.disconnect(socket.data.playerCode);for(const room of socket.rooms)broadcast(room);}});
  });
  const timer=setInterval(()=>{for(const code of gameManager.due()){try{gameManager.resolve(code);broadcast(code,'phase:updated');}catch(e){console.error('deadline resolution failed',code,e);}}},1000); timer.unref();
  const close=()=>new Promise(resolve=>{clearInterval(timer);io.close(()=>server.close(()=>{gameManager.close();resolve();}));});
  return {app,server,io,gameManager,close};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const instance=createHeresyServer(); instance.server.listen(config.port,()=>console.info(`Heresy Rising server listening on ${config.port}`));
  const shutdown=()=>instance.close().then(()=>process.exit(0)); process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
