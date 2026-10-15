// [pc2-codex-42] Full agentSend + controlled ADVANCING clock; no immediate-timer deadline fiction.
// Fake DOM/fetch only; no browser, network, real timers or provider execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../staff.js',import.meta.url),'utf8');
const full=source.slice(source.indexOf('function initStaffChatTargets()'),source.indexOf('let siteContentItems ='));
const JOB='a'.repeat(32),VERSION='b'.repeat(64);
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function clock(){
  let now=0,id=0;const tasks=new Map();
  return {get now(){return now;},setTimeout(fn,ms){const key=++id;tasks.set(key,{at:now+ms,fn});return key;},clearTimeout(key){tasks.delete(key);},get size(){return tasks.size;},
    async advance(ms){const end=now+ms;for(;;){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}};
}
const response=data=>({ok:true,json:async()=>data});
const draft=()=>({ok:true,draft_id:'cid_synthetic',preview_version:VERSION,draft:{data:{title:'After'}},confirmation_preview:{before:{title:'Before'},after:{title:'After'}}});
function harness({states=['claimed','result'],hidden=false,fetchImpl,storage=new Map()}={}){
  const calls=[],messages=[],timing=clock(),listeners=new Map();let uuids=0;
  const nodes={chatInput:{value:'First intent'},chatBody:{appendChild(n){if(!messages.includes(n))messages.push(n);}},chatAreaSelect:{value:'content'},chatContentTarget:{value:'ps_home.hero'}};
  const document={hidden,getElementById:id=>nodes[id]||null,querySelector:()=>null,createElement:()=>({dataset:{},innerHTML:'',textContent:''}),
    addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)};
  const c=vm.createContext({document,AbortController,Date:{now:()=>timing.now},setTimeout:(fn,ms)=>timing.setTimeout(fn,ms),clearTimeout:id=>timing.clearTimeout(id),
    window:{sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}},crypto:{randomUUID:()=>{uuids++;return '00000000-0000-4000-8000-'+String(uuids).padStart(12,'0');}},
    escapeHtml:String,currentEventId:'ev_synthetic',currentCaregiverId:'cg_synthetic',currentGrantId:1,loadStaffConsole:async()=>{},viewCaregiver:async()=>{},
    fetch:async(path,options)=>{
      const body=options?JSON.parse(options.body):null,call={path,body,signal:options?.signal};calls.push(call);
      if(fetchImpl)return fetchImpl(call);
      if(!body)return response({ok:true,enabled:true});
      if(path.endsWith('/draft'))return response({ok:true,job_id:JOB,state:'pending'});
      if(body.action==='materialize')return response(draft());
      return response({ok:true,job_id:JOB,state:states.shift()||'pending'});
    }});
  vm.runInContext('let siteContentItems=[{id:"ps_home.hero",type_id:"page_section",status:"published",data:"{}"}];\n'+full,c);
  return {c,calls,nodes,messages,timing,storage,document,uuids:()=>uuids,send:()=>c.window.agentSend(),enable:()=>vm.runInContext('agentWebJobsEnabled=true',c),
    state:()=>vm.runInContext('({pending:agentWebJobPending,hold:agentConfirmationHold})',c),
    hide(){document.hidden=true;for(const fn of listeners.get('visibilitychange')||[])fn();},listeners:()=>[...listeners.values()].reduce((n,set)=>n+set.size,0)};
}
test('FULL agentSend reserves before deferred create HTTP AND body: double Enter posts once, retains second text and UUID',async()=>{
  const http=deferred(),body=deferred(),h=harness({fetchImpl:()=>http.promise});h.enable();
  const sending=h.send();assert.equal(h.calls.length,1);assert.equal(h.uuids(),1);assert.equal(h.state().pending,true);
  const assertReserved=async()=>{
    h.nodes.chatInput.value='Second intent must remain';await h.send();
    assert.equal(h.calls.length,1);assert.equal(h.uuids(),1);assert.equal(h.nodes.chatInput.value,'Second intent must remain');
    const button={getAttribute:k=>k==='data-draft-id'?'old_draft':k==='data-preview-version'?VERSION:null,closest:()=>({})};
    await h.c.confirmAgentChange(button);await h.c.discardAgentChange(button);assert.equal(h.calls.length,1);
  };
  await assertReserved();http.resolve({ok:true,json:()=>body.promise});await flush();await assertReserved();
  body.resolve({ok:true,job_id:JOB,state:'refused'});await sending;
  assert.equal(h.state().pending,false);assert.equal(h.state().hold,false);assert.equal(h.timing.size,0);assert.equal(h.listeners(),0);
  assert.equal(h.nodes.chatInput.value,'Second intent must remain');
});
test('FULL proposal lifecycle: one create, bounded current-job reads, one materialize, original explicit preview controls only',async()=>{
  const h=harness();h.enable();const sending=h.send();await flush();
  await h.timing.advance(2000);await h.timing.advance(2000);await sending;
  assert.deepEqual(h.calls.map(c=>c.path.endsWith('/draft')?'create':c.body.action),['create','status','status','materialize']);
  assert.ok(h.messages.some(n=>n.innerHTML.includes('Confirm &amp; publish')));assert.equal(h.state().pending,false);assert.equal(h.state().hold,false);
  assert.equal(h.timing.size,0);assert.ok(h.calls.every(c=>c.signal&&!c.signal.aborted));
});
for(const stage of ['fetch','body'])test('FULL create '+stage+' hangs: deadline60s aborts, persistent HOLD blocks replay and preserves next intent',async()=>{
  const forever=deferred(),h=harness({fetchImpl:()=>stage==='fetch'?forever.promise:{ok:true,json:()=>forever.promise}});h.enable();
  const sending=h.send();await flush();h.nodes.chatInput.value='Do not clear';
  await h.timing.advance(59999);assert.equal(h.state().pending,true);assert.equal(h.calls[0].signal.aborted,false);
  await h.timing.advance(1);await sending;
  assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.state().hold,true);assert.equal(h.storage.get('agent-confirmation-hold'),'1');
  await h.send();assert.equal(h.calls.length,1);assert.equal(h.uuids(),1);assert.equal(h.nodes.chatInput.value,'Do not clear');
  const resumed=harness({storage:h.storage});resumed.enable();await resumed.send();assert.equal(resumed.calls.length,0);
  assert.equal(h.timing.size,0);assert.equal(h.listeners(),0);
});
for(const stage of ['fetch','body'])test('status '+stage+' hangs: actual remaining deadline settles even when transport ignores abort',async()=>{
  const forever=deferred(),h=harness({fetchImpl:()=>stage==='fetch'?forever.promise:{ok:true,json:()=>forever.promise}});
  const outcome=h.c.webJobJson('/api/agent/web-jobs',{action:'status',job_id:JOB},5000).then(()=>false,()=>true);
  await flush();await h.timing.advance(4999);assert.equal(h.calls[0].signal.aborted,false);
  await h.timing.advance(1);assert.equal(await outcome,true);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.timing.size,0);assert.equal(h.listeners(),0);
});
for(const stage of ['fetch','body'])test('FULL materialize '+stage+' hangs after10s create: only50s remain, lost ACK persists HOLD/no replay',async()=>{
  const created=deferred(),forever=deferred(),h=harness({fetchImpl:call=>call.path.endsWith('/draft')?created.promise:stage==='fetch'?forever.promise:{ok:true,json:()=>forever.promise}});h.enable();
  const sending=h.send();await h.timing.advance(10000);created.resolve(response({ok:true,job_id:JOB,state:'result'}));await flush();
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.action,'materialize');
  await h.timing.advance(49999);assert.equal(h.state().pending,true);assert.equal(h.calls[1].signal.aborted,false);
  await h.timing.advance(1);await sending;assert.equal(h.calls[1].signal.aborted,true);assert.equal(h.state().hold,true);
  const count=h.calls.length;h.nodes.chatInput.value='No replacement';await h.send();assert.equal(h.calls.length,count);assert.equal(h.nodes.chatInput.value,'No replacement');
  assert.equal(h.storage.get('agent-confirmation-hold'),'1');assert.equal(h.timing.size,0);assert.equal(h.listeners(),0);
});
test('hidden materialize body aborts/persists HOLD, late body cannot present preview',async()=>{
  const body=deferred(),h=harness({fetchImpl:call=>call.path.endsWith('/draft')?response({ok:true,job_id:JOB,state:'result'}):{ok:true,json:()=>body.promise}});h.enable();
  const sending=h.send();await flush();assert.equal(h.calls.length,2);h.hide();await sending;
  assert.equal(h.calls[1].signal.aborted,true);assert.equal(h.state().hold,true);assert.equal(h.timing.size,0);assert.equal(h.listeners(),0);
  body.resolve(draft());await flush();assert.ok(!h.messages.some(n=>n.innerHTML.includes('Confirm &amp; publish')));assert.equal(h.calls.length,2);
});
test('hidden/expired before request never post; known refused releases without materialize',async()=>{
  const hidden=harness({hidden:true});await assert.rejects(()=>hidden.c.webJobJson('/api/agent/web-jobs',{action:'status',job_id:JOB},5000));assert.equal(hidden.calls.length,0);
  const expired=harness();await assert.rejects(()=>expired.c.webJobJson('/api/agent/web-jobs',{action:'status',job_id:JOB},0));assert.equal(expired.calls.length,0);
  const refused=harness({fetchImpl:()=>response({ok:true,job_id:JOB,state:'refused'})});refused.enable();await refused.send();
  assert.equal(refused.calls.length,1);assert.equal(refused.state().pending,false);assert.equal(refused.state().hold,false);
  refused.nodes.chatInput.value='New known-safe intent';await refused.send();assert.equal(refused.calls.length,2);
});
test('pending refresh consumes advancing one-minute clock; hidden wait never sends status',async()=>{
  const h=harness({states:[]});h.enable();const sending=h.send();await flush();await h.timing.advance(60000);await sending;
  assert.ok(h.calls.length<=30);assert.equal(h.state().hold,true);assert.equal(h.timing.size,0);
  const hidden=harness();hidden.enable();const stopped=hidden.send();await flush();hidden.hide();await hidden.timing.advance(2000);await stopped;
  assert.equal(hidden.calls.length,1);assert.equal(hidden.state().hold,true);
});
test('known hold/refused remain terminal without a standing refresh',async()=>{
  for(const terminal of ['hold','refused']){
    const h=harness({states:[terminal]});h.enable();const sending=h.send();await flush();await h.timing.advance(2000);await sending;
    assert.equal(h.calls.length,2);assert.equal(h.state().hold,terminal==='hold');assert.equal(h.timing.size,0);
  }
});
test('failed status or materialization acknowledgement persists HOLD; late success cannot release it',async()=>{
  for(const action of ['status','materialize']){
    const h=harness({fetchImpl:call=>call.path.endsWith('/draft')?response({ok:true,job_id:JOB,state:action==='status'?'pending':'result'}):{ok:false,json:async()=>({ok:false,error:'synthetic refusal'})}});
    h.enable();const sending=h.send();await flush();if(action==='status')await h.timing.advance(2000);await sending;
    assert.equal(h.state().hold,true);assert.equal(h.storage.get('agent-confirmation-hold'),'1');assert.equal(h.calls.length,2);assert.equal(h.timing.size,0);
    h.nodes.chatInput.value='Retain while held';await h.send();assert.equal(h.calls.length,2);assert.equal(h.nodes.chatInput.value,'Retain while held');
  }
});
test('OFF exact legacy body/mapper fetch preserved without signal/new UUID; feature defaults false',async()=>{
  const h=harness({fetchImpl:()=>response(draft())});await h.send();
  assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{type_id:'page_section',target_id:'ps_home.hero',request:'First intent'});
  assert.equal(h.calls[0].signal,undefined);assert.equal(h.uuids(),0);assert.ok(h.messages.some(n=>n.innerHTML.includes('Confirm &amp; publish')));
  assert.equal(h.state().hold,false);assert.equal(h.timing.size,0);
  const feature=harness();assert.equal(vm.runInContext('agentWebJobsEnabled',feature.c),false);await feature.c.initWebJobFeature();assert.equal(vm.runInContext('agentWebJobsEnabled',feature.c),true);
});
