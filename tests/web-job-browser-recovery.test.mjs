// [pc2-codex-42] NEW fake DOM/clock/storage + fictional SQLite recovery-wire tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {humanWebJob,authorizeLegacyWebJobBrowserRecovery} from '../functions/_lib/assistant-web-jobs.mjs';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
const ORIGIN='https://legacy-hub-d7-acceptance.pages.dev',ACTOR='fictional@example.invalid',JOB='a'.repeat(32),IDEM='b'.repeat(32),SESSION='c'.repeat(32),DISPOSITION='d'.repeat(32);
const RECORD='agent-web-job-record-v1',SESSION_KEY='agent-web-job-session-v1',GENERIC='agent-confirmation-hold',BUSINESS='agent-business-confirmation-hold-v1',PENDING='agent-business-confirmation-pending-v1';
const source=readFileSync(new URL('../staff.js',import.meta.url),'utf8'),full=source.slice(source.indexOf('function initStaffChatTargets()'),source.indexOf('let siteContentItems ='));
const record=(extra={})=>({v:1,kind:'web_job',actor:ACTOR,origin:ORIGIN,session_id:SESSION,job_id:JOB,idempotency_key:IDEM,phase:'waiting',...extra});
const stored=rec=>new Map([[SESSION_KEY,SESSION],...(rec?[[RECORD,JSON.stringify(rec)]]:[])]);
const proof=(extra={})=>({ok:true,kind:'web_job',state:'closed_unmaterialized',job_id:JOB,idempotency_key:IDEM,actor:ACTOR,origin:ORIGIN,session_id:SESSION,disposition_id:DISPOSITION,delivery:'unknown',legacy_authorized:false,...extra});
const response=(data,ok=true)=>({ok,redirected:false,json:async()=>data});
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function deferred(){let resolve;return {promise:new Promise(yes=>{resolve=yes;}),resolve:v=>resolve(v)};}
function harness({storage=stored(record()),fetchImpl,storageFault=null,actor=ACTOR}={}){
 let now=0,uuid=0,timerId=0;const timers=new Map(),listeners=new Map(),calls=[],messages=[],writes=[];
 const nodes={chatInput:{value:'New fictional intent'},chatBody:{appendChild(n){if(!messages.includes(n))messages.push(n);}},chatAreaSelect:{value:'content'},chatContentTarget:{value:'ps_home.hero'},agentLegacyJobId:{value:JOB}};
 const document={hidden:false,getElementById:id=>nodes[id]||null,querySelector:()=>null,createElement:()=>({dataset:{},innerHTML:'',textContent:''}),addEventListener:(n,f)=>{if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},removeEventListener:(n,f)=>listeners.get(n)?.delete(f)};
 const store={getItem:k=>{if(storageFault?.('get',k))throw Error('FICTIONAL_PRIVATE_STORAGE');return storage.get(k)??null;},setItem:(k,v)=>{if(storageFault?.('set',k))throw Error('FICTIONAL_PRIVATE_STORAGE');writes.push([k,v]);storage.set(k,v);}};
 const c=vm.createContext({document,AbortController,Date:{now:()=>now},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),window:{location:{origin:ORIGIN},sessionStorage:store},crypto:{randomUUID:()=>{uuid++;return '00000000-0000-4000-8000-'+String(uuid).padStart(12,'0');}},escapeHtml:v=>String(v).replaceAll('<','&lt;'),currentEventId:'ev_synthetic',currentCaregiverId:'cg_synthetic',currentGrantId:1,loadStaffConsole:async()=>{},viewCaregiver:async()=>{},fetch:async(path,options)=>{
  const body=options?.body?JSON.parse(options.body):null,call={path,body,options};calls.push(call);
  if(fetchImpl)return fetchImpl(call);
  return response(body?.action==='recover'?proof():body?{ok:true,job_id:'e'.repeat(32),state:'refused'}:{ok:true,enabled:true,actor,origin:ORIGIN});
 }});
 vm.runInContext('let siteContentItems=[{id:"ps_home.hero",type_id:"page_section",status:"published",data:"{}"}];\n'+full,c);
 vm.runInContext(`agentWebJobsEnabled=true;agentWebJobActor=${JSON.stringify(actor)};`,c);
 const state=()=>JSON.parse(vm.runInContext('JSON.stringify({hold:agentConfirmationHold,business:agentBusinessConfirmationHold,pending:agentWebJobPending,recovering:agentWebJobRecoveryPending,record:agentWebJobRecord})',c));
 return {c,storage,nodes,calls,messages,writes,state,send:()=>c.window.agentSend(),recover:id=>c.recoverAgentWebJobHold(id),async advance(ms){now+=ms;for(const [id,t]of[...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();},timers};
}

test('matching authenticated terminal proof clears only typed job hold; next human intent gets new identity and old idempotency is never posted',async()=>{
 const h=harness();assert.equal(h.state().hold,true);await h.send();assert.equal(h.calls.length,0);
 assert.equal(await h.recover(),true);assert.equal(h.state().hold,false);assert.equal(h.storage.get(RECORD),'');assert.equal(h.storage.has(GENERIC),false);
 assert.deepEqual(h.calls.map(x=>x.body.action),['recover']);assert.equal(h.calls[0].options.redirect,'error');
 await h.send();const created=h.calls.filter(x=>x.path.endsWith('/draft'));assert.equal(created.length,1);assert.notEqual(created[0].body.idempotency_key,IDEM);
 assert.equal(created[0].body.request,'New fictional intent');assert.equal(h.storage.get(RECORD),'');assert.equal(h.state().hold,false);
 assert.ok(h.storage.get('agent-web-job-recovery-receipt-v1').includes(DISPOSITION));
});

test('unknown create acknowledgement recovers by exact pre-send idempotency correlation without inventing a job ID',async()=>{
 const h=harness({storage:stored(record({job_id:null,phase:'create'}))});assert.equal(await h.recover(),true);
 assert.equal(h.calls[0].body.job_id,null);assert.equal(h.calls[0].body.idempotency_key,IDEM);assert.equal(h.state().hold,false);
});

test('wrong actor/origin/job/key/session/state/disposition/delivery/kind/redirect and lookup failures never clear typed hold',async()=>{
 const changes=[{actor:'other@example.invalid'},{origin:'https://other.invalid'},{job_id:'f'.repeat(32)},{idempotency_key:'f'.repeat(32)},{session_id:'f'.repeat(32)},{state:'hold'},{state:'materialized'},{disposition_id:'bad'},{delivery:'not_sent'},{kind:'legacy'},{legacy_authorized:true},{ok:false}];
 for(const change of [...changes,'http','redirect','throw','malformed']){
  const store=stored(record()),before=new Map(store),h=harness({storage:store,fetchImpl:()=>{
   if(change==='throw')throw Error('FICTIONAL_PRIVATE_LOOKUP');if(change==='malformed')return {ok:true,json:async()=>{throw Error('json');}};
   return change==='http'?response(proof(),false):change==='redirect'?{...response(proof()),redirected:true}:response(proof(change));
  }});
  assert.equal(await h.recover(),false);assert.equal(h.state().hold,true);assert.deepEqual(h.storage,before);assert.equal(h.calls.length,1);
 }
});

test('stored wrong actor/origin/session/malformed correlation, business HOLD and pending confirmation fail before recovery read',async()=>{
 for(const fault of ['actor','origin','session','malformed','business','pending','mixed-generic']){
  const r=record(fault==='actor'?{actor:'other@example.invalid'}:fault==='origin'?{origin:'https://other.invalid'}:fault==='session'?{session_id:'f'.repeat(32)}:{}),store=stored(r);
  if(fault==='malformed')store.set(RECORD,'{bad');if(fault==='business')store.set(BUSINESS,'1');if(fault==='pending')store.set(PENDING,'1');if(fault==='mixed-generic')store.set(GENERIC,'1');
  const before=new Map(store),h=harness({storage:store});assert.equal(await h.recover(),false);assert.equal(h.state().hold,true);assert.equal(h.calls.length,0);assert.deepEqual(h.storage,before);
 }
});

test('legacy boolean requires explicit exact-session operator proof; no blind clear or manufactured retained correlation',async()=>{
 const store=stored(null);store.set(GENERIC,'1');let approved=false;
 const h=harness({storage:store,fetchImpl:call=>response(approved?proof({kind:'legacy',legacy_authorized:true}):{ok:false,state:'hold',error:'web_job_hold'},approved)});
 assert.equal(await h.recover(),false);assert.equal(h.calls.length,0);
 assert.equal(await h.recover(JOB),false);assert.equal(store.get(GENERIC),'1');assert.equal(h.state().hold,true);
 approved=true;assert.equal(await h.recover(JOB),true);assert.equal(h.state().hold,false);assert.equal(store.get(GENERIC),'');assert.equal(store.get(RECORD),'');
 assert.equal(h.calls.at(-1).body.kind,'legacy');assert.equal(h.calls.at(-1).body.session_id,SESSION);assert.equal(h.calls.at(-1).body.idempotency_key,null);
 const mixed=stored(null);mixed.set(GENERIC,'1');mixed.set(BUSINESS,'1');const held=harness({storage:mixed});assert.equal(await held.recover(JOB),false);assert.equal(held.calls.length,0);assert.equal(mixed.get(GENERIC),'1');
});

test('in-flight recovery reserves against duplicate click/new input and loses to confirmation/storage/session changes',async()=>{
 for(const kind of ['business','pending','record','session','actor']){
  const wait=deferred(),h=harness({fetchImpl:()=>wait.promise});const recovering=h.recover();await flush();
  assert.equal(h.state().recovering,true);assert.equal(await h.recover(),false);await h.send();assert.equal(h.calls.length,1);assert.equal(h.nodes.chatInput.value,'New fictional intent');
  if(kind==='business')h.c.holdAgentConfirmation(null);
  if(kind==='pending')h.storage.set(PENDING,'1');
  if(kind==='record')h.storage.set(RECORD,JSON.stringify(record({job_id:'f'.repeat(32)})));
  if(kind==='session')h.storage.set(SESSION_KEY,'f'.repeat(32));
  if(kind==='actor')vm.runInContext('agentWebJobActor="other@example.invalid"',h.c);
  wait.resolve(response(proof()));assert.equal(await recovering,false);assert.equal(h.state().hold,true);assert.equal(h.state().recovering,false);
 }
});

test('lookup deadline/storage read/write failure or partial legacy commit never opens input after reload',async()=>{
 const wait=deferred(),h=harness({fetchImpl:()=>wait.promise});const recovering=h.recover();await h.advance(10000);assert.equal(await recovering,false);assert.equal(h.state().hold,true);wait.resolve(response(proof()));await flush();assert.equal(h.state().hold,true);
 for(const key of [RECORD,GENERIC,'agent-web-job-recovery-receipt-v1']){
  const store=stored(null);store.set(GENERIC,'1');const broken=harness({storage:store,storageFault:(op,k)=>op==='set'&&k===key,fetchImpl:()=>response(proof({kind:'legacy',legacy_authorized:true}))});
  assert.equal(await broken.recover(JOB),false);assert.equal(broken.state().hold,true);
  assert.equal(harness({storage:store}).state().hold,true);
 }
 const readFail=harness({storageFault:(op,k)=>op==='get'&&k===RECORD});assert.equal(await readFail.recover(),false);assert.equal(readFail.state().hold,true);assert.equal(readFail.calls.length,0);
 const partial=stored(null);partial.set(GENERIC,'1');let writes=0;
 const stopped=harness({storage:partial,storageFault:(op,key)=>op==='set'&&key===RECORD&&++writes===2,fetchImpl:()=>response(proof({kind:'legacy',legacy_authorized:true}))});
 assert.equal(await stopped.recover(JOB),false);assert.equal(partial.get(GENERIC),'');assert.ok(partial.get(RECORD));assert.equal(stopped.state().hold,true);assert.equal(harness({storage:partial}).state().hold,true);
});

test('pre-send correlation survives an interrupted create/reload; unknown materialization and business confirmation are independent',async()=>{
 const wait=deferred(),store=stored(null),h=harness({storage:store,fetchImpl:()=>wait.promise});
 const sending=h.send();await flush();const saved=JSON.parse(store.get(RECORD));assert.equal(saved.phase,'create');assert.equal(saved.job_id,null);assert.equal(saved.kind,'web_job');assert.equal(saved.actor,ACTOR);assert.equal(saved.origin,ORIGIN);
 const reloaded=harness({storage:store});await reloaded.send();assert.equal(reloaded.calls.length,0);assert.equal(reloaded.state().hold,true);
 await h.advance(60000);await sending;assert.equal(h.state().hold,true);assert.equal(store.has(BUSINESS),false);assert.equal(store.has(GENERIC),false);
 const confirmation=deferred(),fresh=harness({storage:stored(null),fetchImpl:()=>confirmation.promise});
 const button={getAttribute:k=>k==='data-draft-id'?'cid_fictional':k==='data-preview-version'?'e'.repeat(64):null,closest:()=>({})};
 const confirming=fresh.c.confirmAgentChange(button);await flush();assert.equal(fresh.storage.get(PENDING),'1');
 const afterReload=harness({storage:fresh.storage});assert.equal(afterReload.state().business,true);assert.equal(await afterReload.recover(JOB),false);assert.equal(afterReload.calls.length,0);
 confirmation.resolve(response({ok:false},false));await confirming;assert.equal(fresh.storage.get(BUSINESS),'1');assert.equal(fresh.storage.get(GENERIC),'1');
});

function serverFixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE staff_member(email TEXT PRIMARY KEY,status TEXT);CREATE TABLE content_item(id TEXT PRIMARY KEY,status TEXT,updated_by TEXT);CREATE TABLE agent_change(id TEXT PRIMARY KEY,status TEXT,requested_by TEXT)");
 db.prepare("INSERT INTO staff_member VALUES(?,'active')").run(ACTOR);
 db.exec(readFileSync(new URL('../schema/candidates/0016_assistant_web_job.sql',import.meta.url),'utf8'));
 db.prepare("INSERT INTO assistant_web_job(id,actor,idempotency_key,input_digest,pointer_nonce,app_origin,frozen_json,state,dispatch_state,pointer_expires_at,expires_at,created_at) VALUES(?,?,?,?,?,?,'{}','hold','reserved',60,240,0)").run(JOB,ACTOR,IDEM,'1'.repeat(64),'2'.repeat(32),ORIGIN);
 db.exec('BEGIN');db.exec(readFileSync(new URL('../schema/candidates/0017_assistant_web_job_close.sql',import.meta.url),'utf8'));db.exec('COMMIT');
 const before=JSON.stringify(db.prepare('SELECT * FROM assistant_web_job').get());
 db.prepare("INSERT INTO assistant_web_job_disposition VALUES(?,?,?,?,?,?,?,?,?,?,?,'closed_unmaterialized','unknown')").run(JOB,DISPOSITION,before,...Array(6).fill('3'.repeat(64)),'pc2-test-operator',1000);
 const adapter={prepare(sql){const bind=p=>({first:async()=>db.prepare(sql).get(...p)??null,run:async()=>db.prepare(sql).run(...p)});return {...bind([]),bind:(...p)=>bind(p)};}};
 const env={ENVIRONMENT:'preview',LEGACY_DB:adapter,ASSISTANT_WEB_JOBS_ENABLED:'1',ASSISTANT_APP_ORIGIN:ORIGIN,ASSISTANT_WORKSPACE:'TSYNTHETIC',ASSISTANT_CHANNEL:'CSYNTHETIC',ASSISTANT_WEB_JOB_APP_ID:'ASYNTHETIC',ASSISTANT_WEB_JOB_SEAT_ID:'pc2-test-seat',ASSISTANT_WEB_JOB_CLOSE_ENABLED:'1',ASSISTANT_DISPOSITION_DATABASE_ID:'e52bc5aa-aa36-482d-b32b-ff39fdeaa8f0'};
 const context=(body,{actor=ACTOR,origin=ORIGIN,method='POST'}={})=>{const data={};if(actor)setVerifiedAccessStaffActor(data,actor);return {env,data,request:new Request(ORIGIN+'/api/agent/web-jobs',{method,headers:{origin,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})})};};
 const request={action:'recover',kind:'web_job',job_id:JOB,idempotency_key:IDEM,session_id:SESSION};
 const permit={job_id:JOB,actor:ACTOR,session_id:SESSION,operator:'pc2-test-operator',evidence_digest:'4'.repeat(64),authority_digest:'5'.repeat(64)};
 return {db,env,context,request,permit};
}

