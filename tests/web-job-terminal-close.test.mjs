// [pc2-codex-42] Fictional SQLite + injected transport. NO real D1/provider/browser/compiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {closeExpiredUnclaimedSyntheticJob,createWebJob,humanWebJob,machineWebJob} from '../functions/_lib/assistant-web-jobs.mjs';
import {canonical,sha,hmac,rawKey,machineSigningInput} from '../functions/_lib/web-job-protocol.mjs';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
const ORIGIN='https://legacy-hub-d7-acceptance.pages.dev',ACTOR='fictional@example.invalid',JOB='a'.repeat(32),IDEM='b'.repeat(32),OP='c'.repeat(32),OLD=1900000000,NOW=OLD+7200;
const KEY='000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'; // PUBLIC FAKE VECTOR.
const sqlFile=name=>readFileSync(new URL('../schema/'+name,import.meta.url),'utf8');
async function fixture({migrate=true}={}){
 const db=new DatabaseSync(':memory:');
 for(const file of ['0001_init.sql','0003_grant_award.sql','0004_content_types.sql','0006_caregiver_contact_history_outcomes.sql','0007_grant_course_complete.sql','0008_agent_change.sql','0009_content_live.sql','0010_page_section_forms.sql','0011_staff_member.sql','candidates/0016_assistant_web_job.sql'])db.exec(sqlFile(file));
 db.prepare('INSERT INTO staff_member(email,status) VALUES(?,?)').run(ACTOR,'active');
 db.prepare("INSERT INTO content_item(id,type_id,data,status,updated_by) VALUES(?,'page_section',?,'published','fixture')").run('ps_home.hero',JSON.stringify({section_key:'home.hero',title:'Fictional before'}));
 db.prepare("INSERT INTO audit_log(actor,action,entity,entity_id) VALUES(?,'content_item.publish','content_item',?)").run(ACTOR,'fixture-original');
 const row={...db.prepare('SELECT * FROM content_item WHERE id=?').get('ps_home.hero')},schema={...db.prepare('SELECT id,json_schema FROM content_type WHERE id=?').get('page_section')};
 const revision=await sha(canonical({row,schema,linked:null}));
 const perimeter={origin:ORIGIN,workspace_id:'TSYNTHETIC',channel_id:'CSYNTHETIC',app_id:'ASYNTHETIC',seat_id:'pc2-test-seat'};
 const frozen={v:1,job_id:JOB,nonce:'d'.repeat(32),actor:ACTOR,origin:ORIGIN,perimeter,area:'content',target_id:'ps_home.hero',request:'FICTIONAL_PRIVATE_REQUEST',current:{section_key:'home.hero',title:'Fictional before'},schema:{},revision,allowed_fields:['title'],created_at:OLD};
 const raw=canonical(frozen),input=await sha(raw);
 db.prepare("INSERT INTO assistant_web_job(id,actor,idempotency_key,input_digest,pointer_nonce,app_origin,frozen_json,state,dispatch_state,pointer_expires_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,'hold','reserved',?,?,?)").run(JOB,ACTOR,IDEM,input,frozen.nonce,ORIGIN,raw,OLD+60,OLD+240,OLD);
 const old={...db.prepare('SELECT * FROM assistant_web_job').get()},audits=db.prepare('SELECT * FROM audit_log ORDER BY id').all();
 if(migrate){db.exec('BEGIN');try{db.exec(sqlFile('candidates/0017_assistant_web_job_close.sql'));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 const effects={sends:0,race:null,loseAck:false,sql:[],bindCounts:[]};
 const adapter={prepare(sql){effects.sql.push(sql);const bound=p=>({first:async()=>{
   if(sql.startsWith('INSERT INTO assistant_web_job_disposition')&&effects.race){const race=effects.race;effects.race=null;race();}
   const r=db.prepare(sql).get(...p)??null;
   if(sql.startsWith('INSERT INTO assistant_web_job_disposition')&&effects.loseAck)throw Error('FICTIONAL_PRIVATE_ACK');
   return r;
  },all:async()=>({results:db.prepare(sql).all(...p)}),run:async()=>db.prepare(sql).run(...p)});return {...bound([]),bind:(...p)=>{effects.bindCounts.push(p.length);assert.ok(p.length<=100,'Actual D1 bound-parameter limit');return bound(p);}};}};
 const env={ENVIRONMENT:'preview',LEGACY_DB:adapter,ASSISTANT_WEB_JOBS_ENABLED:'1',ASSISTANT_APP_ORIGIN:ORIGIN,ASSISTANT_WORKSPACE:perimeter.workspace_id,ASSISTANT_CHANNEL:perimeter.channel_id,ASSISTANT_WEB_JOB_APP_ID:perimeter.app_id,ASSISTANT_WEB_JOB_SEAT_ID:perimeter.seat_id,ASSISTANT_WEB_JOB_KEY_HEX:KEY,ASSISTANT_WEB_JOB_CLOSE_ENABLED:'1',ASSISTANT_DISPOSITION_DATABASE_ID:'e52bc5aa-aa36-482d-b32b-ff39fdeaa8f0',ASSISTANT_WEB_JOB_TRANSPORT:async p=>{effects.sends++;return {channel:p.channel,ts:'1900007200.001'};}};
 const permit={job_id:JOB,actor:ACTOR,operation_id:OP,operator:'pc2-codex-13',before_digest:await sha(canonical(old)),target_revision:revision,audit_digest:await sha(canonical(audits)),evidence_digest:'1'.repeat(64),authority_digest:'2'.repeat(64),quiescence_digest:'3'.repeat(64)};
 const context=(path,body,{verified=true,origin=ORIGIN}={})=>{const data={};if(verified)setVerifiedAccessStaffActor(data,ACTOR);return {env,data,request:new Request(ORIGIN+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})};};
 const noEffects=()=>{assert.deepEqual({...db.prepare('SELECT * FROM assistant_web_job WHERE id=?').get(JOB)},old);assert.equal(db.prepare('SELECT COUNT(*) n FROM assistant_web_job_disposition').get().n,0);assert.equal(effects.sends,0);};
 const originals=()=>{assert.deepEqual({...db.prepare('SELECT * FROM content_item WHERE id=?').get(row.id)},row);assert.deepEqual(db.prepare('SELECT * FROM audit_log ORDER BY id').all(),audits);};
 return {db,env,permit,effects,old,row,audits,input,frozen,context,noEffects,originals};
}
const closed={ok:true,state:'closed_unmaterialized',delivery:'unknown'};
const held={ok:false,error:'web_job_close_hold'};

test('candidate migration preserves every original job field, nonce, original targets/audits and exact active-index predicate',async()=>{
 const f=await fixture({migrate:false});try{
  f.db.prepare('INSERT INTO assistant_web_job_nonce VALUES(?,?)').run('e'.repeat(32),OLD);
  const before=f.db.prepare('SELECT * FROM assistant_web_job_nonce').all();
  const index=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='assistant_web_job_one_active'").get().sql;
  f.db.exec('BEGIN');f.db.exec(sqlFile('candidates/0017_assistant_web_job_close.sql'));f.db.exec('COMMIT');
  f.noEffects();f.originals();assert.deepEqual(f.db.prepare('SELECT * FROM assistant_web_job_nonce').all(),before);
  assert.equal(f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='assistant_web_job_one_active'").get().sql,index);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.db.close();}
});

test('exact expired HOLD/reserved closes atomically, preserves full private history and UNKNOWN delivery, permits new same-actor work once',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),closed);
  const after={...f.db.prepare('SELECT * FROM assistant_web_job WHERE id=?').get(JOB)};
  assert.deepEqual(after,{...f.old,state:'closed_unmaterialized'});
  const disposition=f.db.prepare('SELECT * FROM assistant_web_job_disposition').get();
  assert.deepEqual(JSON.parse(disposition.before_json),f.old);assert.equal(disposition.delivery,'unknown');assert.equal(disposition.outcome,'closed_unmaterialized');
  f.originals();assert.equal(f.effects.sends,0);
  const request={type_id:'page_section',target_id:'ps_home.hero',request:'New FICTIONAL intent',idempotency_key:'f'.repeat(32)};
  const response=await createWebJob(f.context('/api/agent/draft',request),NOW+1);
  assert.equal(response.status,202);assert.equal((await response.json()).state,'pending');assert.equal(f.effects.sends,1);f.originals();
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job').get().n,2);
 }finally{f.db.close();}
});

