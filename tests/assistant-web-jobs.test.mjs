// [pc2-codex-42] Fictional SQLite + injected transport only; not real D1/Slack/Access/model proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWebJob,machineWebJob,humanWebJob,TARGETS,slackPointerTransport} from '../functions/_lib/assistant-web-jobs.mjs';
import {canonical,sha,rawKey,hmac,machineSigningInput,verifyPointer,random128} from '../functions/_lib/web-job-protocol.mjs';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
import {onRequestPost as agentPost} from '../functions/api/agent/[[path]].js';
const ORIGIN='https://legacy-hub-d7-acceptance.pages.dev',ACTOR='fictional@example.invalid',NOW=1900000000;
const KEY='000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'; // PUBLIC FAKE VECTOR ONLY.
function setup(){
  const db=new DatabaseSync(':memory:');
  for(const file of ['0001_init.sql','0003_grant_award.sql','0004_content_types.sql','0006_caregiver_contact_history_outcomes.sql','0007_grant_course_complete.sql','0008_agent_change.sql','0009_content_live.sql','0010_page_section_forms.sql','0011_staff_member.sql','candidates/0016_assistant_web_job.sql'])db.exec(readFileSync(new URL('../schema/'+file,import.meta.url),'utf8'));
  db.exec(`INSERT INTO staff_member(email,status) VALUES('${ACTOR}','active');
    INSERT INTO caregiver(id,first_name,email) VALUES('cg_d7_synthetic_13','FICTIONAL','test@example.invalid');
    INSERT INTO event(id,title,type,starts_at,publish_state) VALUES('ev_d7_synthetic_13','Before','other','2099-01-01','draft');
    INSERT INTO grant_application(id,caregiver_id,source) VALUES(1,'cg_d7_synthetic_13','synthetic');`);
  for(const [id,data] of [['ps_home.hero',{section_key:'home.hero',title:'Before'}],['ps_form.request_support',{section_key:'form.request_support',name_label:'Before'}]])db.prepare("INSERT INTO content_item(id,type_id,data,status,updated_by) VALUES(?,'page_section',?,'published','fixture')").run(id,JSON.stringify(data));
  const effects={sends:[],ai:0,unknownSend:false,failAfterInsert:false,failAfterCommit:false,beforeBatch:null,afterSend:null,sql:[]};
  const adapter={prepare(sql){
    effects.sql.push(sql);
    const bound=params=>({first:async()=>db.prepare(sql).get(...params)??null,run:async()=>{const r=db.prepare(sql).run(...params);if(effects.failAfterInsert&&sql.includes('INSERT INTO content_item')){effects.failAfterInsert=false;throw Error('FICTIONAL_ACK_LOST');}return r;},all:async()=>({results:db.prepare(sql).all(...params)})});
    return {...bound([]),bind:(...p)=>bound(p)};
  },async batch(statements){if(effects.beforeBatch)await effects.beforeBatch();db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}if(effects.failAfterCommit){effects.failAfterCommit=false;throw Error('FICTIONAL_COMMITTED_ACK_LOST');}return [];}};
  const env={ENVIRONMENT:'preview',LEGACY_DB:adapter,ASSISTANT_WEB_JOBS_ENABLED:'1',ASSISTANT_APP_ORIGIN:ORIGIN,ASSISTANT_WORKSPACE:'TSYNTHETIC',ASSISTANT_CHANNEL:'CSYNTHETIC',ASSISTANT_WEB_JOB_APP_ID:'ASYNTHETIC',ASSISTANT_WEB_JOB_SEAT_ID:'pc2-test-seat',ASSISTANT_WEB_JOB_KEY_HEX:KEY,
    ASSISTANT_WEB_JOB_TRANSPORT:async p=>{effects.sends.push(p);if(effects.afterSend)await effects.afterSend(p);if(effects.unknownSend)throw Error('PRIVATE_RAW_PROVIDER_MESSAGE');return {channel:p.channel,ts:'1900000000.001'};},AI:{run(){effects.ai++;throw Error('UNEXPECTED_AI');}}};
  const context=(path,body,{actor=ACTOR,origin=ORIGIN,extraData={},method='POST'}={})=>{const data={...extraData};if(actor)setVerifiedAccessStaffActor(data,actor);return {env,data,request:new Request(ORIGIN+path,{method,headers:{'content-type':'application/json',...(origin?{origin}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})})};};
  const createBody=(area='content',idem=random128())=>({...(['content','forms'].includes(area)?{type_id:'page_section'}:{area}),target_id:TARGETS[area],request:'FICTIONAL PRIVATE REQUEST',idempotency_key:idem});
  const create=async(area='content',options={})=>{const b=options.body||createBody(area);const c=context(['content','forms'].includes(area)?'/api/agent/draft':'/api/agent/change/draft',b,options);const r=await createWebJob(c,options.now??NOW);return {status:r.status,body:await r.json(),input:b};};
  const staff=async(body,options={})=>{const r=await humanWebJob(context('/api/agent/web-jobs',body,options),options.now??NOW+2);return {status:r.status,body:await r.json()};};
  async function machine(action,body,{now=NOW+1,nonce=random128(),stamp=String(now),key=KEY,signature,origin=null,rawOverride}={}){
    const path='/api/assistant-web-jobs/'+action,raw=JSON.stringify(body);
    const sig=signature??await hmac(rawKey(key),await machineSigningInput('POST',path,stamp,nonce,raw));
    const request=new Request(ORIGIN+path,{method:'POST',headers:{'content-type':'application/json','x-legacy-web-job-timestamp':stamp,'x-legacy-web-job-nonce':nonce,'x-legacy-web-job-signature':sig,...(origin?{origin}:{})},body:rawOverride??raw});
    const r=await machineWebJob({env,request},now);return {status:r.status,body:await r.json()};
  }
  const claimBody=j=>{const row=db.prepare('SELECT * FROM assistant_web_job WHERE id=?').get(j);return {job_id:j,input_digest:row.input_digest,pointer_nonce:row.pointer_nonce,invocation_id:'invoke-1',attempt_id:'attempt-1',source_id:'source-1',config_id:'config-1',generation_id:'generation-1',slack_event_id:'Ev-1',slack_ts:'1900000000.001'};};
  async function resultBody(claim,lease,area='content',extra={}){
    const payload=area==='content'?{title:'After'}:area==='forms'?{name_label:'After'}:area==='caregiver'?{segment_tags:['synthetic']} :area==='event'?{title:'After'}:{review_notes:'Synthetic review'};
    const body={job_id:claim.job_id,input_digest:claim.input_digest,lease_token:lease,...Object.fromEntries(['invocation_id','attempt_id','source_id','config_id','generation_id'].map(k=>[k,claim[k]])),status:'proposal',proposal:{operation:area==='grant'?'review':'update',payload},...extra};
    return {...body,result_digest:await sha(canonical(body))};
  }
  const snapshots=()=>Object.fromEntries(['content_item','caregiver','event','grant_application','agent_change','audit_log'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
  return {db,env,effects,context,createBody,create,staff,machine,claimBody,resultBody,snapshots};
}
for(const area of Object.keys(TARGETS))test(`${area}: private job -> ONE machine claim/result -> ONE owned original-validator draft; explicit confirm audit only`,async()=>{
  const f=setup();try{
    const before=f.snapshots(),created=await f.create(area);assert.equal(created.status,202,JSON.stringify(created.body));
    assert.equal(f.effects.sends.length,1);assert.deepEqual(f.snapshots(),before);
    const wire=f.effects.sends[0].text;assert.ok(!wire.includes(ACTOR)&&!wire.includes('PRIVATE REQUEST'));
    const pointer=JSON.parse(wire.slice('LEGACY_WEB_JOB_V1 '.length));assert.equal(Object.hasOwn(pointer,'target_id'),false);assert.equal(Object.hasOwn(pointer,'request'),false);
    const verified=await verifyPointer(wire,rawKey(KEY),{origin:ORIGIN,workspace_id:'TSYNTHETIC',channel_id:'CSYNTHETIC',app_id:'ASYNTHETIC',seat_id:'pc2-test-seat'},NOW);
    assert.equal(verified.metadata.job_id,created.body.job_id);
    const claim=f.claimBody(created.body.job_id),claimed=await f.machine('claim',claim);assert.equal(claimed.status,200,JSON.stringify(claimed.body));
    assert.equal(claimed.body.frozen.actor,ACTOR);assert.equal(claimed.body.frozen.target_id,TARGETS[area]);assert.equal(claimed.body.lease_expires_at,NOW+181);
    const proposed=await f.resultBody(claim,claimed.body.lease_token,area);
    assert.equal((await f.machine('result',proposed)).status,200);assert.deepEqual(f.snapshots(),before);
    assert.equal((await f.machine('result',proposed)).status,200); // fresh request nonce, same result.
    const drafted=await f.staff({action:'materialize',job_id:claim.job_id});assert.equal(drafted.status,200,JSON.stringify(drafted.body));
    const again=await f.staff({action:'materialize',job_id:claim.job_id});assert.deepEqual(again.body,drafted.body);
    assert.equal(f.effects.ai,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit_log').get().n,0);
    const isContent=['content','forms'].includes(area),draftId=isContent?drafted.body.draft_id:drafted.body.change_id;
    const path=isContent?'/api/agent/confirm':'/api/agent/change/confirm';
    const confirmation=f.context(path,{[isContent?'draft_id':'change_id']:draftId,preview_version:drafted.body.preview_version});
    const result=await agentPost(confirmation);assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
    assert.ok(f.db.prepare('SELECT count(*) AS n FROM audit_log WHERE actor=?').get(ACTOR).n>=1);
    assert.equal(f.effects.sends.length,1);
  }finally{f.db.close();}
});
test('OFF preserves legacy mapper and requires no job DDL/key/transport',async()=>{
  const f=setup();try{f.env.ASSISTANT_WEB_JOBS_ENABLED='0';delete f.env.ASSISTANT_WEB_JOB_KEY_HEX;delete f.env.ASSISTANT_WEB_JOB_TRANSPORT;f.db.exec('DROP TABLE assistant_web_job;DROP TABLE assistant_web_job_nonce');
    f.env.AGENT_MAPPER_BACKEND=async()=>({ok:true,change:{section_key:'home.hero',title:'Legacy'}});
    const r=await agentPost(f.context('/api/agent/draft',{type_id:'page_section',target_id:TARGETS.content,request:'legacy'}));assert.equal(r.status,200);assert.ok((await r.json()).draft_id);assert.equal(f.effects.sends.length,0);
  }finally{f.db.close();}
});
test('private Symbol + active staff + same origin + exact targets; body/service/dev/cross-owner do not authorize',async()=>{
  const f=setup();try{
    for(const options of [{actor:null,extraData:{actor:ACTOR,email:ACTOR}},{actor:'service:fictional@example.invalid'},{origin:'https://attacker.invalid'},{origin:null},{body:{...f.createBody(),actor:ACTOR}},{body:{...f.createBody(),target_id:'customer-target'}}])assert.notEqual((await f.create('content',options)).status,202);
    assert.equal(f.effects.sends.length,0);
    const created=await f.create();f.db.prepare("INSERT INTO staff_member(email,status) VALUES('other@example.invalid','active')").run();
    assert.equal((await f.staff({action:'status',job_id:created.body.job_id},{actor:'other@example.invalid'})).status,404);
    f.db.prepare("UPDATE staff_member SET status='deactivated' WHERE email=?").run(ACTOR);
    assert.equal((await f.staff({action:'status',job_id:created.body.job_id})).status,403);
  }finally{f.db.close();}
});
test('durable reservation precedes injected send; same create retry never re-posts, uncertainty HOLD',async()=>{
  const f=setup();try{
    f.effects.afterSend=async()=>assert.equal(f.db.prepare('SELECT dispatch_state FROM assistant_web_job').get().dispatch_state,'reserved');
    f.effects.unknownSend=true;const b=f.createBody();const created=await f.create('content',{body:b});assert.equal(created.body.state,'hold');
    assert.equal((await f.create('content',{body:b})).body.state,'hold');assert.equal(f.effects.sends.length,1);
    assert.notEqual((await f.create('content')).status,202);assert.equal(f.effects.sends.length,1);
  }finally{f.db.close();}
});
test('event-before-post-response claim preserved; atomic duplicate claims give ONE lease',async()=>{
  const f=setup();try{let first;
    f.effects.afterSend=async()=>{const j=f.db.prepare('SELECT id FROM assistant_web_job').get().id;const claim=f.claimBody(j);const both=await Promise.all([f.machine('claim',claim),f.machine('claim',claim)]);assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);first=both.find(r=>r.status===200);};
    const created=await f.create();assert.equal(created.body.state,'claimed');assert.ok(first.body.lease_token);assert.equal(f.db.prepare('SELECT dispatch_state FROM assistant_web_job').get().dispatch_state,'sent');
  }finally{f.db.close();}
});
test('machine auth binds domain/raw body/path/time/nonce; forged and replayed messages create no job effect',async()=>{
  const f=setup();try{
    const c=await f.create(),b=f.claimBody(c.body.job_id);
    for(const opts of [{signature:'0'.repeat(64)},{origin:ORIGIN},{now:NOW+62,stamp:String(NOW)},{rawOverride:JSON.stringify({...b,job_id:'0'.repeat(32)})}])assert.notEqual((await f.machine('claim',b,opts)).status,200);
    const nonce=random128();assert.equal((await f.machine('claim',b,{nonce})).status,200);assert.notEqual((await f.machine('claim',b,{nonce})).status,200);
    assert.equal(f.db.prepare('SELECT state FROM assistant_web_job').get().state,'claimed');
  }finally{f.db.close();}
});
test('stale target and unknown materialization ACK hold rather than create another draft',async()=>{
  for(const kind of ['stale','unknown']){const f=setup();try{
    const c=await f.create(),b=f.claimBody(c.body.job_id),claim=await f.machine('claim',b);
    await f.machine('result',await f.resultBody(b,claim.body.lease_token));
    if(kind==='stale')f.db.prepare("UPDATE content_item SET updated_by='external' WHERE id=?").run(TARGETS.content);else f.effects.failAfterCommit=true;
    assert.equal((await f.staff({action:'materialize',job_id:b.job_id})).body.state,'hold');
    const count=f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n;
    assert.equal(count,kind==='stale'?0:1);
    assert.equal((await f.staff({action:'materialize',job_id:b.job_id})).body.state,'hold');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n,count);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit_log').get().n,0);
  }finally{f.db.close();}}
});
test('expired lease, conflicting results, wrong lease and forbidden proposal never materialize',async()=>{
  for(const kind of ['expired','conflict','lease','fields']){const f=setup();try{
    const c=await f.create(),b=f.claimBody(c.body.job_id),claim=await f.machine('claim',b);let result=await f.resultBody(b,claim.body.lease_token);
    if(kind==='conflict'){assert.equal((await f.machine('result',result)).status,200);result=await f.resultBody(b,claim.body.lease_token,'content',{proposal:{operation:'update',payload:{title:'Different'}}});}
    if(kind==='lease')result=await f.resultBody(b,'0'.repeat(32));
    if(kind==='fields')result=await f.resultBody(b,claim.body.lease_token,'content',{proposal:{operation:'confirm',payload:{title:'Injected'}}});
    assert.notEqual((await f.machine('result',result,{now:kind==='expired'?NOW+182:NOW+2})).status,200);
    assert.notEqual((await f.staff({action:'materialize',job_id:b.job_id})).status,200);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n,0);
  }finally{f.db.close();}}
});
test('Slack adapter posts pointer only to fixed method with bounded response and no alternate endpoint',async()=>{
  const seen=[];const send=slackPointerTransport({token:'xoxb-PUBLIC_SYNTHETIC_NOT_A_CREDENTIAL',fetchImpl:async(url,options)=>{seen.push({url,options});return Response.json({ok:true,channel:'CSYNTHETIC',ts:'1.2'});}});
  assert.deepEqual(await send({channel:'CSYNTHETIC',text:'OPAQUE_TEST_POINTER'}),{channel:'CSYNTHETIC',ts:'1.2'});
  assert.equal(seen[0].url,'https://slack.com/api/chat.postMessage');assert.equal(seen[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(seen[0].options.body),{channel:'CSYNTHETIC',text:'OPAQUE_TEST_POINTER',unfurl_links:false,unfurl_media:false});
});
test('claim/send receipt ordering mismatch always HOLD, before or after claim',async()=>{
  for(const early of [true,false]){const f=setup();try{
    let j;
    if(early)f.effects.afterSend=async()=>{j=f.db.prepare('SELECT id FROM assistant_web_job').get().id;const b=f.claimBody(j);b.slack_ts='1900000000.999';assert.equal((await f.machine('claim',b)).status,200);};
    const created=await f.create();
    if(early){assert.equal(created.body.state,'hold');assert.equal(f.db.prepare('SELECT state FROM assistant_web_job').get().state,'hold');}
    else{j=created.body.job_id;const b=f.claimBody(j);b.slack_ts='1900000000.999';assert.equal((await f.machine('claim',b)).status,409);}
    assert.equal(f.effects.sends.length,1);
  }finally{f.db.close();}}
});
test('concurrent same results idempotent, concurrent materialization creates ONE draft',async()=>{
  const f=setup();try{
    const c=await f.create(),b=f.claimBody(c.body.job_id),claim=await f.machine('claim',b),result=await f.resultBody(b,claim.body.lease_token);
    const results=await Promise.all([f.machine('result',result),f.machine('result',result)]);assert.deepEqual(results.map(r=>r.status),[200,200]);
    const drafts=await Promise.all([f.staff({action:'materialize',job_id:b.job_id}),f.staff({action:'materialize',job_id:b.job_id})]);assert.deepEqual(drafts.map(r=>r.status).sort(),[200,409]);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit_log').get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM assistant_web_job_nonce WHERE nonce LIKE 'materialize:%'").get().n,1);
  }finally{f.db.close();}
});
test('atomic draft guard refuses target/schema/job-state race after fresh read, rolls back whole draft transaction',async()=>{
  for(const fault of ['target','schema','job']){const f=setup();try{
    const c=await f.create(),b=f.claimBody(c.body.job_id),claim=await f.machine('claim',b);await f.machine('result',await f.resultBody(b,claim.body.lease_token));
    f.effects.beforeBatch=async()=>{
      if(fault==='target')f.db.prepare("UPDATE content_item SET updated_by='racing-writer' WHERE id=?").run(TARGETS.content);
      else if(fault==='schema')f.db.prepare("UPDATE content_type SET json_schema='{}' WHERE id='page_section'").run();
      else f.db.prepare("UPDATE assistant_web_job SET state='hold' WHERE id=?").run(b.job_id);
    };
    assert.equal((await f.staff({action:'materialize',job_id:b.job_id})).body.state,'hold');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM assistant_web_job_nonce WHERE nonce LIKE 'materialize:%'").get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit_log').get().n,0);
  }finally{f.db.close();}}
});
test('refusal, malformed/oversized request and incomplete custody/transport stay effect-free',async()=>{
  for(const kind of ['size','no-transport','no-key','refused']){const f=setup();try{
    if(kind==='size')assert.notEqual((await f.create('content',{body:{...f.createBody(),request:'x'.repeat(17000)}})).status,202);
    if(kind==='no-transport'){delete f.env.ASSISTANT_WEB_JOB_TRANSPORT;assert.equal((await f.create()).status,503);}
    if(kind==='no-key'){delete f.env.ASSISTANT_WEB_JOB_KEY_HEX;assert.notEqual((await f.create()).status,202);}
    if(kind==='refused'){
      const c=await f.create(),b=f.claimBody(c.body.job_id),claim=await f.machine('claim',b);
      assert.equal((await f.machine('result',await f.resultBody(b,claim.body.lease_token,'content',{status:'refused',proposal:null}))).body.state,'refused');
      assert.notEqual((await f.staff({action:'materialize',job_id:b.job_id})).status,200);
    }else assert.equal(f.effects.sends.length,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n,0);assert.equal(f.effects.ai,0);
  }finally{f.db.close();}}
});
test('unpaired surrogate requests/results and corrupted frozen records never reach model or draft',async()=>{
  for(const fault of ['request','result','frozen']){const f=setup();try{
    if(fault==='request'){assert.notEqual((await f.create('content',{body:{...f.createBody(),request:'bad\ud800'}})).status,202);assert.equal(f.effects.sends.length,0);continue;}
    const c=await f.create(),b=f.claimBody(c.body.job_id);
    if(fault==='frozen'){f.db.prepare("UPDATE assistant_web_job SET frozen_json='{}' WHERE id=?").run(b.job_id);assert.notEqual((await f.machine('claim',b)).status,200);}
    else{
      const claimed=await f.machine('claim',b);
      const good=await f.resultBody(b,claimed.body.lease_token),invalid={...good,proposal:{operation:'update',payload:{title:'bad\ud800'}}};
      // Sender claiming a digest cannot make malformed Unicode a canonical scalar.
      assert.notEqual((await f.machine('result',invalid)).status,200);
    }
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_item WHERE status='draft'").get().n,0);assert.equal(f.effects.ai,0);
  }finally{f.db.close();}}
});
