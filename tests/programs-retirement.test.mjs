import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const old=read('tests/fixtures/retired-programs.html'), pe=read('programs-events.html'), sanctuary=read('sanctuary.html'), membership=read('membership.html');
const form=(s,id)=>s.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))?.[0];
test('membership and Google Meet signup move without changing fields, validation or form routing',()=>{
 assert.equal(form(membership,'membershipForm'),form(old,'membershipForm'));
 assert.equal(form(pe,'supportGroupInterestForm'),form(old,'supportGroupInterestForm'));
 assert.match(sanctuary,/id="membership"/);assert.match(membership,/data-action="open-membership"/);
 assert.match(pe,/id="support-group"/);assert.match(pe,/meet.google.com\/dmc-orwi-afk/);
 const dates=s=>[...s.matchAll(/<li data-date="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(dates(pe),dates(old));
});
test('retirement has both HTTP spellings, browser fragment routing and no-JS membership fallback',()=>{
 assert.equal(existsSync(new URL('../programs.html',import.meta.url)),false);
 for(const path of ['/programs.html','/programs'])assert.ok(read('_redirects').includes(`${path} /programs-events.html 301`));
 assert.match(pe,/<aside id="membership"[\s\S]*?href="membership.html"/);
 const code=read('programs-compat.js');
 for(const hash of ['#membership','#support-group','#passport','']){
  const calls=[],handlers={};runInNewContext(code,{location:{hash,replace:v=>calls.push(v)},window:{addEventListener:(n,f)=>handlers[n]=f}});
  assert.deepEqual(calls,hash==='#membership'?['membership.html']:[]);assert.equal(typeof handlers.hashchange,'function');
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
test('revised support section stacks exact intro before sessions without duplicate panel heading',()=>{
 const section=pe.match(/<section class="section-sand" id="support-group">[\s\S]*?<\/section>/)[0];
 const parts=['VIRTUAL SUPPORT GROUP','Virtual Caregiver Support Group','Connect with other caregivers who understand the journey. Our weekly virtual support group offers a welcoming space to share experiences, find encouragement, and receive support from others navigating caregiving.','id="supportGroupSessions"'];
 const positions=parts.map(s=>section.indexOf(s));assert.ok(positions.every(n=>n>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));assert.doesNotMatch(section,/class="split"|<h3[^>]*>Virtual Support Group/);
});
test('dedicated Membership has five supplied sections, four benefit cards, authentic gallery and candid profile hold',()=>{
 assert.equal((membership.match(/<section class="(?:hero )?membership-section/g)||[]).length,5);
 for(const text of ['More than a membership. A community that feels like family.','More than support. A sense of family.',"What You'll Find Inside the Sanctuary","Your Story Matters. You Shouldn't Have to Keep Repeating It.","There's a Place for You Here."])assert.ok(membership.includes(text));
 assert.equal((membership.match(/<article class="card">/g)||[]).length,4);
 assert.match(membership,/data-copy-status="awaiting-confirmation"/);assert.match(membership,/personal caregiver profile is not available yet/);
 assert.match(membership,/href="portal.html">Create Your Free Account/);assert.equal((membership.match(/data-action="open-membership"/g)||[]).length,2);
 assert.match(membership,/media\/gallery\/shoot-238.jpg/);assert.ok(read('content/gallery.json').includes('media/gallery/shoot-238.jpg'));
 assert.match(membership,/Opportunities depend on program availability and caregiver needs/);
 assert.doesNotMatch(membership,/<table|Membership includes/);
 assert.match(sanctuary,/<script src="programs-compat.js"><\/script>/);assert.match(sanctuary,/id="membership"[\s\S]*?href="membership.html"/);
});
test('faith card is inside existing partner category and original Drop-In section is preserved',()=>{
 const involved=read('get-involved.html');assert.equal((involved.match(/involved-opportunities/g)||[]).length,3);
 const partner=involved.slice(involved.indexOf('id="partner-with-legacy"'),involved.indexOf('id="give-back"'));
 assert.match(partner,/id="faith-community"/);assert.match(partner,/href="about.html#contact">Interested in Bringing Respite to Your Faith Community/);
 assert.match(read('drop-in-respite.html'),/id="faith-community"/);assert.doesNotMatch(involved,/partnership-form-preview/);
});
