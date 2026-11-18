import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const old=read('tests/fixtures/retired-programs.html'), pe=read('programs-events.html'), sanctuary=read('sanctuary.html');
const form=(s,id)=>s.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))?.[0];
test('membership and Google Meet signup move without changing fields, validation or form routing',()=>{
 assert.equal(form(sanctuary,'membershipForm'),form(old,'membershipForm'));
 assert.equal(form(pe,'supportGroupInterestForm'),form(old,'supportGroupInterestForm'));
 assert.match(sanctuary,/id="membership"/);assert.match(sanctuary,/data-action="open-membership"/);
 assert.match(pe,/id="support-group"/);assert.match(pe,/meet.google.com\/dmc-orwi-afk/);
 const dates=s=>[...s.matchAll(/<li data-date="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(dates(pe),dates(old));
});
test('retirement has both HTTP spellings, browser fragment routing and no-JS membership fallback',()=>{
 assert.equal(existsSync(new URL('../programs.html',import.meta.url)),false);
 for(const path of ['/programs.html','/programs'])assert.ok(read('_redirects').includes(`${path} /programs-events.html 301`));
 assert.match(pe,/<aside id="membership"[\s\S]*?href="sanctuary.html#membership"/);
 const code=read('programs-compat.js');
 for(const hash of ['#membership','#support-group','#passport','']){
  const calls=[],handlers={};runInNewContext(code,{location:{hash,replace:v=>calls.push(v)},window:{addEventListener:(n,f)=>handlers[n]=f}});
  assert.deepEqual(calls,hash==='#membership'?['sanctuary.html#membership']:[]);assert.equal(typeof handlers.hashchange,'function');
 }
});
test('Dec9 exact guest/copy on dated session and dialog, selection-only behavior does not alter submit handler',()=>{
 const text='Join us for a discussion with an Estate Planning and Elder Law Attorney on key legal documents like Powers of Attorney, estate planning, and special needs trusts concerning Medicaid eligibility and long-term planning. Prepare for the future, protect yourself and loved ones, and participate in an interactive Q&amp;A session.';
 assert.equal(pe.split(text).length-1,2);
 for(const t of ['Wednesday, December 9 · 5–6 PM','Special Guest: Jennifer L. Lasky','Attorney, Partner, Shareholder','MWC Law Group'])assert.ok(pe.includes(t));
 assert.match(read('app.js'),/special.hidden = supportGroupSessionDate !== '2026-12-09'/);
});
test('all public inbound links avoid retired page and direct topics retain correct destinations',()=>{
 for(const file of readdirSync(new URL('../',import.meta.url)).filter(f=>f.endsWith('.html'))){const s=read(file);assert.doesNotMatch(s,/href="programs(?:\.html)?(?:#|\")/,file);assert.doesNotMatch(s,/id="(?:grantApplyForm|coachingInterestForm)"/,file);}
 for(const href of ['community-series.html','drop-in-respite.html','events.html','get-involved.html#partner'])assert.ok(pe.includes(`href="${href}"`));
 assert.doesNotMatch(pe,/partnership-form-preview/);
 assert.doesNotMatch(sanctuary.match(/<section id="membership">[\s\S]*?<\/section>/)[0],/Wellness Grants|Memory Socials/);
});
