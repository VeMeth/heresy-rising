import express from 'express';
import http from 'http';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { config } from './config.js';
import { HeresyGameManager } from './heresyGameManager.js';
import { normalizeRoomCode, requirePlayerCode } from './utils.js';
import { SocketRateLimiter } from './socketRateLimiter.js';
import {
  deleteAdminPlayer,
  getAdminPlayers,
  mergeAdminPlayers,
  updateAdminPlayer
} from './leaderboard.js';
import { deleteGameLog, getGameLog, listGameLogs } from './gameLogs.js';

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

export function publicPresetMetadata(players) {
  return { count: Math.max(5, Math.min(12, Number(players)||5)), minPlayers: 5, maxPlayers: 12 };
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createHeresyServer({ databasePath, now } = {}) {
  const app=express(), server=http.createServer(app), allowed=config.cors.allowedOrigins;
  const corsOptions=(req,cb)=>cb(null,{origin:isRequestOriginAllowed(req,allowed),credentials:false});
  app.disable('x-powered-by'); app.set('trust proxy',config.trustProxy?1:false); app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}})); app.use(cors(corsOptions)); app.use(express.json({limit:'32kb'})); app.use(rateLimit({...config.rateLimit,max:config.rateLimit.max||120}));
  const gameManager=new HeresyGameManager({databasePath,now});
  app.get('/api/health',(req,res)=>res.json({status:'ok',time:Date.now()}));
  app.get('/api/game/presets',(req,res)=>{res.set('Cache-Control','no-store').json(publicPresetMetadata(req.query.players));});
  function requireAdmin(req,res,next){res.set('Cache-Control','no-store');if(!constantTimeEquals(req.get('X-Admin-Password'),config.adminPassword))return res.status(401).json({error:'Admin password required'});next();}
  function adminTotals(players,resumes=[]){return players.reduce((totals,player)=>({
    players: totals.players,
    runs: totals.runs + (player.recentRuns?.length || 0),
    gamesPlayed: totals.gamesPlayed + (player.gamesPlayed || 0),
    wins: totals.wins + (player.wins || 0),
    losses: totals.losses + (player.losses || 0),
    activeResumes: resumes.filter(resume => resume.status === 'active').length
  }),{players:players.length,runs:0,gamesPlayed:0,wins:0,losses:0,activeResumes:0});}
  app.post('/api/admin/login',requireAdmin,(_req,res)=>res.json({ok:true}));
  app.get('/api/admin/overview',requireAdmin,(_req,res)=>{try{const players=getAdminPlayers(),resumes=[];res.json({players,resumes,totals:adminTotals(players,resumes)});}catch(e){res.status(500).json({error:e.message});}});
  app.patch('/api/admin/players/:id',requireAdmin,(req,res)=>{try{res.json({player:updateAdminPlayer(Number(req.params.id),req.body)});}catch(e){res.status(400).json({error:e.message});}});
  app.delete('/api/admin/players/:id',requireAdmin,(req,res)=>{try{res.json(deleteAdminPlayer(Number(req.params.id)));}catch(e){res.status(400).json({error:e.message});}});
  app.post('/api/admin/players/merge',requireAdmin,(req,res)=>{try{res.json(mergeAdminPlayers(req.body?.sourcePlayerId,req.body?.targetPlayerId));}catch(e){res.status(400).json({error:e.message});}});
  app.get('/api/admin/resumes',requireAdmin,(_req,res)=>res.json({resumes:[]}));
  app.patch('/api/admin/resumes/:code',requireAdmin,(req,res)=>res.status(404).json({error:'Resumes are not available in this game backend'}));
  app.get('/api/admin/game-logs',requireAdmin,(req,res)=>{try{res.json({logs:listGameLogs({limit:req.query.limit})});}catch(e){res.status(500).json({error:e.message});}});
  app.get('/api/admin/game-logs/:id',requireAdmin,(req,res)=>{try{const log=getGameLog(req.params.id);if(!log)return res.status(404).json({error:'Game log not found'});res.json({log});}catch(e){res.status(500).json({error:e.message});}});
  app.delete('/api/admin/game-logs/:id',requireAdmin,(req,res)=>{try{res.json({deleted:deleteGameLog(req.params.id)});}catch(e){res.status(400).json({error:e.message});}});
  function requestPlayerCode(req){return requirePlayerCode(req.get('X-Player-Code')||req.query.playerCode);}
  app.get('/api/game/:code',(req,res)=>{try{res.set('Cache-Control','no-store').json({state:gameManager.state(normalizeRoomCode(req.params.code),requestPlayerCode(req))});}catch(e){res.status(400).json({error:e.message});}});
  app.get('/api/game/:code/chat',(req,res)=>{try{res.set('Cache-Control','no-store').json({messages:gameManager.historyMessages(normalizeRoomCode(req.params.code),requestPlayerCode(req),req.query.channel,req.query.before,req.query.limit)});}catch(e){res.status(400).json({error:e.message});}});
  app.use((err,req,res,next)=>{if(err?.message==='Origin not allowed')return res.status(403).json({error:'Origin not allowed'});next(err);});
  const socketLimiter=new SocketRateLimiter({
    'game:create': { points: 5, duration: 60_000 },
    'game:join': { points: 20, duration: 60_000 },
    'chat:send': { points: 12, duration: 10_000 },
    'vote:submit': { points: 20, duration: 10_000 },
    'action:submit': { points: 20, duration: 10_000 }
  });
  const io=new Server(server,{cors:{origin:allowed==='*'?'*':allowed,methods:['GET','POST'],credentials:false},allowRequest(req,cb){cb(null,isRequestOriginAllowed(req,allowed));},maxHttpBufferSize:32768,transports:['websocket'],pingTimeout:10000,pingInterval:20000});
  function ackWrap(socket,event,fn){socket.on(event,async(payload={},ack=()=>{})=>{try{if(socketLimiter.isRateLimited(socket.id,event))throw new Error('Rate limit exceeded');const data=await fn(payload);ack({ok:true,...(data&&typeof data==='object'?data:{data})});}catch(error){ack({ok:false,error:error.message});}});}
  function auth(socket,payload){const playerCode=requirePlayerCode(payload.playerCode||socket.data.playerCode||socket.handshake.auth?.playerCode);socket.data.playerCode=playerCode;return playerCode;}
  function broadcast(code,event='game:state'){for(const socket of io.sockets.sockets.values()){if(socket.rooms.has(code)&&socket.data.playerCode){try{const state=gameManager.state(code,socket.data.playerCode);socket.emit(event,{state});if(state.status==='ended')socket.emit('game:ended',{state});}catch{}}}}
  function broadcastMessage(code,message){for(const client of io.sockets.sockets.values()){if(!client.rooms.has(code)||!client.data.playerCode)continue;const player=gameManager.player(code,client.data.playerCode);if(!player)continue;if(message.channel==='public'||(message.channel==='faction'&&player.faction==='heretic')||(message.channel==='graveyard'&&!player.alive))client.emit('chat:message',{message});}}
  io.on('connection',socket=>{
    ackWrap(socket,'game:create',p=>{const playerCode=auth(socket,p);const result=gameManager.create({playerCode,name:p.name,mode:p.mode,options:p.options});socket.join(result.code);return result;});
    ackWrap(socket,'game:join',p=>{const playerCode=auth(socket,p),code=normalizeRoomCode(p.code);const state=gameManager.join({code,playerCode,name:p.name});socket.join(code);broadcast(code);return {state};});
    ackWrap(socket,'game:state',p=>({state:gameManager.state(normalizeRoomCode(p.code),auth(socket,p))}));
    ackWrap(socket,'game:ready',p=>{const code=normalizeRoomCode(p.code),state=gameManager.ready(code,auth(socket,p),p.ready);broadcast(code);return {state};});
    ackWrap(socket,'game:start',p=>{const code=normalizeRoomCode(p.code),state=gameManager.start(code,auth(socket,p),p.setup);broadcast(code,'phase:updated');return {state};});
    ackWrap(socket,'game:advance-phase',p=>{const code=normalizeRoomCode(p.code);gameManager.advance(code,auth(socket,p),true);broadcast(code,'phase:updated');return {state:gameManager.state(code,socket.data.playerCode)};});
    ackWrap(socket,'chat:history',p=>({messages:gameManager.historyMessages(normalizeRoomCode(p.code),auth(socket,p),p.channel,p.before,p.limit)}));
    ackWrap(socket,'chat:send',p=>{const code=normalizeRoomCode(p.code),message=gameManager.sendMessage(code,auth(socket,p),p.channel||'public',p.body);broadcastMessage(code,message);return {message};});
    ackWrap(socket,'vote:submit',p=>{const code=normalizeRoomCode(p.code),votes=gameManager.vote(code,auth(socket,p),String(p.targetCode||''),p.justification);io.to(code).emit('vote:state',{votes});return {votes};});
    ackWrap(socket,'vote:retract',p=>{const code=normalizeRoomCode(p.code),votes=gameManager.retractVote(code,auth(socket,p));io.to(code).emit('vote:state',{votes});return {votes};});
    ackWrap(socket,'action:submit',p=>{const code=normalizeRoomCode(p.code),action=gameManager.submitAction(code,auth(socket,p),p);if(action?.message)broadcastMessage(code,action.message);return {action};});
    ackWrap(socket,'action:retract',p=>{gameManager.retractAction(normalizeRoomCode(p.code),auth(socket,p));return {};});
    ackWrap(socket,'interrogation:respond',p=>{const code=normalizeRoomCode(p.code),state=gameManager.respondInterrogation(code,auth(socket,p),p.response);broadcast(code,'phase:updated');return {state};});
    ackWrap(socket,'confession:ask',p=>{const code=normalizeRoomCode(p.code),state=gameManager.askConfession(code,auth(socket,p),String(p.targetCode||''));broadcast(code,'phase:updated');return {state};});
    ackWrap(socket,'game:leave',p=>{const code=normalizeRoomCode(p.code);auth(socket,p);socket.leave(code);return {};});
    socket.on('disconnect',()=>{socketLimiter.clear(socket.id);if(socket.data.playerCode){gameManager.disconnect(socket.data.playerCode);for(const room of socket.rooms)broadcast(room);}});
  });
  const timer=setInterval(()=>{for(const code of gameManager.due()){try{gameManager.resolve(code);broadcast(code,'phase:updated');}catch(e){console.error('deadline resolution failed',code,e);}}},1000); timer.unref();
  const close=()=>new Promise(resolve=>{clearInterval(timer);io.close(()=>server.close(()=>{gameManager.close();resolve();}));});
  return {app,server,io,gameManager,close};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const instance=createHeresyServer(); instance.server.listen(config.port,()=>console.log(`Heresy Rising server listening on ${config.port}`));
  const shutdown=()=>instance.close().then(()=>process.exit(0)); process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
