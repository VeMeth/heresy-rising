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
    expect(started.state.phase).toBe('role-reveal');
    expect(started.state.me.role.id).toBeTruthy();
    expect(JSON.stringify(started.state)).not.toContain('"drift"');
    const advanced=await clients[0].emit('game:advance-phase',{code});
    expect(advanced.state.phase).toBe('night');
  }finally{clients.forEach(c=>c.disconnect());}
});