test('server recovery authenticates own actor/origin/closed disposition/key and is read-only, including pre-receipt key lookup',async()=>{
 const f=serverFixture();try{
  const changes=f.db.prepare('SELECT total_changes() n').get().n;
  for(const job_id of [JOB,null]){
   const result=await humanWebJob(f.context({...f.request,job_id}),2000);assert.equal(result.status,200);assert.deepEqual(await result.json(),proof());
  }
  for(const options of [{actor:null},{actor:'other@example.invalid'},{origin:'https://other.invalid'}])assert.notEqual((await humanWebJob(f.context(f.request,options),2000)).status,200);
  for(const change of [{job_id:'e'.repeat(32)},{idempotency_key:'e'.repeat(32)},{session_id:'bad'},{action:'authorize_recovery'},{extra:'private'}])assert.notEqual((await humanWebJob(f.context({...f.request,...change}),2000)).status,200);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
  f.db.prepare("INSERT INTO content_item VALUES('cid_test','draft',?)").run('access_staff:'+ACTOR);
  assert.equal((await humanWebJob(f.context(f.request),2000)).status,409);
 }finally{f.db.close();}
});

test('another active request, workflow draft or non-closed attempt prevents recovery/grant and never changes business state',async()=>{
 for(const kind of ['active','draft','not-closed']){
  const f=serverFixture();try{
   if(kind==='active')f.db.prepare("INSERT INTO assistant_web_job SELECT 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',actor,'ffffffffffffffffffffffffffffffff',input_digest,pointer_nonce,app_origin,frozen_json,'pending','new',NULL,3000,3200,2940,NULL,NULL,NULL,NULL,NULL,NULL,NULL FROM assistant_web_job WHERE id=?").run(JOB);
   if(kind==='draft')f.db.prepare("INSERT INTO agent_change VALUES('ac_other','draft',?)").run('access_staff:'+ACTOR);
   if(kind==='not-closed'){
    f.db.prepare("INSERT INTO assistant_web_job SELECT 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',actor,'ffffffffffffffffffffffffffffffff',input_digest,pointer_nonce,app_origin,frozen_json,'hold','reserved',NULL,60,240,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL FROM assistant_web_job WHERE id=?").run(JOB);
    f.request.job_id='e'.repeat(32);f.request.idempotency_key='f'.repeat(32);f.permit.job_id='e'.repeat(32);
   }
   const n=f.db.prepare('SELECT total_changes() n').get().n;
   assert.equal((await humanWebJob(f.context(f.request),2000)).status,409);
   assert.deepEqual(await authorizeLegacyWebJobBrowserRecovery(f.env,f.permit,2000),{ok:false,error:'web_job_browser_reconciliation_hold'});
   assert.equal(f.db.prepare('SELECT total_changes() n').get().n,n);
  }finally{f.db.close();}
 }
});

