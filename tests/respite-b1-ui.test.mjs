// Complete browser script in a synthetic DOM; no browser/runtime, storage or transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ACK_VERSION, ACK_COPY } from '../functions/_lib/respite-b1.mjs';
const code=readFileSync(new URL('../respite-b1.js',import.meta.url),'utf8');
const template=readFileSync(new URL('../templates/respite-application.html.j2',import.meta.url),'utf8');
const source=readFileSync(new URL('../staff.js',import.meta.url),'utf8');
function ui({form=true, response, confirm=true}={}) {
  const nodes={}, named={}, calls=[];
  class Element {
    constructor(tag='div') {this.tag=tag;this.children=[];this.handlers={};this.value='';this.checked=false;this.disabled=false;this.hidden=true;}
    set id(value){this._id=value;nodes[value]=this;} get id(){return this._id;}
    set name(value){this._name=value;named[value]=this;} get name(){return this._name;}
    appendChild(child){child.parent=this;this.children.push(child);return child;}
    set textContent(value){this.text=String(value);this.children=[];} get textContent(){return this.text||'';}
    setAttribute(){} addEventListener(name,fn){this.handlers[name]=fn;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);delete nodes[this.id];}
    querySelectorAll(tag){return this.children.flatMap(x=>[...(x.tag===tag?[x]:[]),...x.querySelectorAll(tag)]);}
    reportValidity(){return true;} reset(){for(const node of Object.values(named)){node.value='';node.checked=false;}}
  }
  for (const id of ['respiteMessage','respiteFields','respiteQuestions','respitePrivacy','respiteNonmedical','attendancePanel']) {nodes[id]=new Element();nodes[id].id=id;}
  nodes.respiteFields.disabled=true;
  if(form){nodes.respiteForm=new Element('form');nodes.respiteForm.elements={namedItem:name=>named[name]};
    for(const name of ['event_id','privacy_ack','nonmedical_ack']){const node=new Element();node.name=name;}}
  const context=vm.createContext({document:{getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag)},
    window:{confirm:()=>confirm},crypto:{randomUUID:()=> '00112233-4455-4677-8899-aabbccddeeff'},
    localStorage:{setItem(){throw Error('storage forbidden');}},
    fetch:async(url,init)=>{calls.push({url,init});return response?response(url,init):{ok:false,json:async()=>({ok:false})};}});
  vm.runInContext(code,context);
  return {nodes,named,calls,context};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ok=body=>({ok:true,json:async()=>({ok:true,...body})});
