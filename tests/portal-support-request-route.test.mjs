// Synthetic HTTP + local SQLite composition; no provider, mailbox or real identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequestGet,onRequestPost} from '../functions/api/portal/[[path]].js';
import {cookie,ORIGIN} from './helpers/caregiver-profile-fixture.mjs';
import {supportSessionProof} from '../functions/_lib/support-session-proof.mjs';
const payload=()=>({request_id:'synthetic_request_0001',needs:['break'],preferred_contact:'email',message:'Synthetic private text'});
function setup(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());raw.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0001_init.sql','candidates/portal_support_request.sql'])raw.exec(readFileSync(new URL('../schema/'+file,import.meta.url),'utf8'));
 raw.exec("INSERT INTO caregiver(id,first_name,email,phone,status) VALUES('cg_a','Synthetic A','a@example.invalid','5550100','active'),('cg_b','Synthetic B','b@example.invalid','5550200','inactive')");
 const state={reads:0,batches:0,beforeBatch:null,beforeRead:null,loseAck:false};
 const db={prepare(sql){const bind=(...args)=>({sql,args,async first(){state.reads++;await state.beforeRead?.(sql);return raw.prepare(sql).get(...args)||null;},async all(){state.reads++;await state.beforeRead?.(sql);return {results:raw.prepare(sql).all(...args)};}});return {...bind(),bind};},async batch(statements){state.batches++;await state.beforeBatch?.();raw.exec('BEGIN');try{for(const s of statements)raw.prepare(s.sql).run(...s.args);raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}if(state.loseAck)throw Error('synthetic lost ack');}};
 const env={LEGACY_DB:db,PORTAL_TOKEN_SECRET:'synthetic-profile-signing-key',PORTAL_SUPPORT_REQUEST_ENABLED:'1'};
 async function call({method='GET',path='/api/portal/support-requests',body=payload(),id='cg_a',headers={},rawBody}={}){
  const h=new Headers({Origin:ORIGIN,'Content-Type':'application/json',Cookie:await cookie(id)});
  const proofRequest = new Request(ORIGIN+path, {headers:h});
  h.set('X-Support-Session', await supportSessionProof(proofRequest, 'owner', id));
  for(const [k,v]of Object.entries(headers))v===null?h.delete(k):h.set(k,v);
  const request=new Request(ORIGIN+path,{method,headers:h,...(method==='POST'?{body:rawBody??JSON.stringify(body)}:{})});
  return (method==='POST'?onRequestPost:onRequestGet)({request,env});
 }
 const count=()=>raw.prepare('SELECT count(*) n FROM portal_support_request').get().n;
 return {raw,state,env,call,count};
}
test('authenticated create/read uses server owner, keeps retries stable and changed payload conflicting',async t=>{
 const f=setup(t);let r=await f.call({method:'POST'});assert.equal(r.status,201);const a=await r.json();assert.equal(a.ok,true);
 r=await f.call({method:'POST'});assert.equal(r.status,200);assert.equal((await r.json()).id,a.id);
 assert.equal((await f.call({method:'POST',body:{...payload(),needs:['care']}})).status,409);
 assert.equal(f.count(),1);assert.equal(f.raw.prepare('SELECT count(*) n FROM followup').get().n,1);
 const own=await (await f.call()).json();assert.equal(own.requests[0].id,a.id);
 assert.deepEqual((await (await f.call({id:'cg_b'})).json()).requests,[]);
 assert.equal((await f.call({id:'cg_b',method:'POST'})).status,201);
 assert.doesNotMatch(JSON.stringify(f.raw.prepare('SELECT after_json FROM audit_log').all()),/Synthetic private text|example.invalid/);
});
for(const origin of [null,'null','https://other.invalid',ORIGIN+'/',ORIGIN+', '+ORIGIN])test('strict Origin refuses '+origin,async t=>{const f=setup(t);assert.equal((await f.call({method:'POST',headers:{Origin:origin},rawBody:'invalid'})).status,403);assert.equal(f.state.reads,0);assert.equal(f.count(),0);});
for(const type of [null,'text/plain','application/x-www-form-urlencoded'])test('non-JSON refuses '+type,async t=>{const f=setup(t);assert.equal((await f.call({method:'POST',headers:{'Content-Type':type}})).status,415);assert.equal(f.state.reads,0);});
for(const mode of ['flag-off','preview','secret','missing-cookie','expired','tampered','archived','missing-owner'])test('auth/containment '+mode,async t=>{
 const f=setup(t);let status=401,id='cg_a',headers={};
 if(mode==='flag-off'){delete f.env.PORTAL_SUPPORT_REQUEST_ENABLED;status=404;}
 if(mode==='preview'){f.env.ENVIRONMENT='preview';status=503;}
 if(mode==='secret'){delete f.env.PORTAL_TOKEN_SECRET;status=503;}
 if(mode==='missing-cookie')headers.Cookie=null;
 if(mode==='expired')headers.Cookie=await cookie('cg_a',Date.now()-1000);
 if(mode==='tampered')headers.Cookie=(await cookie()).replace('cg_a','cg_b');
 if(mode==='archived')f.raw.exec("UPDATE caregiver SET status='archived' WHERE id='cg_a'");
 if(mode==='missing-owner')id='missing';
 for(const method of ['GET','POST'])assert.equal((await f.call({method,id,headers})).status,status);
 assert.equal(f.count(),0);assert.equal(f.state.batches,0);
});
test('exact route/query/method and body-owner/status injection refuse',async t=>{const f=setup(t);
 for(const path of ['/api/portal/nested/support-requests','/api/portal/support-requests?owner=cg_b','/api/portal/support-requests/'])for(const method of ['GET','POST'])assert.equal((await f.call({method,path})).status,404);
 assert.equal((await f.call({method:'HEAD'})).status,405);
 for(const extra of [{ownerId:'cg_b'},{caregiver_id:'cg_b'},{status:'closed'},{revision:2}])assert.equal((await f.call({method:'POST',body:{...payload(),...extra}})).status,400);
 assert.equal(f.count(),0);
});
test('malformed JSON, invalid UTF8 and actual oversized bytes refuse before writer',async t=>{const f=setup(t);
 for(const rawBody of ['{',new Uint8Array([0xc3,0x28]),JSON.stringify({...payload(),message:'a'.repeat(9000)})])assert.equal((await f.call({method:'POST',rawBody})).status,400);
 assert.equal(f.state.batches,0);
});
test('archive after auth but before write rolls back all rows',async t=>{const f=setup(t);f.state.beforeBatch=()=>f.raw.exec("UPDATE caregiver SET status='archived' WHERE id='cg_a'");assert.equal((await f.call({method:'POST'})).status,500);for(const table of ['portal_support_request','followup','audit_log'])assert.equal(f.raw.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);});
test('late read after archive discloses no stored requests',async t=>{const f=setup(t);await f.call({method:'POST'});f.state.beforeRead=sql=>{if(sql.includes('SELECT r.*'))f.raw.exec("UPDATE caregiver SET status='archived' WHERE id='cg_a'");};assert.deepEqual((await (await f.call()).json()).requests,[]);});
test('lost acknowledgment reconciles through HTTP, audit failure remains generic and atomic',async t=>{const f=setup(t);f.state.loseAck=true;const r=await f.call({method:'POST'});assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);assert.equal(f.count(),1);
 f.state.loseAck=false;f.raw.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'private failure'); END;");const failed=await f.call({method:'POST',body:{...payload(),request_id:'synthetic_request_0002'}});assert.equal(failed.status,500);assert.doesNotMatch(await failed.text(),/private failure|Synthetic private/);assert.equal(f.count(),1);
});
test('missing contact requires action rather than fallback; absent schema stays closed',async t=>{const f=setup(t);f.raw.exec("UPDATE caregiver SET email=NULL WHERE id='cg_a'");assert.equal((await f.call({method:'POST'})).status,422);assert.equal(f.count(),0);f.raw.exec('DROP TABLE portal_support_request');assert.equal((await f.call()).status,500);});

test('owner qualification is required on both operations and bound to the session that opened the view', async t => {
  const f = setup(t);
  const signed = await cookie('cg_a');
  const qualified = await f.call({path:'/api/portal/me?support=1', headers:{Cookie:signed}});
  const {support_session: proof} = await qualified.json();
  assert.match(proof, /^[a-f0-9]{64}$/);
  const expectedReads = f.state.reads;
  for (const [credential, precondition] of [
    [await cookie('cg_b'), proof], [await cookie('cg_a', Date.now()+120000), proof], [signed, null]
  ]) {
    for (const method of ['GET','POST']) {
      const result = await f.call({method, headers:{Cookie:credential,'X-Support-Session':precondition}});
      assert.equal(result.status, 403);
    }
  }
  assert.equal(f.state.reads, expectedReads);
  assert.equal(f.state.batches, 0);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM audit_log').get().n, 0);
  assert.equal((await f.call({headers:{Cookie:signed,'X-Support-Session':proof}})).status, 200);
});