test('legacy exact-session operator attestation is required, immutable, idempotent and has no HTTP grant endpoint',async()=>{
 const f=serverFixture();try{
  const legacy={...f.request,kind:'legacy',idempotency_key:null};assert.equal((await humanWebJob(f.context(legacy),2000)).status,409);
  assert.deepEqual(await authorizeLegacyWebJobBrowserRecovery(f.env,f.permit,2000),{ok:true});const n=f.db.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(await authorizeLegacyWebJobBrowserRecovery(f.env,f.permit,2001),{ok:true});assert.equal(f.db.prepare('SELECT total_changes() n').get().n,n);
  const result=await humanWebJob(f.context(legacy),2001);assert.deepEqual(await result.json(),proof({kind:'legacy',legacy_authorized:true}));
  for(const change of [{session_id:'e'.repeat(32)},{job_id:'e'.repeat(32)}])assert.equal((await humanWebJob(f.context({...legacy,...change}),2001)).status,409);
  assert.deepEqual(await authorizeLegacyWebJobBrowserRecovery(f.env,{...f.permit,evidence_digest:'e'.repeat(64)},2001),{ok:false,error:'web_job_browser_reconciliation_hold'});
  for(const sql of ['DELETE FROM assistant_web_job_browser_reconciliation',"UPDATE assistant_web_job_browser_reconciliation SET operator='other'",'INSERT OR REPLACE INTO assistant_web_job_browser_reconciliation SELECT * FROM assistant_web_job_browser_reconciliation'])assert.throws(()=>f.db.exec(sql),/web_job_browser_reconciliation/);
  assert.equal((await humanWebJob(f.context({action:'authorize_legacy_recovery',...f.permit}),2001)).status,403);
 }finally{f.db.close();}
});

