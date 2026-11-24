import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewriteContent } from '../functions/_content.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sections=JSON.parse(read('content/page-sections.json')).items;
test('requested two paragraphs render separately and published override preserves paragraph boundaries',async()=>{
 const text=sections['home.journey'].paragraph.split('\n\n');assert.equal(text.length,2);
 const page=read('index.html');for(const paragraph of text)assert.ok(page.includes('<p>'+paragraph+'</p>'));
 for(const value of [sections['home.journey'].paragraph,'Legacy single paragraph']){
  const res=await rewriteContent(new Response('<div data-cs-list="home.journey.paragraph"><p>Fallback</p></div>'),{'home.journey':{paragraph:value}});
  const html=await res.text();assert.equal((html.match(/<p>/g)||[]).length,value.includes('\n\n')?2:1);assert.doesNotMatch(html,/Fallback|<p>[^<]*<p>/);
 }
});
test('exact requested support descriptions and Model sentence appear without changing hero heading',()=>{
 const page=read('index.html');
 for(const line of ["Activities and experiences that support caregivers&#39; mental, emotional, and physical well-being.",'Time to rest, recharge, and focus on yourself while your loved one is safely cared for.','Supportive spaces to connect with others, share experiences, and feel less alone.'])assert.ok(page.includes(line),line);
 assert.ok(read('our-model.html').includes('We recognize the emotional toll caregiving can take and create opportunities that support mental well-being, reduce isolation, and help caregivers reconnect with themselves.'));
 assert.ok(page.includes(sections['home.hero'].title));
});