test('same permit is idempotent; changed operation or evidence never changes closed row/disposition',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),closed);
  const changes=f.db.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW+1),closed);
  for(const change of [{operation_id:'9'.repeat(32)},{evidence_digest:'9'.repeat(64)},{operator:'other-operator'}])assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,{...f.permit,...change},NOW+1),held);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);f.originals();
 }finally{f.db.close();}
});

test('missing opt-in, wrong binding/perimeter, malformed/extra authority fields and mismatched snapshot fail closed without private output',async()=>{
 for(const fault of ['off','database','origin','production','extra','digest','actor','operation','evidence','quiescence','time']){
  const f=await fixture();try{
   const p={...f.permit};let now=NOW;
   if(fault==='off')delete f.env.ASSISTANT_WEB_JOB_CLOSE_ENABLED;
   if(fault==='database')f.env.ASSISTANT_DISPOSITION_DATABASE_ID='customer-db';
   if(fault==='origin')f.env.ASSISTANT_APP_ORIGIN='https://other.invalid';
   if(fault==='production')f.env.ENVIRONMENT='production';
   if(fault==='extra')p.request='FICTIONAL_PRIVATE_REQUEST';
   if(fault==='digest')p.before_digest='9'.repeat(64);
   if(fault==='actor')p.actor='other@example.invalid';
   if(fault==='operation')p.operation_id='bad';
   if(fault==='evidence')p.evidence_digest='raw-private-evidence';
   if(fault==='quiescence')delete p.quiescence_digest;
   if(fault==='time')now=NaN;
   const result=await closeExpiredUnclaimedSyntheticJob(f.env,p,now);assert.deepEqual(result,held);assert.equal(JSON.stringify(result).includes(ACTOR),false);f.noEffects();f.originals();
  }finally{f.db.close();}
 }
});

