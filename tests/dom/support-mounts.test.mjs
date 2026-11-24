import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createSupportMounts,mount,bindOwnerPageLifecycle} from '../../portal-support-entry.mjs';import {mountStaffSupport} from '../../portal-support-staff-ui.mjs';
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('owner mount is explicit and teardown clears rendered data before late history',async()=>{const dom=new JSDOM('<section id="portalFunctionalSupport" hidden></section><section id="staffFunctionalSupport" hidden></section>');const root=dom.window.document.getElementById('portalFunctionalSupport');let resolve,calls=0;const mounts=createSupportMounts(dom.window.document,()=>{calls++;return new Promise(r=>{resolve=r;});});try{assert.equal(calls,0);mounts.mountOwner();assert.equal(root.hidden,false);root.querySelector('textarea').value='Fictional private text';mounts.resetOwner();assert.equal(root.hidden,true);assert.equal(root.textContent,'');resolve(response({ok:true,requests:[{id:'old',status:{code:'received'}}]}));await new Promise(r=>setImmediate(r));assert.equal(root.textContent,'');}finally{mounts.dispose();dom.window.close();}});
test('Staff UI uses server revision and freezes unknown outcome until explicit refresh',async()=>{const dom=new JSDOM('<main></main>');const root=dom.window.document.querySelector('main');const calls=[];const transport=async(method,body)=>{calls.push([method,body]);return method==='GET'?{ok:true,requests:[{id:'fictional',revision:4,needs:['break'],message:'<img src=x onerror=alert(1)>',preferred_contact:'text',status:{code:'in_review'}}]}:{ok:false,error:'outcome_unknown'};};const ui=mountStaffSupport(root,transport);try{await ui.load();assert.equal(root.querySelectorAll('img').length,0);const select=root.querySelector('select');select.value='followed_up';select.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setImmediate(r));assert.deepEqual(calls[1],['POST',{id:'fictional',revision:4,status:'followed_up'}]);assert.equal(select.disabled,true);assert.match(root.querySelector('[role=alert]').textContent,/not confirmed/);assert.equal(root.querySelector('[role=status]').textContent,'In Review');ui.reset();assert.equal(root.querySelectorAll('article').length,0);}finally{ui.dispose();dom.window.close();}});

test('named page mount registers once, makes no request and unregisters once on dispose',()=>{const dom=new JSDOM('<main></main>');const root=dom.window.document.querySelector('main');let registered=0,released=0,calls=0,received;dom.window.registerPortalSupportView=view=>{registered++;received=view;return()=>{released++;};};const view=mount(root,async()=>{calls++;});try{assert.equal(registered,1);assert.equal(received,view);assert.equal(calls,0);view.reset();assert.equal(released,0);view.dispose();view.dispose();assert.equal(released,1);assert.equal(calls,0);}finally{dom.window.close();}});

test('BFCache hide resets without disposing; restore/focus hide until revalidation and unmount disposes',async()=>{const dom=new JSDOM('<main></main>');await new Promise(r=>setImmediate(r));const root=dom.window.document.querySelector('main');let release,disposed=0,reset=0,history=0;const view={reset(){reset++;root.textContent='';},dispose(){disposed++;},async history(){history++;root.textContent='Owner history';}};const lifecycle=bindOwnerPageLifecycle(view,root,()=>new Promise(r=>{release=r;}));try{const first=lifecycle.start();assert.equal(root.hidden,true);release();await first;assert.equal(root.textContent,'Owner history');dom.window.dispatchEvent(new dom.window.Event('pagehide'));assert.equal(root.hidden,true);assert.equal(disposed,0);assert.equal(reset,1);dom.window.dispatchEvent(new dom.window.Event('pageshow'));assert.equal(root.hidden,true);release();await new Promise(r=>setImmediate(r));assert.equal(root.hidden,false);dom.window.dispatchEvent(new dom.window.Event('focus'));assert.equal(root.hidden,true);release();await new Promise(r=>setImmediate(r));assert.equal(root.hidden,false);assert.equal(history,3);lifecycle.dispose();assert.equal(disposed,1);}finally{lifecycle.dispose();dom.window.close();}});

import {bindSupportPage} from '../../portal-support-bootstrap.mjs';

test('public intake stays retired after owner loss and returns only on confirmed feature disable', async () => {
  const dom = new JSDOM('<section id="portalFunctionalSupport" hidden></section><div id="supportLegacyPublicForm"></div>');
  const { window } = dom;
  const root = window.document.getElementById('portalFunctionalSupport');
  const publicForm = window.document.getElementById('supportLegacyPublicForm');
  let enabled = true, owner = 'member-one', reads = 0;
  window.fetch = async url => {
    if (url === '/api/portal/me?support=1') return owner
      ? response({ok:true, profile:{id:owner}, capabilities:{support_requests:enabled}})
      : new Response('', {status:401});
    assert.equal(url, '/api/portal/support-requests');
    reads++;
    return response({ok:true, requests:[]});
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const dispose = bindSupportPage(window);
  try {
    await settle();
    assert.ok(reads > 0);
    assert.equal(publicForm.hidden, true);
    window.dispatchEvent(new window.Event('pagehide'));
    assert.equal(root.hidden, true);
    assert.equal(root.childElementCount, 0);
    owner = '';
    window.dispatchEvent(new window.Event('pageshow'));
    await settle();
    assert.equal(publicForm.hidden, true);
    owner = 'member-one'; enabled = false;
    window.dispatchEvent(new window.Event('focus'));
    await settle();
    assert.equal(publicForm.hidden, false);
    assert.equal(publicForm.inert, false);
    assert.equal(root.hidden, true);
  } finally { dispose(); window.close(); }
});

test('dashboard waits for its authenticated owner and rejects another session', async () => {
  const dom = new JSDOM('<section id="dashView"><div id="portalFunctionalSupport" hidden></div></section>');
  const { window } = dom;
  const root = window.document.getElementById('portalFunctionalSupport');
  let calls = 0;
  window.fetch = async url => {
    calls++;
    assert.equal(url, '/api/portal/me?support=1');
    return response({ok:true,profile:{id:'other'},capabilities:{support_requests:true}});
  };
  const dispose = bindSupportPage(window);
  try {
    assert.equal(calls, 0);
    window.portalFunctionalOwner = 'dashboard-owner';
    await window.portalSupportRefresh();
    assert.equal(root.hidden, true);
    assert.equal(root.childElementCount, 0);
  } finally { dispose(); window.close(); }
});

test('Staff mount checks active identity again before posting a status change', async () => {
  const dom = new JSDOM('<section id="staffFunctionalSupport" hidden></section>');
  const {window} = dom;
  const root = window.document.getElementById('staffFunctionalSupport');
  let actor = 'one@example.invalid', writes = 0;
  window.fetch = async (url, options) => {
    if (url === '/api/staff/me?support=1') return response({
      ok:true, me:{email:actor,status:'active',role:'staff'}, capabilities:{support_requests:true}
    });
    if (options.method === 'POST') writes++;
    return response({ok:true,requests:[{id:'synthetic',revision:1,needs:[],status:{code:'in_review'}}]});
  };
  const dispose = bindSupportPage(window);
  try {
    await new Promise(resolve => setImmediate(resolve));
    const status = root.querySelector('select');
    assert.ok(status);
    actor = 'two@example.invalid';
    status.value = 'followed_up';
    status.dispatchEvent(new window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 0);
    assert.equal(root.hidden, true);
    assert.equal(root.childElementCount, 0);
  } finally { dispose(); window.close(); }
});
