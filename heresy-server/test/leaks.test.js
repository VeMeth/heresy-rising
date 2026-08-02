// Hidden-information regression tests.
//
// Every case here encodes a leak that was found in a real audit and fixed. They
// are deliberately written against the projection boundary — what a client
// actually receives — rather than against internal state, because each of these
// bugs was invisible in the UI and visible only in the payload. A field that
// nothing renders is still leaked the moment it reaches a player's socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture(count=5){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heresy-leaks-'));let now=1_000_000;const manager=new HeresyGameManager({databasePath:path.join(dir,'game.db'),now:()=>now,random:()=>0.9});const {code}=manager.create({playerCode:'p0',name:'P0'});for(let i=1;i<count;i++){manager.join({code,playerCode:`p${i}`,name:`P${i}`});manager.ready(code,`p${i}`,true);}return{manager,code,close(){manager.close();fs.rmSync(dir,{recursive:true,force:true});}};}

// ── The true author of a disguised message never reaches a client ──────────
// Conspirator forgery and Animus puppet-speech both store the REAL actor in
// player_code while displaying someone else's name. Broadcasting the raw row
// handed every client the real author of the one thing those mechanics exist
// to disguise.
test('leak: a forged message projects the FRAMED player as author, never the forger',()=>{const f=fixture();try{
  f.manager.start(f.code,'p0');
  const g=f.manager.game(f.code),framed=f.manager.player(f.code,'p2');
  // Hand-build the row shape forge() produces: authored by p1, displayed as p2.
  const row=f.manager.insertMessage(f.code,'public',null,'p1',f.manager.displayName(g,framed),'I was in the crypt all night.','player');
  assert.equal(row.player_code,'p1','precondition: the DB row records the true forger');
  assert.equal(row.author,framed.name,'precondition: it displays the framed player');
  const safe=f.manager.publicMessage(f.code,row);
  assert.equal(safe.player_code,undefined,'the true actor never reaches a client');
  assert.equal(safe.recipient_code,undefined,'routing metadata is stripped too');
  assert.equal(safe.authorCode,'p2','authorCode is the APPARENT speaker, not the forger');
  assert.equal(safe.body,row.body,'the message itself is untouched');
}finally{f.close();}});

test('leak: an Animus puppet message projects the puppet, never the possessor',()=>{const f=fixture();try{
  f.manager.start(f.code,'p0');
  f.manager.db.prepare('UPDATE hr_players SET possessed_by=? WHERE game_code=? AND player_code=?').run('p3',f.code,'p1');
  const msg=f.manager.sendMessageAs(f.code,'p3','Trust me, it wasn\'t me.');
  assert.equal(msg.player_code,'p3','precondition: stored under the possessor');
  const safe=f.manager.publicMessage(f.code,msg);
  assert.equal(safe.authorCode,'p1','resolves to the puppet — who the table believes is speaking');
  assert.notEqual(safe.authorCode,'p3','never the possessor; that would expose the possession outright');
  assert.equal(safe.player_code,undefined);
}finally{f.close();}});

test('leak: an ordinary message still resolves to its real speaker',()=>{const f=fixture();try{
  f.manager.start(f.code,'p0');
  const msg=f.manager.sendMessage(f.code,'p2','public','Where were you?');
  assert.equal(f.manager.publicMessage(f.code,msg).authorCode,'p2','undisguised speech is unaffected');
}finally{f.close();}});

test('leak: a system message has no author code to resolve',()=>{const f=fixture();try{
  f.manager.start(f.code,'p0');
  const msg=f.manager.system(f.code,'Night falls.');
  assert.equal(f.manager.publicMessage(f.code,msg).authorCode,null,'"The Vox" matches no player');
}finally{f.close();}});