test('unexpired, wrong lifecycle or any receipt/claim/lease/result/materialization evidence is never eligible',async()=>{
 const changes=[['expires_at',NOW+1],['pointer_expires_at',NOW+1],['state','pending'],['state','claimed'],['state','result'],['state','materializing'],['state','refused'],['state','materialized'],['dispatch_state','new'],['dispatch_state','sent'],['dispatch_ts','1900000000.001'],['claim_json','{}'],['claim_slack_ts','1.2'],['lease_token','e'.repeat(32)],['lease_expires_at',OLD+100],['result_digest','e'.repeat(64)],['result_json','{}'],['materialized_json','{}']];
 for(const [column,value] of changes){
  const f=await fixture();try{
   f.db.prepare(`UPDATE assistant_web_job SET ${column}=? WHERE id=?`).run(value,JOB);
   const before=f.db.prepare('SELECT * FROM assistant_web_job').get();f.permit.before_digest=await sha(canonical(before));
   assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),held);
   assert.deepEqual(f.db.prepare('SELECT * FROM assistant_web_job').get(),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job_disposition').get().n,0);f.originals();
  }finally{f.db.close();}
 }
});

test('existing materialization nonce, content draft or workflow draft fences close even without result metadata',async()=>{
 for(const kind of ['nonce','content','workflow']){
  const f=await fixture();try{
   if(kind==='nonce')f.db.prepare('INSERT INTO assistant_web_job_nonce VALUES(?,?)').run('materialize:'+JOB,OLD+1);
   if(kind==='content')f.db.prepare("INSERT INTO content_item(id,type_id,data,status,draft_of,updated_by) VALUES('cid_test','page_section','{}','draft','ps_home.hero',?)").run('access_staff:'+ACTOR);
   if(kind==='workflow')f.db.prepare("INSERT INTO agent_change(id,area,operation,target_id,payload_json,status,requested_by) VALUES('ac_test','event','update','ev_d7_synthetic_13','{}','draft',?)").run('access_staff:'+ACTOR);
   assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),held);f.noEffects();f.originals();
  }finally{f.db.close();}
 }
});

