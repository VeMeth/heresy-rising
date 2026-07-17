import { expect, test } from '@playwright/test';
import { HeresySocketClient } from '../helpers/socketClient.js';

const BASE_URL=process.env.E2E_SERVER_URL||'http://127.0.0.1:4100';

test('five players ready, receive private JSON roles, and enter night',async()=>{
  const stamp=Date.now(),clients=Array.from({length:5},(_,i)=>new HeresySocketClient({baseUrl:BASE_URL,name:`Operative ${i}`,playerCode:`V1-${stamp}-${i}`}));
  try{
    await Promise.all(clients.map(c=>c.connect()));
    const {code}=await clients[0].emit('game:create',{name:clients[0].name,mode:'live',options:{maxDrift:20}});
    for(let i=1;i<clients.length;i++){await clients[i].emit('game:join',{code,name:clients[i].name});await clients[i].emit('game:ready',{code,ready:true});}
    const started=await clients[0].emit('game:start',{code,setup:{maxDrift:20}});
    // Day-first loop: sealing the chamber drops the conclave straight into Day 1
    // with a running deadline — no role-reveal pause, no host gating.
    expect(started.state.phase).toBe('day');
    expect(started.state.round).toBe(1);
    expect(started.state.dayStage).toBe('vote');
    expect(started.state.deadline).toBeGreaterThan(Date.now());
    expect(started.state.me.role.id).toBeTruthy();
    expect(JSON.stringify(started.state)).not.toContain('"drift"');
    const advanced=await clients[0].emit('game:advance-phase',{code});
    expect(advanced.state.phase).toBe('night');
    expect(advanced.state.round).toBe(1);
  }finally{clients.forEach(c=>c.disconnect());}
});