const config={draft:true,sessions:[{id:'ev_fixture',title:'Fictional session',starts_at:'2099-11-19'}],ack_version:ACK_VERSION,acknowledgments:ACK_COPY};
test('unavailable form stays hidden/disabled and never POSTs or invokes generic registration',async()=>{
  const h=ui();await tick();assert.equal(h.nodes.respiteFields.disabled,true);
  assert.equal(h.nodes.respiteForm.hidden,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/respite');
  assert.match(template,/<fieldset id="respiteFields" disabled>/);assert.doesNotMatch(template,/submit-register|regForm/);
});
test('independent acknowledgments start unchecked, session is explicit and submit receipt remains pending',async()=>{
  const posts=[];const h=ui({response:(url,init)=>{if(init?.method==='POST'){posts.push(JSON.parse(init.body));return ok({message:'Received; pending review, not confirmed.'});}return ok(config);}});
  await tick();assert.equal(h.nodes.respiteForm.hidden,false);assert.equal(h.nodes.respiteFields.disabled,false);
  assert.equal(h.named.privacy_ack.checked,false);assert.equal(h.named.nonmedical_ack.checked,false);
  assert.equal(h.named.event_id.children[0].value,'');assert.equal(h.named.event_id.children[1].value,'ev_fixture');
  h.named.event_id.value='ev_fixture';h.named.privacy_ack.checked=true;h.named.nonmedical_ack.checked=true;
  await h.nodes.respiteForm.handlers.submit({preventDefault(){}});
  assert.equal(posts.length,1);assert.equal(posts[0].event_id,'ev_fixture');assert.equal(posts[0].privacy_ack,true);assert.equal(posts[0].nonmedical_ack,true);
  assert.equal(posts[0].ack_version,ACK_VERSION);assert.equal(posts[0].caregiver_id,undefined);assert.equal(h.nodes.respiteForm.hidden,true);
  assert.match(h.nodes.respiteMessage.textContent,/pending review/);assert.equal(h.named.privacy_ack.checked,false);
});
test('lost acknowledgment retries keep identical request identity; do not create fresh key automatically',async()=>{
  const posts=[];const h=ui({response:(url,init)=>{if(init?.method==='POST'){posts.push(JSON.parse(init.body));throw Error('lost');}return ok(config);}});
  await tick();const send=()=>h.nodes.respiteForm.handlers.submit({preventDefault(){}});
  await send();await send();assert.equal(posts.length,2);assert.equal(posts[0].request_id,posts[1].request_id);
  assert.equal(h.nodes.respiteForm.hidden,false);assert.equal(h.nodes.respiteFields.disabled,false);
});
test('staff unavailable or unlisted path never fetches private details or renders a panel',async()=>{
  const h=ui({form:false});await h.context.window.LegacyRespite.loadPending('ev_fixture');
  assert.equal(h.calls.length,1);assert.equal(h.nodes.respiteReview,undefined);assert.doesNotMatch(h.calls[0].url,/\?id=/);
  assert.match(source,/await window\.LegacyRespite\.loadPending\(eventId\)/);
});
test('staff summary renders only reference/status; explicit detail click then explicit decision POST',async()=>{
  const app={id:'ra_fixture',status:'pending',revision:2,first_time:1};const decisions=[];
  const h=ui({form:false,response:(url,init)=>{
    if(init?.method==='POST'){decisions.push(JSON.parse(init.body));return ok({});}
    return url.includes('?id=')?ok({application:{...app,acknowledged_at:'fictional',privacy_version:ACK_VERSION,nonmedical_version:ACK_VERSION},details:{safety:'<img src=x onerror=alert(1)>'}}):ok({applications:[app]});
  }});
  await h.context.window.LegacyRespite.loadPending('ev_fixture');
  assert.equal(h.calls.length,1);const section=h.nodes.respiteReview;const card=section.children.at(-1);
  assert.match(card.children[0].textContent,/first-time follow-up/);const open=card.children[1];await open.handlers.click();
  const detail=card.children.at(-1);assert.equal(detail.children[1].textContent,'Safety considerations (optional): <img src=x onerror=alert(1)>');
  assert.equal(detail.children[1].children.length,0,'private text never parsed as markup');
  const button=detail.querySelectorAll('button').find(x=>x.textContent==='Decline request');await button.handlers.click();
  assert.equal(decisions.length,1);assert.equal(decisions[0].revision,2);assert.equal(decisions[0].action,'decline');
  assert.equal(h.calls.some(x=>/api\/intake|api\/agent/.test(x.url)),false);
});

test('collection-off page exposes every question, choice and acknowledgment without input or transport',()=>{
  const preview=template.split('<section aria-labelledby="questionPreview">')[1].split('</section>')[0];
  const escape=value=>value.replaceAll('&','&amp;').replaceAll("'",'&#x27;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const textFields=[...code.split('const booleanLabels')[0].matchAll(/\w+: \['([^']+)', (\d+), (true|false)\]/g)];
  assert.equal(textFields.length,16);
  for(const [,label,max,required] of textFields){assert.ok(preview.includes(escape(label)),label);assert.ok(preview.includes('up to '+max+' characters.'));}
  const booleans=[...code.split('const booleanLabels = {')[1].split('};')[0].matchAll(/\w+: '([^']+)'/g)];
  assert.equal(booleans.length,4);
  for(const [,label] of booleans)assert.ok(preview.includes(escape(label)),label);
  assert.equal((preview.match(/choose Yes or No/g)||[]).length,4);
  for(const copy of Object.values(ACK_COPY))assert.ok(preview.includes(escape(copy)));
  assert.match(preview,/Requested session/);assert.match(preview,/no session is selected/);
  assert.doesNotMatch(preview,/<(?:input|textarea|select|button|form)\b/);
});
