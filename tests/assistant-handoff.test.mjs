// Source-only fictional context/SQLite. No real Access/Slack/human/provider/runtime proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { intake, human, sha256 } from '../functions/_lib/assistant-handoff.mjs';
import { setVerifiedAccessStaffActor } from '../functions/_lib/agent-confirmation.mjs';

const origin = 'https://synthetic.invalid', actor = 'staff@example.invalid', now = 1900000000000;
const secret = 'FICTIONAL_TEST_KEY_NOT_A_DEPLOYED_SECRET_42';
const targets = [
  {area:'content',target_id:'ps_home.hero',type_id:'page_section'},
  {area:'forms',target_id:'ps_form.request_support',type_id:'page_section'},
  {area:'caregiver',target_id:'cg_synthetic'}, {area:'event',target_id:'ev_synthetic'}, {area:'grant',target_id:'2'}
];
function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql','0003_grant_award.sql','0004_content_types.sql','0006_caregiver_contact_history_outcomes.sql','0007_grant_course_complete.sql','0008_agent_change.sql','0009_content_live.sql','0010_page_section_forms.sql','0011_staff_member.sql','0012_wellness_checkin.sql','candidates/0015_assistant_handoff.sql']) {
    db.exec(readFileSync(new URL('../schema/'+file,import.meta.url),'utf8'));
  }
  db.exec(`INSERT INTO caregiver(id,first_name,email) VALUES('cg_synthetic','Synthetic','synthetic@example.invalid');
    INSERT INTO event(id,title,type,starts_at,publish_state) VALUES('ev_synthetic','Before','other','2099-01-01','draft');
    INSERT INTO grant_application(id,caregiver_id,source) VALUES(2,'cg_synthetic','synthetic_acceptance');`);
  for (const [id,data] of [['ps_home.hero',{section_key:'home.hero',title:'Before'}],['ps_form.request_support',{section_key:'form.request_support',name_label:'Before'}]]) {
    db.prepare("INSERT INTO content_item(id,type_id,data,status,updated_by) VALUES(?,'page_section',?,'published','fixture')").run(id,JSON.stringify(data));
  }
  let mapperCalls = 0, failAfterCommit = false, hideAudits = false;
  const adapter = { prepare(sql) {
    const bound = params => ({
      first: async () => db.prepare(sql).get(...params) ?? null,
      run: async () => db.prepare(sql).run(...params),
      all: async () => ({results:hideAudits && sql.includes('FROM audit_log') ? [] : db.prepare(sql).all(...params)})
    });
    return {...bound([]),bind:(...params)=>bound(params)};
  }, async batch(statements) {
    db.exec('BEGIN');
    try {
      for (const statement of statements) await statement.run();
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    if (failAfterCommit) { failAfterCommit = false; throw new Error('FICTIONAL_COMMITTED_ACK_LOST'); }
    return [];
  }};
  const env = {LEGACY_DB:adapter,ASSISTANT_HANDOFF_ENABLED:'1',ASSISTANT_APP_ORIGIN:origin,
    ASSISTANT_WORKSPACE:'TSYNTHETIC',ASSISTANT_CHANNEL:'CSYNTHETIC',ASSISTANT_TARGETS_JSON:JSON.stringify(targets),ASSISTANT_INTAKE_SECRET:secret,
    AGENT_MAPPER_BACKEND: input => {
      mapperCalls++;
      return input.contentType ? {ok:true,change:input.current.section_key === 'home.hero' ? {section_key:'home.hero',title:'After'} : {section_key:'form.request_support',name_label:'After'}}
        : {ok:true,operation:input.area === 'grant'?'review':'update',payload: input.area==='grant'?{review_notes:'Synthetic review'}:input.area==='caregiver'?{segment_tags:['verified']}:{title:'After'}};
    }};
  const intent = (area='content',delivery='delivery-'+area) => ({action:'intent',delivery_id:delivery,workspace:'TSYNTHETIC',channel:'CSYNTHETIC',thread:'1900000000.001',user:'USYNTHETIC',area,target_id:targets.find(t=>t.area===area).target_id,request:'Synthetic request only'});
  async function machine(body,{time=now,stamp=time,signingSecret=secret,headers={},rawOverride}={}) {
    const raw = JSON.stringify(body), key = await crypto.subtle.importKey('raw',new TextEncoder().encode(signingSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${stamp}\n${origin}\nPOST\n/api/assistant-intake\n${await sha256(raw)}`))).toString('hex');
    const res = await intake({request:new Request(origin+'/api/assistant-intake',{method:'POST',headers:{'x-legacy-timestamp':String(stamp),'x-legacy-signature':signature,...headers},body:rawOverride ?? raw}),env},time);
    return {status:res.status,body:await res.json()};
  }
  async function staff(body,{identity=actor,time=now,requestOrigin=origin,urlOrigin=origin}={}) {
    const data = {}; if (identity) setVerifiedAccessStaffActor(data,identity);
    const headers = {'content-type':'application/json'}; if(requestOrigin) headers.origin=requestOrigin;
    const res = await human({request:new Request(urlOrigin+'/api/agent/handoff',{method:'POST',headers,body:JSON.stringify(body)}),env,data},time);
    return {status:res.status,body:await res.json()};
  }
  async function paired(area='content') {
    const created = await machine(intent(area)); assert.equal(created.status,200);
    const id = created.body.handoff_id;
    const begun = await staff({action:'begin',handoff_id:id}); assert.equal(begun.status,200);
    const verify = {action:'verify',handoff_id:id,event_id:'verify-'+area,workspace:'TSYNTHETIC',channel:'CSYNTHETIC',thread:'1900000000.001',user:'USYNTHETIC',challenge:begun.body.challenge};
    const verified = await machine(verify); assert.equal(verified.status,200);
    return {id,verify,challenge:begun.body.challenge};
  }
  const snapshot = () => Object.fromEntries(['content_item','caregiver','event','grant_application','agent_change','audit_log'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  return {db,env,machine,staff,intent,paired,snapshot,mapperCalls:()=>mapperCalls,loseAck(){failAfterCommit=true;},hideAudits(){hideAudits=true;}};
}

for (const area of targets.map(t=>t.area)) for(const action of ['confirm','discard']) {
  test(`${area}: actual handlers complete paired human ${action} and independently verified original audit receipt`,async()=>{
    const f=setup();try {
      const {id}=await f.paired(area);
      const before=f.snapshot();
      const drafted=await f.staff({action:'draft',handoff_id:id});
      assert.equal(drafted.status,200,JSON.stringify(drafted.body));
      assert.equal(drafted.body.state,'drafted');
      assert.match(drafted.body.preview_version,/^[a-f0-9]{64}$/);
      assert.equal(f.mapperCalls(),1);
      const afterDraft=f.snapshot();
      for(const table of ['caregiver','event','grant_application','audit_log']) assert.deepEqual(afterDraft[table],before[table]);
      assert.deepEqual(afterDraft.content_item.filter(r=>r.status==='published'),before.content_item.filter(r=>r.status==='published'));
      const result=await f.staff({action,handoff_id:id,preview_version:drafted.body.preview_version});
      assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal(result.body.state,action==='confirm'?'published':'discarded');
      const outcome=await f.machine({action:'outcome',handoff_id:id});
      assert.equal(outcome.body.audit_ids.length,action==='confirm'&&!['content','forms'].includes(area)?2:1);
      assert.equal(outcome.body.thread,'1900000000.001');
      assert.doesNotMatch(JSON.stringify(outcome.body),/staff@|Synthetic request|Before|After|preview|challenge|slack_user/);
      const after=f.snapshot();
      assert.equal((await f.staff({action,handoff_id:id,preview_version:drafted.body.preview_version})).status,409);
      assert.deepEqual(f.snapshot(),after);
      if(action==='discard') for(const table of ['caregiver','event','grant_application']) assert.deepEqual(after[table],before[table]);
    }finally{f.db.close();}
  });
}
for(const bad of ['signature','stale','body','origin','disabled','target','workspace','extra']) {
  test(`machine ${bad} refuses without domain or pending mutation`,async()=>{
    const f=setup();try {
      const body=f.intent(),options={};
      if(bad==='signature')options.signingSecret='WRONG_FICTIONAL_SECRET_NOT_DEPLOYED';
      if(bad==='stale')options.stamp=now-60001;
      if(bad==='body')options.rawOverride=JSON.stringify({...body,request:'Tampered'});
      if(bad==='origin')options.headers={origin};
      if(bad==='disabled')f.env.ASSISTANT_HANDOFF_ENABLED='0';
      if(bad==='target')body.target_id='customer_unknown';
      if(bad==='workspace')body.workspace='TOTHER';
      if(bad==='extra')body.confirm=true;
      assert.ok((await f.machine(body,options)).status>=400);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_handoff').get().n,0);
      assert.equal(f.mapperCalls(),0);
    }finally{f.db.close();}
  });
}
test('same delivery deduplicates; changed intent conflicts; opaque ID has no human authority',async()=>{
  const f=setup();try {
    const body=f.intent(),a=await f.machine(body),b=await f.machine(body);
    assert.equal(a.body.handoff_id,b.body.handoff_id);
    assert.equal((await f.machine({...body,request:'Changed'})).status,409);
    assert.equal((await f.staff({action:'draft',handoff_id:a.body.handoff_id})).status,403);
    assert.equal(f.mapperCalls(),0);
  }finally{f.db.close();}
});
for(const bad of ['user','thread','workspace','channel','challenge','expired','reused']) {
  test(`pairing ${bad} cannot bind a false original requester`,async()=>{
    const f=setup();try {
      const created=await f.machine(f.intent()),id=created.body.handoff_id;
      const begun=await f.staff({action:'begin',handoff_id:id});
      const body={action:'verify',handoff_id:id,event_id:'verification',workspace:'TSYNTHETIC',channel:'CSYNTHETIC',thread:'1900000000.001',user:'USYNTHETIC',challenge:begun.body.challenge};
      if(['user','thread','workspace','channel','challenge'].includes(bad))body[bad]='wrong';
      if(bad==='reused')assert.equal((await f.machine(body)).status,200);
      assert.ok((await f.machine(body,bad==='expired'?{time:now+180001}:{})).status>=400);
      assert.equal(f.mapperCalls(),0);
    }finally{f.db.close();}
  });
}
for(const bad of ['unverified','service','actor','origin','host','expired','target-config']) {
  test(`human ${bad} cannot draft through the pending handoff`,async()=>{
    const f=setup();try{
      const {id}=await f.paired();
      const options={};
      if(bad==='unverified')options.identity=null;
      if(bad==='service')options.identity='service:staff@example.invalid';
      if(bad==='actor')options.identity='other@example.invalid';
      if(bad==='origin')options.requestOrigin='https://other.invalid';
      if(bad==='host')options.urlOrigin='https://other.invalid';
      if(bad==='expired')options.time=now+900001;
      if(bad==='target-config')f.env.ASSISTANT_TARGETS_JSON=JSON.stringify(targets.map(t=>t.area==='content'?{...t,target_id:'ps_changed'}:t));
      assert.ok((await f.staff({action:'draft',handoff_id:id},options)).status>=400);
      assert.equal(f.mapperCalls(),0);
    }finally{f.db.close();}
  });
}
test('machine outcome never returns challenge; second staff cannot view/claim another pending pairing',async()=>{
  const f=setup();try{
    const created=await f.machine(f.intent()),id=created.body.handoff_id;
    const begun=await f.staff({action:'begin',handoff_id:id});
    assert.match(begun.body.challenge,/^[a-f0-9]{32}$/);
    assert.ok(!(await f.machine({action:'outcome',handoff_id:id})).body.challenge);
    assert.equal((await f.staff({action:'view',handoff_id:id},{identity:'other@example.invalid'})).status,403);
    assert.equal((await f.staff({action:'begin',handoff_id:id},{identity:'other@example.invalid'})).status,409);
    assert.equal((await f.staff({action:'begin',handoff_id:id})).status,409);
  }finally{f.db.close();}
});
test('preview drift cannot confirm; actual app refusal persists HOLD across restart without retries',async()=>{
  const f=setup();try{
    const {id}=await f.paired(),draft=await f.staff({action:'draft',handoff_id:id});
    const before=f.snapshot();
    assert.equal((await f.staff({action:'confirm',handoff_id:id,preview_version:'0'.repeat(64)})).status,409);
    assert.deepEqual(f.snapshot(),before);
    f.db.exec("UPDATE content_item SET updated_by='concurrent' WHERE id='ps_home.hero'");
    const result=await f.staff({action:'confirm',handoff_id:id,preview_version:draft.body.preview_version});
    assert.equal(result.body.state,'hold');
    const after=f.snapshot();
    for(const action of ['draft','confirm','discard']) assert.ok((await f.staff({action,handoff_id:id,...(action==='draft'?{}:{preview_version:draft.body.preview_version})})).status>=400);
    assert.deepEqual(f.snapshot(),after);
    assert.equal((await f.machine({action:'outcome',handoff_id:id})).body.state,'hold');
  }finally{f.db.close();}
});
test('unknown acknowledgement after actual commit retains original audit and HOLD, never retries',async()=>{
  const f=setup();try{
    const {id}=await f.paired('event'),draft=await f.staff({action:'draft',handoff_id:id});
    f.loseAck();
    assert.equal((await f.staff({action:'confirm',handoff_id:id,preview_version:draft.body.preview_version})).body.state,'hold');
    assert.equal(f.db.prepare("SELECT title FROM event WHERE id='ev_synthetic'").get().title,'After');
    const after=f.snapshot();
    assert.equal(after.audit_log.length,2);
    assert.equal((await f.staff({action:'confirm',handoff_id:id,preview_version:draft.body.preview_version})).status,409);
    assert.deepEqual(f.snapshot(),after);
    assert.deepEqual((await f.machine({action:'outcome',handoff_id:id})).body.audit_ids,[]);
  }finally{f.db.close();}
});

test('missing independently read original audit cannot become a published machine receipt',async()=>{
  const f=setup();try{
    const {id}=await f.paired(),draft=await f.staff({action:'draft',handoff_id:id});
    f.hideAudits();
    assert.equal((await f.staff({action:'confirm',handoff_id:id,preview_version:draft.body.preview_version})).body.state,'hold');
    assert.equal(f.snapshot().audit_log.length,1,'original audit exists but readback was not established');
    const receipt=await f.machine({action:'outcome',handoff_id:id});
    assert.equal(receipt.body.state,'hold');assert.deepEqual(receipt.body.audit_ids,[]);
  }finally{f.db.close();}
});
test('concurrent human draft clicks reserve durable state before inference and cannot create two drafts',async()=>{
  const f=setup();try{
    const {id}=await f.paired();
    let release,entered;
    const entry=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
    const mapper=f.env.AGENT_MAPPER_BACKEND;
    f.env.AGENT_MAPPER_BACKEND=async input=>{entered();await wait;return mapper(input);};
    const first=f.staff({action:'draft',handoff_id:id});await entry;
    assert.equal((await f.staff({action:'draft',handoff_id:id})).status,409);
    release();assert.equal((await first).status,200);
    assert.equal(f.mapperCalls(),1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM content_item WHERE status='draft'").get().n,1);
  }finally{f.db.close();}
});
for(const state of ['drafting','confirming','discarding','hold']) {
  test(`${state} survives a restarted request and cannot retry/replace/discard`,async()=>{
    const f=setup();try{
      const {id}=await f.paired();
      f.db.prepare('UPDATE assistant_handoff SET state=? WHERE id=?').run(state,id);
      const before=f.snapshot();
      for(const action of ['draft','confirm','discard']) assert.ok((await f.staff({action,handoff_id:id,...(action==='draft'?{}:{preview_version:'a'.repeat(64)})})).status>=400);
      assert.deepEqual(f.snapshot(),before);assert.equal(f.mapperCalls(),0);
    }finally{f.db.close();}
  });
}
test('request text is data, never a URL/model authority; host cannot call human draft or confirm',async()=>{
  const f=setup();try{
    const body=f.intent();body.request='<script>untrusted fictional request</script>';
    const created=await f.machine(body);
    assert.doesNotMatch(JSON.stringify(created.body),/script|request_text|staff|preview/);
    assert.equal((await f.machine({action:'confirm',handoff_id:created.body.handoff_id})).status,403);
    assert.equal((await f.machine({action:'draft',handoff_id:created.body.handoff_id})).status,403);
    assert.equal(f.mapperCalls(),0);
  }finally{f.db.close();}
});
test('explicit candidate schema is excluded from active latest-migration selection',async()=>{
  const {resolveLatestMigration}=await import('../scripts/export-all.mjs');
  assert.equal(resolveLatestMigration(),'0017_event_details.sql');
  assert.ok(readFileSync(new URL('../schema/candidates/0015_assistant_handoff.sql',import.meta.url),'utf8').includes('CREATE TABLE'));
});

test('bounded body refusal never persists an oversized pending instruction',async()=>{
  const f=setup();try{
    const body=f.intent();body.request='x'.repeat(17000);
    assert.equal((await f.machine(body)).status,400);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_handoff').get().n,0);
  }finally{f.db.close();}
});
test('challenge storage is a hash only and verification clears it without exposing it to machine receipt',async()=>{
  const f=setup();try{
    const {id,challenge}=await f.paired();
    const row=f.db.prepare('SELECT * FROM assistant_handoff WHERE id=?').get(id);
    assert.equal(row.challenge_hash,null);assert.equal(row.challenge_expires,null);
    assert.doesNotMatch(JSON.stringify(row),new RegExp(challenge));
    assert.doesNotMatch(JSON.stringify((await f.machine({action:'outcome',handoff_id:id})).body),new RegExp(challenge));
  }finally{f.db.close();}
});

for(const bad of ['too-few','too-many','duplicate-pair','missing-area','new-target']) {
  test(`server catalog ${bad} refuses intake before pending state`,async()=>{
    const f=setup();try{
      let catalog=structuredClone(targets);
      if(bad==='too-few')catalog=catalog.slice(0,4);
      if(bad==='too-many')catalog.push(...Array.from({length:124},(_,i)=>({...targets[0],target_id:'ps_extra_'+i})));
      if(bad==='duplicate-pair')catalog.push({...targets[0]});
      if(bad==='missing-area')catalog=catalog.map(t=>t.area==='grant'?{...targets[0],target_id:'ps_other'}:t);
      if(bad==='new-target')catalog[3].target_id='new';
      f.env.ASSISTANT_TARGETS_JSON=JSON.stringify(catalog);
      assert.equal((await f.machine(f.intent())).status,403);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_handoff').get().n,0);
    }finally{f.db.close();}
  });
}
test('multiple explicit targets per area are valid without widening other target admission',async()=>{
  const f=setup();try{
    f.env.ASSISTANT_TARGETS_JSON=JSON.stringify([...targets,{...targets[0],target_id:'ps_about.hero'}]);
    const request={...f.intent(),target_id:'ps_about.hero'};
    assert.equal((await f.machine(request)).status,200);
    assert.equal((await f.machine({...request,delivery_id:'another',target_id:'ps_unlisted'})).status,403);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM assistant_handoff').get().n,1);
  }finally{f.db.close();}
});