test('CAS loses to exact-row/claim, target, schema, audit append, materialization marker or draft race with no disposition',async()=>{
 for(const kind of ['row','claim','target','schema','audit','nonce','content','workflow']){
  const f=await fixture();try{
   f.effects.race=()=>{
    if(kind==='row')f.db.prepare('UPDATE assistant_web_job SET expires_at=expires_at+1 WHERE id=?').run(JOB);
    if(kind==='claim')f.db.prepare("UPDATE assistant_web_job SET state='claimed',claim_json='{}' WHERE id=?").run(JOB);
    if(kind==='target')f.db.prepare("UPDATE content_item SET data='{}' WHERE id='ps_home.hero'").run();
    if(kind==='schema')f.db.prepare("UPDATE content_type SET json_schema='{}' WHERE id='page_section'").run();
    if(kind==='audit')f.db.prepare("INSERT INTO audit_log(actor,action,entity) VALUES('fixture','race','fixture')").run();
    if(kind==='nonce')f.db.prepare('INSERT INTO assistant_web_job_nonce VALUES(?,?)').run('materialize:'+JOB,NOW);
    if(kind==='content')f.db.prepare("INSERT INTO content_item(id,type_id,data,status,updated_by) VALUES('cid_race','page_section','{}','draft',?)").run('access_staff:'+ACTOR);
    if(kind==='workflow')f.db.prepare("INSERT INTO agent_change(id,area,operation,target_id,payload_json,status,requested_by) VALUES('ac_race','event','update','fixture','{}','draft',?)").run('access_staff:'+ACTOR);
   };
   assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),held);
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job_disposition').get().n,0);
   assert.notEqual(f.db.prepare('SELECT state FROM assistant_web_job').get().state,'closed_unmaterialized');assert.equal(f.effects.sends,0);
  }finally{f.db.close();}
 }
});

test('trigger failure rolls disposition and state back; acknowledgement loss is UNKNOWN until exact idempotent read',async()=>{
 for(const kind of ['abort','ack']){
  const f=await fixture();try{
   if(kind==='abort')f.db.exec("CREATE TRIGGER fictional_abort BEFORE UPDATE ON assistant_web_job WHEN NEW.state='closed_unmaterialized' BEGIN SELECT RAISE(ABORT,'FICTIONAL_PRIVATE_ERROR'); END");
   else f.effects.loseAck=true;
   assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),held);
   if(kind==='abort')f.noEffects();
   else{f.effects.loseAck=false;assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_web_job_disposition').get().n,1);const n=f.db.prepare('SELECT total_changes() n').get().n;assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW+1),closed);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,n);}
   f.originals();
  }finally{f.db.close();}
 }
});

test('closed history cannot reopen, late-ack, delete, REPLACE or alter its append-only disposition',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),closed);
  for(const sql of ["UPDATE assistant_web_job SET state='pending'","UPDATE assistant_web_job SET dispatch_ts='1.2'","DELETE FROM assistant_web_job","UPDATE assistant_web_job_disposition SET delivery='unknown'","DELETE FROM assistant_web_job_disposition","INSERT OR REPLACE INTO assistant_web_job SELECT * FROM assistant_web_job","INSERT OR REPLACE INTO assistant_web_job_disposition SELECT * FROM assistant_web_job_disposition"])
   assert.throws(()=>f.db.exec(sql),/web_job_(closed|disposition|close)/);
  f.originals();assert.equal(f.db.prepare('SELECT state FROM assistant_web_job').get().state,'closed_unmaterialized');
 }finally{f.db.close();}
});

test('late signed claim/result and human materialization are fenced; same old idempotency never resends',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),closed);
  const before=f.db.prepare('SELECT * FROM assistant_web_job').get();
  for(const action of ['claim','result']){
   const binding={invocation_id:'invoke',attempt_id:'attempt',source_id:'source',config_id:'config',generation_id:'generation'};
   let body=action==='claim'?{job_id:JOB,input_digest:f.input,pointer_nonce:f.frozen.nonce,...binding,slack_event_id:'EvTest',slack_ts:'1.2'}:{job_id:JOB,input_digest:f.input,lease_token:'e'.repeat(32),...binding,status:'refused',proposal:null};
   if(action==='result')body={...body,result_digest:await sha(canonical(body))};
   const path='/api/assistant-web-jobs/'+action,raw=JSON.stringify(body),nonce=(action==='claim'?'6':'7').repeat(32),stamp=String(NOW);
   const signature=await hmac(rawKey(KEY),await machineSigningInput('POST',path,stamp,nonce,raw));
   const response=await machineWebJob({env:f.env,request:new Request(ORIGIN+path,{method:'POST',headers:{'content-type':'application/json','x-legacy-web-job-timestamp':stamp,'x-legacy-web-job-nonce':nonce,'x-legacy-web-job-signature':signature},body:raw})},NOW);
   assert.equal(response.status,409);
  }
  const status=await humanWebJob(f.context('/api/agent/web-jobs',{action:'status',job_id:JOB}),NOW);
  assert.deepEqual(await status.json(),{ok:true,job_id:JOB,state:'closed_unmaterialized'});
  assert.equal((await humanWebJob(f.context('/api/agent/web-jobs',{action:'materialize',job_id:JOB}),NOW)).status,409);
  const again=await createWebJob(f.context('/api/agent/draft',{type_id:'page_section',target_id:'ps_home.hero',request:f.frozen.request,idempotency_key:IDEM}),NOW);
  assert.equal((await again.json()).state,'closed_unmaterialized');assert.equal(f.effects.sends,0);
  assert.deepEqual(f.db.prepare('SELECT * FROM assistant_web_job').get(),before);f.originals();
 }finally{f.db.close();}
});