// ── A private night scan must not raise a public mark ──────────────────────
// The Interrogator's Red read sets the same tortured_before flag a public
// torture does. Exposing that flag told the whole table an Interrogator exists
// and had just read that player Red — role-identifying, so players could prove
// themselves with it.
test('leak: a Red scan marks the target for the engine but not for the table',()=>{const f=fixture(8);try{
  f.manager.start(f.code,'p0');f.manager.advance(f.code,'p0');
  const interrogator=f.manager.players(f.code).find(p=>p.role_id==='interrogator');
  const target=f.manager.players(f.code).find(p=>p.faction==='loyalist'&&p.role_id!=='interrogator');
  f.manager.db.prepare('UPDATE hr_players SET drift=17 WHERE game_code=? AND player_code=?').run(f.code,target.player_code);
  f.manager.submitAction(f.code,interrogator.player_code,{targetCode:target.player_code,variant:'T1'});
  f.manager.resolve(f.code,true);
  assert.equal(f.manager.player(f.code,target.player_code).tortured_before,1,'engine mark is set — the next torture still escalates');
  const bystander=f.manager.players(f.code).find(p=>p.player_code!==interrogator.player_code&&p.player_code!==target.player_code);
  const seen=f.manager.state(f.code,bystander.player_code).players.find(p=>p.playerCode===target.player_code);
  assert.equal(seen.torturedBefore,false,'a bystander sees no mark — the scan was private');
  assert.equal(seen.crippleTier,0,'and no tier, since no torture happened');
  assert.ok(!f.manager.state(f.code,bystander.player_code).atRiskTargets.includes(target.player_code),'nor does the at-risk list expose it');
  assert.ok(!f.manager.spectate(f.code).atRiskTargets.includes(target.player_code),'spectators no more than players');
}finally{f.close();}});

test('leak: a public torture DOES raise the mark for everyone',()=>{const f=fixture();try{
  f.manager.start(f.code,'p0');
  const target=f.manager.players(f.code).find(p=>p.player_code!=='p0');
  const voters=f.manager.players(f.code).filter(p=>p.player_code!==target.player_code).slice(0,2);
  f.manager.db.prepare("UPDATE hr_games SET phase='day',round=2,day_stage='vote' WHERE code=?").run(f.code);
  for(const v of voters)f.manager.vote(f.code,v.player_code,target.player_code);
  f.manager.resolve(f.code,true);
  const seen=f.manager.state(f.code,'p0').players.find(p=>p.playerCode===target.player_code);
  assert.equal(seen.torturedBefore,true,'a torture everyone watched stays publicly visible');
  assert.ok(f.manager.state(f.code,'p0').atRiskTargets.includes(target.player_code));
}finally{f.close();}});

// ── Blood Ritual kills read as ordinary kills ──────────────────────────────
test('leak: deathCause never distinguishes a Blood Ritual kill from a Murderer kill',()=>{const f=fixture();try{
  f.manager.start(f.code,'p0');
  const victim=f.manager.players(f.code).find(p=>p.player_code!=='p0');
  f.manager.db.prepare("UPDATE hr_players SET alive=0,death_cause='blood-ritual' WHERE game_code=? AND player_code=?").run(f.code,victim.player_code);
  const seen=f.manager.state(f.code,'p0').players.find(p=>p.playerCode===victim.player_code);
  assert.equal(seen.deathCause,'murder','projected as an ordinary kill — the public narration is identical, so this must be too');
  assert.equal(f.manager.spectate(f.code).players.find(p=>p.playerCode===victim.player_code).deathCause,'murder');
  assert.equal(f.manager.player(f.code,victim.player_code).death_cause,'blood-ritual','the DB keeps the truth for admin and game logs');
}finally{f.close();}});

// ── Death ends access to your faction's private channel ───────────────────
test('leak: a dead Heretic can no longer read or write faction chat',()=>{const f=fixture(8);try{
  f.manager.start(f.code,'p0');
  const heretic=f.manager.players(f.code).find(p=>p.faction==='heretic');
  f.manager.db.prepare("UPDATE hr_games SET phase='night' WHERE code=?").run(f.code);
  assert.doesNotThrow(()=>f.manager.historyMessages(f.code,heretic.player_code,'faction'),'precondition: a living heretic has access');
  f.manager.db.prepare('UPDATE hr_players SET alive=0 WHERE game_code=? AND player_code=?').run(f.code,heretic.player_code);
  assert.throws(()=>f.manager.historyMessages(f.code,heretic.player_code,'faction'),/denied/i,'the dead cannot read the living cabal');
  assert.throws(()=>f.manager.sendMessage(f.code,heretic.player_code,'faction','orders from beyond'),/denied/i,'nor post into it');
}finally{f.close();}});
