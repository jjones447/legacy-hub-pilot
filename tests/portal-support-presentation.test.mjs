import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const base='docs/previews/portal-support/';
test('presentation preserves no-send boundary and exact support controls',()=>{
 for(const f of ['index.html','request-support.html']){
  const s=read(base+f);
  assert.match(s,/connect-src 'none'/);assert.match(s,/form-action 'none'/);
  assert.doesNotMatch(s,/<form\b|supWho|Memory Social|wellness grant/i);
  assert.match(s,/fictional details only\. Nothing is sent or saved/);
  assert.match(s,/<header class="site-header">/);assert.match(s,/<footer>/);
  assert.match(s,/href="index.html" class="nav-portal"/);
  assert.match(s,/src="nav-v2.js"/);assert.doesNotMatch(s,/src="app.js"/);
 }
 const s=read(base+'request-support.html');
 assert.match(s,/<button[^>]*disabled[^>]*>Send My Request/);
 assert.equal((s.match(/type="checkbox"/g)||[]).length,5);
 assert.equal((s.match(/class="card need-card"/g)||[]).length,5);
 assert.match(s,/How can we support you\?/);assert.match(s,/What happens after you reach out\?/);
 assert.match(read(base+'index.html'),/Welcome to Your Sanctuary, Jordan!/);
 assert.equal((read(base+'index.html').match(/class="preview-icon"/g)||[]).length,4);
 const css=read(base+'preview.css');
 assert.match(css,/:has\(input:checked\)/);assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/grid-template-columns:1fr/);assert.match(css,/a.card\{text-decoration:none/);
});
test('default fictional examples clear and restore without persistence on either page',()=>{
 const script=read(base+'preview.js');
 assert.doesNotMatch(script,/fetch\s*\(|localStorage|sessionStorage|XMLHttpRequest|sendBeacon/);
 assert.doesNotMatch(read('nav-v2.js'),/fetch\s*\(|localStorage|sessionStorage|XMLHttpRequest|sendBeacon/);
 for(const page of ['dashboard','request']){
  const ids=['show-example','clear-example','example-note',...(page==='dashboard'?['preview-welcome','profile-example','wellness-example']:['preview-name','preview-email'])];
  const nodes=Object.fromEntries(ids.map(id=>[id,{hidden:true,value:'',addEventListener(event,fn){this.click=fn;}}]));
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]}});
  assert.equal(nodes['show-example'].hidden,true);assert.equal(nodes['clear-example'].hidden,false);
  assert.match(nodes['example-note'].textContent,/Fictional example.*not your records/);
  if(page==='dashboard'){assert.equal(nodes['profile-example'].hidden,false);assert.match(nodes['preview-welcome'].textContent,/Jordan/);}
  else assert.equal(nodes['preview-email'].value,'jordan@example.invalid');
  nodes['clear-example'].click();assert.equal(nodes['show-example'].hidden,false);
  if(page==='dashboard'){assert.equal(nodes['wellness-example'].hidden,true);assert.doesNotMatch(nodes['preview-welcome'].textContent,/Jordan/);}
  else assert.equal(nodes['preview-name'].value,'');
  nodes['show-example'].click();
  if(page==='dashboard') assert.equal(nodes['wellness-example'].hidden,false);
  else assert.equal(nodes['preview-name'].value,'Jordan Rivera (fictional)');
 }
});
test('static preview bridges the mobile menu without loading the application',()=>{
 const menu={addEventListener(event,fn){assert.equal(event,'click');this.click=fn;}};
 let toggles=0;
 vm.runInNewContext(read(base+'preview.js'),{document:{querySelector:()=>menu,getElementById:()=>null},window:{toggleMainNavigation(){toggles++;}}});
 menu.click();assert.equal(toggles,1);
});
test('package is exactly seven byte-identical static files; refuses unsafe output',()=>{
 const temp=mkdtempSync(join(tmpdir(),'portal-preview-'));
 try{
  const out=join(temp,'out');execFileSync(process.execPath,['scripts/build-portal-support-preview.mjs',out]);
  const files=['index.html','preview.css','preview.js','request-support.html','styles.css','nav-v2.js','logo-wordmark.png'].sort();
  assert.deepEqual(readdirSync(out).sort(),files);
  for(const f of files) assert.deepEqual(readFileSync(join(out,f)),readFileSync(new URL('../'+(['index.html','preview.css','preview.js','request-support.html'].includes(f)?base:'')+f,import.meta.url)));
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-portal-support-preview.mjs',out],{stdio:'pipe'}));
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-portal-support-preview.mjs','docs/previews/unsafe'],{stdio:'pipe'}));
 }finally{rmSync(temp,{recursive:true,force:true});}
});
