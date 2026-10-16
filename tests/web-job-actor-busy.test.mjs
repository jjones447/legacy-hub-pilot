// [pc2-codex-42] NEW exact-schema fictional persistence counterexample, not live D1 proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWebJob} from '../functions/_lib/assistant-web-jobs.mjs';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
const SOURCE=readFileSync(new URL('../functions/_lib/assistant-web-jobs.mjs',import.meta.url),'utf8');
const INSERT=SOURCE.match(/prepare\("(INSERT INTO assistant_web_job\(id,actor,idempotency_key[^"\n]+)"\)/)?.[1];
assert.ok(INSERT,'Actual create persistence SQL must remain literal and independently testable');
const ORIGIN='https://legacy-hub-d7-acceptance.pages.dev',ACTOR='fictional@example.invalid',OLD=1900000000,NOW=OLD+7200;
const KEY='000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'; // PUBLIC FAKE ONLY.
const OLD_ID='a'.repeat(32),OLD_KEY='b'.repeat(32),NEW_KEY='c'.repeat(32);
function rowArgs(id,actor,key,now){return [id,actor,key,'d'.repeat(64),'e'.repeat(32),ORIGIN,JSON.stringify({request:'FICTIONAL request',area:'content'}),now+60,now+240,now];}
function fixture({state='hold',dispatch='reserved',actor=ACTOR,origin=ORIGIN}={}){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../schema/candidates/0016_assistant_web_job.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE staff_member(email TEXT PRIMARY KEY,status TEXT);CREATE TABLE content_item(id TEXT PRIMARY KEY,type_id TEXT,data TEXT,status TEXT,updated_by TEXT);CREATE TABLE content_type(id TEXT PRIMARY KEY,json_schema TEXT);CREATE TABLE audit_log(id INTEGER PRIMARY KEY)');
 db.prepare('INSERT INTO staff_member VALUES(?,?)').run(ACTOR,'active');
 db.prepare('INSERT INTO content_item VALUES(?,?,?,?,?)').run('ps_home.hero','page_section',JSON.stringify({section_key:'home.hero',title:'Fictional current'}),'published','fixture');
 db.prepare('INSERT INTO content_type VALUES(?,?)').run('page_section',JSON.stringify({oneOf:[{properties:{section_key:{const:'home.hero'},title:{type:'string'}}}]}));
 db.prepare(INSERT).run(...rowArgs(OLD_ID,actor,OLD_KEY,OLD));
 // Fictional setup only. The before-witness is taken AFTER this fixture seeding.
 db.prepare('UPDATE assistant_web_job SET state=?,dispatch_state=?,app_origin=? WHERE id=?').run(state,dispatch,origin,OLD_ID);
 const before={job:{...db.prepare('SELECT * FROM assistant_web_job WHERE id=?').get(OLD_ID)},target:db.prepare('SELECT * FROM content_item').all(),changes:db.prepare('SELECT total_changes() n').get().n};
 const effects={sends:0,sql:[],race:null,failBusy:false};
 const dbPort={prepare(sql){effects.sql.push(sql);const bind=params=>({first:async()=>{if(effects.failBusy&&sql.startsWith('SELECT id FROM assistant_web_job WHERE actor'))throw Error('FICTIONAL_PRIVATE_DB_ERROR');const result=db.prepare(sql).get(...params)??null;if(effects.race&&sql.startsWith('SELECT id FROM assistant_web_job WHERE actor')){effects.race();effects.race=null;}return result;},run:async()=>db.prepare(sql).run(...params)});return {...bind([]),bind:(...params)=>bind(params)};}};
 const env={ENVIRONMENT:'preview',LEGACY_DB:dbPort,ASSISTANT_WEB_JOBS_ENABLED:'1',ASSISTANT_APP_ORIGIN:ORIGIN,ASSISTANT_WORKSPACE:'TSYNTHETIC',ASSISTANT_CHANNEL:'CSYNTHETIC',ASSISTANT_WEB_JOB_APP_ID:'ASYNTHETIC',ASSISTANT_WEB_JOB_SEAT_ID:'pc2-test-seat',ASSISTANT_WEB_JOB_KEY_HEX:KEY,ASSISTANT_WEB_JOB_TRANSPORT:async p=>{effects.sends++;return {channel:p.channel,ts:'1900007200.001'};}};
 const context=({key=NEW_KEY,verified=true,origin=ORIGIN}={})=>{const data={};if(verified)setVerifiedAccessStaffActor(data,ACTOR);return {env,data,request:new Request(ORIGIN+'/api/agent/draft',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({type_id:'page_section',target_id:'ps_home.hero',request:'FICTIONAL request',idempotency_key:key})})};};
 const preserved=()=>{assert.deepEqual({...db.prepare('SELECT * FROM assistant_web_job WHERE id=?').get(OLD_ID)},before.job);assert.deepEqual(db.prepare('SELECT * FROM content_item').all(),before.target);assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n,0);};
 return {db,before,effects,env,context,preserved};
}
test('exact current INSERT conflicts with expired held same-actor row at immutable one-active index',()=>{
 const f=fixture();try{
  assert.ok(f.before.job.expires_at<NOW);assert.equal(f.before.job.dispatch_state,'reserved');
  assert.throws(()=>f.db.prepare(INSERT).run(...rowArgs('f'.repeat(32),ACTOR,NEW_KEY,NOW)),error=>error.errcode===2067&&/UNIQUE constraint failed: assistant_web_job.actor/.test(error.message));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job').get().n,1);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,f.before.changes);f.preserved();
 }finally{f.db.close();}
});

