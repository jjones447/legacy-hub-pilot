// [pc2-codex-42] NEW fictional create-boundary diagnostics only; no real Slack/D1/Access/model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWebJob,machineWebJob,slackPointerTransport} from '../functions/_lib/assistant-web-jobs.mjs';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
const ORIGIN='https://legacy-hub-d7-acceptance.pages.dev',ACTOR='fictional@example.invalid',NOW=1900000000;
const SENTINEL='FICTIONAL_PRIVATE_ACTOR_PROMPT_TOKEN_NONCE_PROVIDER_SENTINEL';
const KEY='000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'; // PUBLIC FAKE ONLY.
function fixture(fetchImpl){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE staff_member(email TEXT PRIMARY KEY,status TEXT);CREATE TABLE content_item(id TEXT PRIMARY KEY,type_id TEXT,data TEXT,status TEXT,updated_by TEXT);CREATE TABLE content_type(id TEXT PRIMARY KEY,json_schema TEXT);CREATE TABLE audit_log(id INTEGER PRIMARY KEY);");
 db.exec(readFileSync(new URL('../schema/candidates/0016_assistant_web_job.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO staff_member VALUES(?,?)').run(ACTOR,'active');
 db.prepare('INSERT INTO content_item VALUES(?,?,?,?,?)').run('ps_home.hero','page_section',JSON.stringify({section_key:'home.hero',title:'Fictional current title'}),'published','fixture');
 db.prepare('INSERT INTO content_type VALUES(?,?)').run('page_section',JSON.stringify({oneOf:[{type:'object',properties:{section_key:{const:'home.hero'},title:{type:'string'}},required:['section_key'],additionalProperties:false}]}));
 const effects={fetches:0,reservation:false,ack:null,fault:null};
 const dbPort={prepare(sql){
  const bind=params=>({run:async()=>{if(effects.fault==='persist'&&sql.startsWith('INSERT INTO assistant_web_job('))throw Error(SENTINEL);return db.prepare(sql).run(...params);},first:async()=>{
   if(effects.fault==='reserve'&&sql.includes("dispatch_state='reserved'"))throw Error(SENTINEL);
   if(sql.includes("dispatch_state='sent'")){
    if(effects.ack==='before')throw Error(SENTINEL);
    const row=db.prepare(sql).get(...params)??null;if(effects.ack==='after')throw Error(SENTINEL);return row;
   }
   return db.prepare(sql).get(...params)??null;
  }});return {...bind([]),bind:(...params)=>bind(params)};
 }};
 const transport=slackPointerTransport({token:'xoxb-FICTIONAL_NOT_A_CREDENTIAL',fetchImpl:async(url,options)=>{
  effects.fetches++;
  assert.equal(url,'https://slack.com/api/chat.postMessage');assert.equal(options.redirect,'error');
  const row=db.prepare('SELECT state,dispatch_state FROM assistant_web_job').get();
  effects.reservation=row?.state==='pending'&&row?.dispatch_state==='reserved';
  assert.equal(effects.reservation,true,'Pending and reserved must precede fake post');
  return fetchImpl(url,options);
 }});
 const env={ENVIRONMENT:'preview',LEGACY_DB:dbPort,ASSISTANT_WEB_JOBS_ENABLED:'1',ASSISTANT_APP_ORIGIN:ORIGIN,ASSISTANT_WORKSPACE:'TSYNTHETIC',ASSISTANT_CHANNEL:'CSYNTHETIC',ASSISTANT_WEB_JOB_APP_ID:'ASYNTHETIC',ASSISTANT_WEB_JOB_SEAT_ID:'pc2-test-seat',ASSISTANT_WEB_JOB_KEY_HEX:KEY,ASSISTANT_WEB_JOB_TRANSPORT:transport};
 const input={type_id:'page_section',target_id:'ps_home.hero',request:SENTINEL,idempotency_key:'1'.repeat(32)};
 const context=({actor=true,origin=ORIGIN,body=input}={})=>{
  const data={};if(actor)setVerifiedAccessStaffActor(data,ACTOR);
  return {env,data,request:new Request(ORIGIN+'/api/agent/draft',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)})};
 };
 const before=db.prepare('SELECT * FROM content_item').all();
 const unchanged=()=>{assert.deepEqual(db.prepare('SELECT * FROM content_item').all(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n,0);};
 return {db,env,effects,input,context,unchanged};
}
async function responseBody(response){
 assert.equal(response.status,409);assert.equal(response.headers.get('cache-control'),'no-store');
 const raw=await response.text();assert.equal(raw.includes(SENTINEL),false);assert.equal(raw.includes(ACTOR),false);
 const body=JSON.parse(raw);assert.equal(body.error,'web_job_hold');assert.equal(body.state,'hold');
 assert.ok(Object.keys(body).every(k=>['ok','state','error','diagnostic_stage','diagnostic_http_status','diagnostic_slack_error'].includes(k)));
 return body;
}
test('known bounded Slack refusal exposes only closed stage/status/error, persists HOLD and never reposts',async()=>{
 const f=fixture(async()=>Response.json({ok:false,error:'not_in_channel',response_metadata:{messages:[SENTINEL]},text:SENTINEL}));
 try{
  const body=await responseBody(await createWebJob(f.context(),NOW));
  assert.deepEqual(body,{ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:'response_rejected',diagnostic_http_status:200,diagnostic_slack_error:'not_in_channel'});
  assert.deepEqual({...f.db.prepare('SELECT state,dispatch_state,dispatch_ts FROM assistant_web_job').get()},{state:'hold',dispatch_state:'reserved',dispatch_ts:null});
  await createWebJob(f.context(),NOW+1); // Fictional duplicate proves no additional transport effect.
  assert.equal(f.effects.fetches,1);f.unchanged();
 }finally{f.db.close();}
});
test('unknown Slack error and malformed/oversized bounded responses never echo body fields or add retries',async()=>{
 for(const kind of ['unknown','malformed','oversized','wrong-receipt']){
  const f=fixture(async()=>kind==='unknown'?Response.json({ok:false,error:SENTINEL,diagnostic_stage:SENTINEL},{status:503}):kind==='malformed'?new Response(SENTINEL):kind==='oversized'?new Response(SENTINEL.repeat(200)):Response.json({ok:true,channel:'WRONG_CHANNEL',ts:'1.2',text:SENTINEL}));
  try{
   const body=await responseBody(await createWebJob(f.context(),NOW));
   assert.equal(body.diagnostic_stage,kind==='unknown'?'response_rejected':kind==='wrong-receipt'?'response_receipt':'response_body');
   assert.equal(body.diagnostic_http_status,kind==='unknown'?503:200);assert.equal(Object.hasOwn(body,'diagnostic_slack_error'),false);
   assert.equal(f.effects.fetches,1);assert.equal(f.db.prepare('SELECT state FROM assistant_web_job').get().state,'hold');f.unchanged();
  }finally{f.db.close();}
 }
});
test('injected timeout and forged error-shaped exception are unknown send HOLD without reflected fields',async()=>{
 for(const kind of ['timeout','forged']){
  const f=fixture(async()=>{throw kind==='timeout'?new DOMException(SENTINEL,'TimeoutError'):Object.assign(new Error(SENTINEL),{stage:'response_rejected',status:200,code:'invalid_auth',diagnostic_stage:SENTINEL});});
  try{
   const body=await responseBody(await createWebJob(f.context(),NOW));
   assert.deepEqual(body,{ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:'send'});
   assert.equal(f.effects.fetches,1);assert.equal(f.db.prepare('SELECT dispatch_state FROM assistant_web_job').get().dispatch_state,'reserved');f.unchanged();
  }finally{f.db.close();}
 }
});
test('acknowledgement uncertainty before or after commit remains one post and HOLD, no target/audit effects',async()=>{
 for(const when of ['before','after']){
  const f=fixture(async()=>Response.json({ok:true,channel:'CSYNTHETIC',ts:'1900000000.001'}));f.effects.ack=when;
  try{
   const body=await responseBody(await createWebJob(f.context(),NOW));assert.equal(body.diagnostic_stage,'ack');
   assert.equal(Object.hasOwn(body,'diagnostic_http_status'),false);assert.equal(f.effects.fetches,1);
   assert.equal(f.db.prepare('SELECT state FROM assistant_web_job').get().state,'hold');
   assert.equal(f.db.prepare('SELECT dispatch_state FROM assistant_web_job').get().dispatch_state,when==='before'?'reserved':'sent');
   await createWebJob(f.context(),NOW+1);assert.equal(f.effects.fetches,1);f.unchanged();
  }finally{f.db.close();}
 }
});
test('server transport seam cannot forge diagnostic fields and nonnumeric response statuses are omitted',async()=>{
 for(const kind of ['injected','status']){
  const f=fixture(async()=>({ok:false,status:SENTINEL,body:Response.json({ok:false,error:SENTINEL}).body}));let injected=0;
  if(kind==='injected')f.env.ASSISTANT_WEB_JOB_TRANSPORT=async()=>{injected++;assert.equal(f.db.prepare('SELECT dispatch_state FROM assistant_web_job').get().dispatch_state,'reserved');throw Object.assign(new Error(SENTINEL),{name:'PointerFailure',stage:'response_rejected',status:200,code:'invalid_auth'});};
  try{
   const body=await responseBody(await createWebJob(f.context(),NOW));
   assert.deepEqual(body,{ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:kind==='injected'?'send':'response_rejected'});
   assert.equal(kind==='injected'?injected:f.effects.fetches,1);f.unchanged();
  }finally{f.db.close();}
 }
});
test('persist and reserve failures are closed stages before any fake post',async()=>{
 for(const fault of ['persist','reserve']){
  const f=fixture(async()=>{throw Error('Must not post');});f.effects.fault=fault;
  try{const body=await responseBody(await createWebJob(f.context(),NOW));assert.equal(body.diagnostic_stage,fault);assert.equal(f.effects.fetches,0);f.unchanged();}
  finally{f.db.close();}
 }
});
test('anonymous, inactive, wrong-origin, OFF and machine perimeters never receive create diagnostic metadata',async()=>{
 for(const fault of ['anonymous','inactive','origin','off']){
  const f=fixture(async()=>{throw Error(SENTINEL);});
  try{
   if(fault==='inactive')f.db.prepare("UPDATE staff_member SET status='deactivated'").run();
   if(fault==='off')f.env.ASSISTANT_WEB_JOBS_ENABLED='0';
   const response=await createWebJob(f.context({actor:fault!=='anonymous',origin:fault==='origin'?'https://wrong.example.invalid':ORIGIN}),NOW);
   const body=await response.json();assert.equal(Object.keys(body).some(k=>k.startsWith('diagnostic_')),false);assert.equal(f.effects.fetches,0);
   const machine=await machineWebJob({env:f.env,request:new Request(ORIGIN+'/api/assistant-web-jobs/claim',{method:'POST',headers:{'content-type':'application/json'},body:SENTINEL})},NOW);
   const machineBody=await machine.json();assert.equal(Object.keys(machineBody).some(k=>k.startsWith('diagnostic_')),false);
   f.unchanged();
  }finally{f.db.close();}
 }
});
