import test from 'node:test';import assert from 'node:assert/strict';
import {createSupportSession} from '../portal-support-session.mjs';
const response=(id,enabled=true)=>new Response(JSON.stringify({ok:true,profile:{id},capabilities:{support_requests:enabled}}),{headers:{'Content-Type':'application/json'}});
test('owner change refuses write and clears view before another owner can receive it',async()=>{let owner='first',writes=0,clears=0;const session=createSupportSession(async url=>url==='/api/portal/me?support=1'?response(owner):(writes++,new Response('{}')));session.attach({reset(){clears++;},dispose(){}});await session.start();owner='second';await assert.rejects(session.fetch('/api/portal/support-requests',{method:'POST'}));assert.equal(writes,0);assert.equal(clears,1);});
test('late response after invalidation is discarded and never retried',async()=>{let finish,writes=0;const session=createSupportSession(async url=>url==='/api/portal/me?support=1'?response('one'):(writes++,new Promise(r=>{finish=r;})));await session.start();const pending=session.fetch('/api/portal/support-requests',{method:'POST'});while(!finish)await new Promise(r=>setTimeout(r,0));session.invalidate();finish(new Response('{}'));await assert.rejects(pending);assert.equal(writes,1);});
test('unstarted or disposed session cannot write',async()=>{let calls=0;const session=createSupportSession(async()=>{calls++;return response('one');});await assert.rejects(session.fetch('/anything'));assert.equal(calls,0);await session.start();session.dispose();await assert.rejects(session.fetch('/anything'));assert.equal(calls,1);});

test('disabled capability refuses initial mount and revocation blocks writes',async()=>{
 let enabled=false,writes=0,clears=0;
 const session=createSupportSession(async url=>url==='/api/portal/me?support=1'?response('one',enabled):(writes++,new Response('{}')));
 session.attach({reset(){clears++;},dispose(){}});
 await assert.rejects(session.start(),/support_disabled/);
 enabled=true;await session.start();enabled=false;
 await assert.rejects(session.fetch('/api/portal/support-requests',{method:'POST'}),/support_disabled/);
 assert.equal(writes,0);assert.equal(clears,2);
});
