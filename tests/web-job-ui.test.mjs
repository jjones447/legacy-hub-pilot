// [pc2-codex-42] Fake DOM/fetch/clock only; no browser/network/timers are started.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../staff.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let agentWebJobPending ='),source.indexOf('window.agentSend ='));
const JOB='a'.repeat(32),VERSION='b'.repeat(64);
function harness({states=['claimed','result'],hidden=false,fail=false}={}){
  const calls=[],node={},document={hidden};let materializations=0;
  const c=vm.createContext({document,Date,setTimeout:fn=>fn(),fetch:async(path,options)=>{
    const body=options?JSON.parse(options.body):null;calls.push({path,body});if(fail)throw Error('synthetic transport');
    if(!body)return {ok:true,json:async()=>({ok:true,enabled:true})};
    if(body.action==='materialize'){materializations++;return {ok:true,json:async()=>({ok:true,draft_id:'cid_synthetic',preview_version:VERSION})};}
    return {ok:true,json:async()=>({ok:true,job_id:JOB,state:states.shift()||'pending'})};
  }});
  vm.runInContext(code,c);return {c,calls,node,document,materializations:()=>materializations};
}
test('pending one-job refresh stops at result, materializes once, never calls confirm/discard or model',async()=>{
  const h=harness();const draft=await h.c.awaitCurrentWebJob({ok:true,job_id:JOB,state:'pending'},h.node);
  assert.equal(draft.preview_version,VERSION);assert.equal(h.materializations(),1);
  assert.deepEqual(h.calls.map(c=>c.body.action),['status','status','materialize']);
  assert.ok(h.calls.every(c=>c.path==='/api/agent/web-jobs'&&c.body.job_id===JOB));
});
for(const kind of ['hidden','hold','unknown','budget'])test(`job refresh ${kind} stops without repost/materialize/confirm`,async()=>{
  const h=harness({hidden:kind==='hidden',states:kind==='hold'?['hold']:[],fail:kind==='unknown'});
  await assert.rejects(()=>h.c.awaitCurrentWebJob({ok:true,job_id:JOB,state:'pending'},h.node));
  assert.equal(h.materializations(),0);assert.ok(h.calls.length<=30);assert.ok(h.calls.every(c=>c.body.action==='status'));
});
test('OFF flag starts false and only explicit verified backend feature response enables it; no layout/mic changes',async()=>{
  const h=harness();assert.equal(vm.runInContext('agentWebJobsEnabled',h.c),false);
  await h.c.initWebJobFeature();assert.equal(vm.runInContext('agentWebJobsEnabled',h.c),true);
  assert.match(source,/agentWebJobsEnabled \? \{ idempotency_key:/);
  assert.doesNotMatch(code,/setInterval|agent-change-confirm|\/api\/agent\/confirm|MediaRecorder/);
});