test('all five active states block a distinct key before transport, key, snapshot or any write even after expiry',async()=>{
 for(const state of ['pending','claimed','result','materializing','hold']){
  const f=fixture({state});try{
   Object.defineProperty(f.env,'ASSISTANT_WEB_JOB_TRANSPORT',{get(){throw Error('must not construct transport');}});
   Object.defineProperty(f.env,'ASSISTANT_WEB_JOB_KEY_HEX',{get(){throw Error('must not read key');}});
   const response=await createWebJob(f.context(),NOW),body=await response.json();
   assert.equal(response.status,409);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.deepEqual(body,{ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:'actor_busy',refusal:'A previous assistant request is unresolved. This request was not created or sent. Do not retry; ask the operator to resolve the existing hold.'});
   assert.equal(f.effects.sends,0);assert.equal(f.effects.sql.length,3);
   assert.equal(f.db.prepare('SELECT total_changes() n').get().n,f.before.changes);f.preserved();
  }finally{f.db.close();}
 }
});

test('actor-global active row blocks even at a different stored origin without revealing its identity or fields',async()=>{
 const f=fixture({origin:'https://fictional-other.example.invalid'});try{
  const response=await createWebJob(f.context(),NOW),raw=await response.text();
  assert.equal(response.status,409);assert.equal(JSON.parse(raw).diagnostic_stage,'actor_busy');
  for(const secret of [ACTOR,OLD_ID,OLD_KEY,'fictional-other','FICTIONAL request'])assert.equal(raw.includes(secret),false);
  assert.equal(f.effects.sends,0);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,f.before.changes);f.preserved();
 }finally{f.db.close();}
});

test('same idempotency retains the existing state contract before busy lookup, with no writes or resend',async()=>{
 const f=fixture();try{
  const response=await createWebJob(f.context({key:OLD_KEY}),NOW);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,job_id:OLD_ID,state:'hold'});
  assert.equal(f.effects.sql.some(sql=>sql.startsWith('SELECT id FROM assistant_web_job WHERE actor')),false);
  assert.equal(f.effects.sends,0);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,f.before.changes);f.preserved();
 }finally{f.db.close();}
});

test('only terminal materialized/refused same-actor rows or another actor allow a new pending send',async()=>{
 for(const options of [{state:'materialized'},{state:'refused'},{actor:'other@example.invalid'}]){
  const f=fixture(options);try{
   const response=await createWebJob(f.context(),NOW),body=await response.json();
   assert.equal(response.status,202);assert.equal(body.state,'pending');assert.equal(f.effects.sends,1);
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job').get().n,2);
   assert.equal(f.db.prepare('SELECT dispatch_state FROM assistant_web_job WHERE id<>?').get(OLD_ID).dispatch_state,'sent');f.preserved();
  }finally{f.db.close();}
 }
});

test('a failed busy lookup fails closed without reflection, persistence or transport',async()=>{
 const f=fixture();f.effects.failBusy=true;try{
  const response=await createWebJob(f.context(),NOW),raw=await response.text();
  assert.equal(response.status,409);assert.deepEqual(JSON.parse(raw),{ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:'actor_busy'});
  assert.equal(raw.includes('FICTIONAL_PRIVATE_DB_ERROR'),false);assert.equal(f.effects.sends,0);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,f.before.changes);f.preserved();
 }finally{f.db.close();}
});

test('unchanged unique index still blocks a competing insert after the advisory read; no send or old-row change',async()=>{
 const f=fixture({actor:'other@example.invalid'});try{
  f.effects.race=()=>f.db.prepare(INSERT).run(...rowArgs('f'.repeat(32),ACTOR,'9'.repeat(32),NOW));
  const response=await createWebJob(f.context(),NOW);
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:'persist'});
  assert.equal(f.effects.sends,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job').get().n,2);
  assert.equal(f.db.prepare('SELECT state,dispatch_state FROM assistant_web_job WHERE id=?').get('f'.repeat(32)).state,'pending');
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,f.before.changes+1);f.preserved();
 }finally{f.db.close();}
});

test('anonymous, inactive, wrong-origin and OFF never disclose active-actor occupancy or refusal',async()=>{
 for(const fault of ['anonymous','inactive','origin','off']){
  const f=fixture();try{
   if(fault==='inactive')f.db.prepare("UPDATE staff_member SET status='deactivated'").run();
   if(fault==='off')f.env.ASSISTANT_WEB_JOBS_ENABLED='0';
   const response=await createWebJob(f.context({verified:fault!=='anonymous',origin:fault==='origin'?'https://wrong.example.invalid':ORIGIN}),NOW),body=await response.json();
   assert.equal(response.status>=400,true);assert.equal(Object.hasOwn(body,'diagnostic_stage'),false);assert.equal(Object.hasOwn(body,'refusal'),false);
   assert.equal(f.effects.sql.some(sql=>sql.startsWith('SELECT id FROM assistant_web_job WHERE actor')),false);
   assert.equal(f.effects.sends,0);f.preserved();
  }finally{f.db.close();}
 }
});
