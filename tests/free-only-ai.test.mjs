// Fictional HTTP contexts only. No provider, account, audio upload or customer IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onRequestPost} from '../functions/api/agent/[[path]].js';
import {onRequestPost as transcribe} from '../functions/api/agent/transcribe.js';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
import {FREE_AI_UNAVAILABLE} from '../functions/_lib/free-ai.mjs';

const routes = [
  ['/api/agent/chat', {message:'Fictional conversation',history:[]}],
  ['/api/agent/draft', {type_id:'resource',request:'Fictional content'}],
  ['/api/agent/draft', {type_id:'page_section',target_id:'ps_form.request_support',request:'Fictional form'}],
  ...['caregiver','event','grant'].map(area => ['/api/agent/change/draft', {area,target_id:'fictional',request:'Fictional change'}]),
  ['/api/agent/transcribe', null],
];
const now = Math.floor(Date.now()/1000);
const fresh = {plan:'workers-free',account_id:'fictional',route:'direct',verified_at:now,expires_at:now+900};
const scenarios = [
  ['absent', {}],
  ['self-declared free flag', {LEGACY_AI_FREE:'1'}],
  ['unverified plan', {LEGACY_AI_FREE_RECEIPT:'unknown'}],
  ['fresh free receipt without maintained provider hard stop', {LEGACY_AI_FREE_RECEIPT:JSON.stringify(fresh)}],
  ['stale receipt', {LEGACY_AI_FREE_RECEIPT:JSON.stringify({...fresh,expires_at:now-1})}],
  ['wrong account', {LEGACY_AI_FREE_RECEIPT:JSON.stringify({...fresh,account_id:'other'})}],
  ['paid/shared account', {LEGACY_AI_FREE_RECEIPT:JSON.stringify({...fresh,plan:'workers-paid',shared:true})}],
  ['prepaid route', {LEGACY_AI_FREE_RECEIPT:JSON.stringify({...fresh,billing:'unified',prepaid:true})}],
  ['implicit gateway', {EMP_LLM_GATEWAY_URL:'https://gateway.invalid/fixture',EMP_LLM_GATEWAY_KEY:'FICTIONAL'}],
  ['explicit gateway', {AGENT_MAPPER_BACKEND:'gateway',EMP_LLM_GATEWAY_URL:'https://gateway.invalid/fixture'}],
  ['Workers AI backend flag', {AGENT_MAPPER_BACKEND:'workers-ai'}],
  ['unknown backend/model', {AGENT_MAPPER_BACKEND:'unknown',AGENT_MODEL:'@cf/fictional/paid-model'}],
];

for (const [scenario,settings] of scenarios) for (const [path,body] of routes) {
  test(`${scenario}: ${path}${body?.area ? '/'+body.area : body?.type_id ? '/'+body.type_id : ''} denies before any spend or data access`,async()=>{
    let effects=0;
    const env={...settings};
    for(const key of ['AI','LEGACY_DB','ASSISTANT_WEB_JOB_TRANSPORT']) Object.defineProperty(env,key,{get(){effects++;throw Error('must not access '+key);}});
    const data={};setVerifiedAccessStaffActor(data,'fictional@example.invalid');
    const request=new Request('https://fixture.invalid'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const previous=globalThis.fetch;let outbound=0;
    globalThis.fetch=async()=>{outbound++;throw Error('must not fetch');};
    try {
      const response=await onRequestPost({request,env,data});
      assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
      const result=await response.json();assert.equal(result.code,'free_ai_unavailable');assert.equal(result.error,FREE_AI_UNAVAILABLE);
      assert.equal(effects,0);assert.equal(outbound,0);
      assert.doesNotMatch(JSON.stringify(result),/FICTIONAL|gateway\.invalid|expires_at|account_id/);
    } finally {globalThis.fetch=previous;}
  });
}

for (const path of ['/api/agent/draft','/api/agent/change/draft']) test(`external website-job dispatch ${path} remains denied even with a server mapper and fresh flags`,async()=>{
  let effects=0;
  const env={ASSISTANT_WEB_JOBS_ENABLED:'1',LEGACY_AI_FREE_RECEIPT:JSON.stringify(fresh),AGENT_MAPPER_BACKEND:()=>{effects++;throw Error('must not map');}};
  for(const key of ['AI','LEGACY_DB','ASSISTANT_WEB_JOB_TRANSPORT']) Object.defineProperty(env,key,{get(){effects++;throw Error('must not access');}});
  const request={url:'https://fixture.invalid'+path,async json(){effects++;throw Error('must not read or dispatch');}};
  assert.equal((await onRequestPost({request,env})).status,503);assert.equal(effects,0);
});

test('direct ASR denies before body, audio encoding, provider binding or environment access',async()=>{
  const poison=new Proxy({}, {get(){throw Error('must not inspect');}});
  const result=await transcribe({request:poison,env:poison});
  assert.equal(result.status,503);assert.equal((await result.json()).code,'free_ai_unavailable');
});

test('unverified chat still refuses authentication before considering inference',async()=>{
  const response=await onRequestPost({request:new Request('https://fixture.invalid/api/agent/chat',{method:'POST',body:'{}'}),env:{},data:{email:'spoofed@example.invalid'}});
  assert.equal(response.status,403);
});

test('HTTP inference dispatcher cannot pass provider/gateway bindings to the pure mapping helpers',()=>{
  const source=readFileSync(new URL('../functions/api/agent/[[path]].js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/env\.AI\b|EMP_LLM_GATEWAY|env\.AGENT_MODEL|createWebJob\s*\(/);
  assert.match(source,/typeof env\.AGENT_MAPPER_BACKEND !== 'function'/);
  const asr=readFileSync(new URL('../functions/api/agent/transcribe.js',import.meta.url),'utf8');
  assert.doesNotMatch(asr,/AI\.run|arrayBuffer\(|formData\(|fetch\(/);
});