test('HTTP action cannot acquire operator close authority; anonymous/cross-origin cannot inspect closed status',async()=>{
 const f=await fixture();try{
  for(const body of [{action:'close',job_id:JOB},{action:'close_unmaterialized',job_id:JOB,...f.permit}])assert.equal((await humanWebJob(f.context('/api/agent/web-jobs',body),NOW)).status,403);
  f.noEffects();
  assert.deepEqual(await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW),closed);
  for(const options of [{verified:false},{origin:'https://wrong.invalid'}]){
   const response=await humanWebJob(f.context('/api/agent/web-jobs',{action:'status',job_id:JOB},options),NOW);assert.equal(response.status,403);assert.equal(JSON.stringify(await response.json()).includes('closed_unmaterialized'),false);
  }
 }finally{f.db.close();}
});

test('bounded private audit snapshots refuse overflow before fetching audit content; 11 original rows fit D1 bind limit',async()=>{
 for(const kind of ['count','bytes','eleven']){
  const f=await fixture();try{
   const n=kind==='count'?201:kind==='eleven'?11:1;
   for(let i=1;i<n;i++)f.db.prepare("INSERT INTO audit_log(actor,action,entity,before_json) VALUES('fixture','seed','fixture',?)").run(i===1?'Fictional Unicode \u2028/é 😀 \\ " \n':null);
   if(kind==='bytes')f.db.prepare("INSERT INTO audit_log(actor,action,entity,before_json) VALUES('fixture','seed','fixture',?)").run('x'.repeat(8193));
   f.permit.audit_digest=await sha(canonical(f.db.prepare('SELECT * FROM audit_log ORDER BY id').all()));
   const result=await closeExpiredUnclaimedSyntheticJob(f.env,f.permit,NOW);
   if(kind==='eleven'){assert.deepEqual(result,closed);assert.ok(Math.max(...f.effects.bindCounts)<=100);}
   else{assert.deepEqual(result,held);assert.equal(f.effects.sql.includes('SELECT * FROM audit_log ORDER BY id LIMIT 201'),false);f.noEffects();}
   assert.equal(f.effects.sends,0);
  }finally{f.db.close();}
 }
});

test('candidate transaction failure restores original schema/index/full row, and direct terminal-state fabrication is refused',async()=>{
 const f=await fixture({migrate:false});try{
  const catalog=f.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  f.db.exec('BEGIN');
  assert.throws(()=>f.db.exec(sqlFile('candidates/0017_assistant_web_job_close.sql')+'\nSELECT * FROM fictional_missing_table;'),/fictional_missing_table/);
  f.db.exec('ROLLBACK');
  assert.deepEqual(f.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),catalog);
  assert.deepEqual({...f.db.prepare('SELECT * FROM assistant_web_job').get()},f.old);f.originals();
  f.db.exec('BEGIN');f.db.exec(sqlFile('candidates/0017_assistant_web_job_close.sql'));f.db.exec('COMMIT');
  assert.throws(()=>f.db.exec("UPDATE assistant_web_job SET state='closed_unmaterialized'"),/web_job_closed_immutable/);
  assert.throws(()=>f.db.exec("INSERT INTO assistant_web_job SELECT 'ffffffffffffffffffffffffffffffff',actor,'99999999999999999999999999999999',input_digest,pointer_nonce,app_origin,frozen_json,'closed_unmaterialized',dispatch_state,dispatch_ts,pointer_expires_at,expires_at,created_at,claim_json,claim_slack_ts,lease_token,lease_expires_at,result_digest,result_json,materialized_json FROM assistant_web_job"),/web_job_closed_immutable/);
  f.noEffects();
 }finally{f.db.close();}
});
