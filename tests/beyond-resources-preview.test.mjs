import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const decode=s=>s.replace(/&#x27;|&#39;/g,"'").replace(/&amp;/g,'&');
const home=decode(read('index.html'));
test('revised problem statement and three steps are exact and precede all program descriptions',()=>{
 const exact=["Caregivers hear it all the time. Take a break. Ask for help. Join a support group. Make time for yourself.","But what happens when taking a break isn't that simple? When you don't have someone to stay with your loved one? Or when you're already so overwhelmed that figuring out where to start feels like another responsibility?","That's the gap we're working to close.","At Legacy, we don't just tell caregivers what resources are available. We help them access the support they need and provide many of those services ourselves, from respite and hands-on caregiver coaching to education, wellness opportunities, and ongoing connection.","And we believe what happens afterward matters. We stay connected, track participation, and work to understand whether that support is making a difference in caregivers' everyday lives.","Because finding help is one thing. Actually receiving it is another."];
 const section=home.match(/<section class="home-journey beyond-support"[\s\S]*?<\/section>/)[0];for(const s of exact)assert.ok(section.includes(s),s);
 for(const [h,p]of [['Identify the Need',"We listen to caregivers and understand the challenges they're facing."],['Provide the Support','We help caregivers access practical services and provide many of those services directly.'],['Measure the Difference','We track participation, follow up, and work to understand whether the support caregivers receive is helping.']])assert.ok(section.includes(`<h3>${h}</h3><p>${p}</p>`));
 assert.ok(home.indexOf('beyondSupportHeading')<home.indexOf('home-support-heading'));
 assert.ok(home.indexOf('home-support-heading')<home.indexOf('homeModelHeading'));assert.match(home,/<details class="container beyond-journey">/);
 assert.doesNotMatch(section,/href="[^"]*coaching|only organization|proven outcomes/);
});
test('draft reinforcement is distinct, bounded and does not replace the approved corporate card',()=>{
 const about=decode(read('about.html')),partner=decode(read('get-involved.html'));
 assert.ok(about.includes('We already track participation in our services and are strengthening how we understand caregiver outcomes; our new portal will help us build on that work.'));
 assert.ok(partner.includes('We provide many services directly, stay connected with caregivers, and track participation while strengthening how we understand outcomes.'));
 assert.equal((partner.match(/id="corporate"/g)||[]).length,1);assert.equal((partner.match(/involved-opportunities/g)||[]).length,3);
 assert.ok(home.includes('We recognize')===false);assert.ok(read('our-model.html').includes('We recognize the emotional toll caregiving can take'));
});
test('retired About JOIN US cannot be hydrated back from a stale published item',async()=>{
 const {rewriteContent}=await import('../functions/_content.mjs');const source=read('about.html');
 for(const file of ['about.html','templates/about.html.j2'])assert.doesNotMatch(read(file),/data-cs="about\.join\.|sections\["about.join"\]/);
 const response=await rewriteContent(new Response(source),{'about.join':{eyebrow:'RETIRED_JOIN_SENTINEL',heading:'RETIRED_HEADING_SENTINEL',body:'RETIRED_BODY_SENTINEL',cta_label:'RETIRED_BUTTON_SENTINEL'}});
 const rendered=await response.text();assert.equal(rendered,source);assert.doesNotMatch(rendered,/RETIRED_.*_SENTINEL/);
});