test('feature bootstrap exposes only verified own identity; client does not trust actor from saved state',async()=>{
 const f=serverFixture();try{
  const result=await humanWebJob(f.context(null,{method:'GET'}),2000);assert.deepEqual(await result.json(),{ok:true,enabled:true,actor:ACTOR,origin:ORIGIN});
  assert.equal((await humanWebJob(f.context(null,{actor:null,method:'GET'}),2000)).status,403);
 }finally{f.db.close();}
 const h=harness({actor:null});assert.equal(await h.recover(),false);assert.equal(h.calls.length,0);await h.c.initWebJobFeature();assert.equal(await h.recover(),false);
});

test('missing, redirected or wrong-origin bootstrap identity blocks a new uncorrelated send without consuming its text',async()=>{
 for(const kind of ['missing','origin','redirect','throw']){
  const h=harness({storage:stored(null),fetchImpl:()=>{
   if(kind==='throw')throw Error('FICTIONAL bootstrap');
   return {...response({ok:true,enabled:true,...(kind==='missing'?{}:{actor:ACTOR,origin:kind==='origin'?'https://other.invalid':ORIGIN})}),redirected:kind==='redirect'};
  }});
  await h.c.initWebJobFeature();const n=h.calls.length;await h.send();assert.equal(h.calls.length,n);assert.equal(h.nodes.chatInput.value,'New fictional intent');assert.equal(h.storage.has(RECORD),false);
 }
});
