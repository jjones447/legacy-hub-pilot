// Synthetic DOM/fetch only. A simulated click is NOT real-human acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../staff.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('// A locator only:'),source.indexOf("if (typeof window !== 'undefined' && typeof document !== 'undefined')"));
const id='ah_'+'a'.repeat(32),version='b'.repeat(64);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(replies,hash='#handoff='+id){
  const calls=[],panels=[],history=[];
  const element=()=>({children:[],textContent:'',listeners:{},appendChild(child){this.children.push(child);},prepend(child){this.children.unshift(child);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll(tag){return this.children.filter(x=>x.tag===tag);}});
  const document={createElement(tag){return {...element(),tag};},getElementById:()=>({parentElement:{prepend:panel=>panels.push(panel)}})};
  const context=vm.createContext({window:{location:{hash,pathname:'/staff',search:''},history:{replaceState:(_state,_title,url)=>history.push(url)}},document,
    fetch:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      const next=replies.shift(); if(typeof next==='function')return next();
      if(next instanceof Error)throw next;
      return {ok:true,json:async()=>next};
    }});
  vm.runInContext('let agentConfirmationHold=false, agentConfirmationPending=false; function holdAgentConfirmation(){agentConfirmationHold=true;}\n'+code,context);
  const text=()=>panels.flatMap(p=>p.children.map(c=>c.textContent)).join('\n');
  async function click(label){const b=panels[0].children.find(c=>c.tag==='button'&&c.textContent===label);assert.ok(b,'missing '+label);b.listeners.click();await tick();}
  return {context,calls,panels,history,text,click,start:()=>context.initAssistantHandoff()};
}
test('opaque handoff only, separate human pairing/initiation/preview approval, no raw text URL or HTML',async()=>{
  const h=harness([
    {ok:true,state:'pending'}, {ok:true,state:'challenged',challenge:'c'.repeat(32),channel:'CSYNTHETIC',thread:'1900.001'},
    {ok:true,state:'paired',area:'content',target_id:'ps_home.hero',request:'<script>fictional request</script>'},
    {ok:true,state:'drafted',area:'content',target_id:'ps_home.hero',request:'Fictional',preview:{before:{title:'Before'},after:{title:'After'}},preview_version:version},
    {ok:true,state:'published'}
  ]);
  await h.start();assert.deepEqual(h.history,['/staff']);assert.equal(h.calls.length,1);
  await h.click('Begin identity pairing');assert.match(h.text(),/Post this one-use code yourself/);
  assert.equal(h.calls.length,2,'no automated Slack post');
  await h.click('Check pairing');assert.match(h.text(),/<script>fictional request<\/script>/);
  assert.equal(h.calls.length,3,'pairing does not automatically draft');
  await h.click('Create my draft');assert.match(h.text(),/Review the exact before\/after/);
  assert.equal(h.calls.length,4,'preview does not automatically confirm');
  await h.click('Confirm this exact preview');assert.match(h.text(),/published/);
  assert.deepEqual(h.calls.map(c=>c.body.action),['view','begin','view','draft','confirm']);
  assert.deepEqual(h.calls.at(-1).body,{action:'confirm',handoff_id:id,preview_version:version});
  assert.ok(h.calls.every(c=>c.url==='/api/agent/handoff'));
  assert.ok(h.calls.every(c=>!('request' in c.body)&&!('actor' in c.body)&&!('challenge' in c.body)));
  assert.doesNotMatch(code,/innerHTML|console\./);
});
test('no locator means no handoff requests or UI',async()=>{
  for(const hash of ['', '#handoff=forged', '#handoff='+id+'&request=anything']){
    const h=harness([],hash);await h.start();assert.equal(h.calls.length,0);assert.equal(h.panels.length,0);
  }
});
test('uncertain draft response latches shared HOLD and does not retry or replace',async()=>{
  const h=harness([{ok:true,state:'paired',request:'Fictional',area:'content',target_id:'ps_home.hero'},new Error('FICTIONAL_UNKNOWN_ACK')]);
  await h.start();await h.click('Create my draft');
  assert.match(h.text(),/HOLD/);assert.equal(h.calls.length,2);
  await h.context.initAssistantHandoff();assert.equal(h.calls.length,2);
  assert.equal(vm.runInContext('agentConfirmationHold',h.context),true);
});
test('pending confirmation blocks double click and every shared console mutation',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const h=harness([{ok:true,state:'drafted',area:'event',target_id:'ev_synthetic',request:'Fictional',preview:{before:{title:'Before'},after:{title:'After'}},preview_version:version},()=>pending]);
  await h.start();await h.click('Confirm this exact preview');await h.click('Confirm this exact preview');
  assert.equal(h.calls.length,2);assert.equal(vm.runInContext('agentConfirmationPending',h.context),true);
  release({ok:true,json:async()=>({ok:true,state:'published'})});await tick();
  assert.equal(vm.runInContext('agentConfirmationPending',h.context),false);
});

test('a failed read-only locator cannot latch unrelated console operations on HOLD',async()=>{
  const h=harness([new Error('FICTIONAL_NOT_FOUND')]);await h.start();
  assert.match(h.text(),/Could not read/);
  assert.equal(vm.runInContext('agentConfirmationHold',h.context),false);
  assert.equal(vm.runInContext('agentConfirmationPending',h.context),false);
  assert.equal(h.calls.length,1);
});
