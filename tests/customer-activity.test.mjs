import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { projectCustomerActivity, readCustomerActivity, customerActivity } from '../functions/_lib/customer-activity.mjs';
import { prepareCustomerActivity, withinDirectory } from '../scripts/prepare-customer-activity.mjs';
import { buildSite, selectSiteFiles } from '../scripts/build-site.mjs';
import { onRequestGet } from '../functions/api/staff/[[path]].js';

const digest = value => createHash('sha256').update(value).digest('hex');
const fixture = () => ({version:1,as_of:'2026-10-30T12:00:00Z',entries:[{
  selected:true,visibility:'legacy_staff',summary:'Fictional page wording update',requested_by:'Fictional Legacy staff',
  request_origin:'legacy_staff',executor:'xcentric_team',evidence_path:'/programs',
  milestones:{source:{state:'merged',at:'2026-10-30T11:00:00Z'},staging:{state:'available',at:'2026-10-30T11:30:00Z'},
    approval:{state:'pending',at:null},production:{state:'not_deployed',at:null}},
  private_provenance:{ticket:'PRIVATE-SENTINEL',request:'confidential fictional request',actor:'private@example.invalid'},
  internal_id:'internal-secret-id', github_url:'https://github.com/private/example',
}]});
const envelope = data => ({format:'customer_activity_projection_v1',reviewed_sha256:'a'.repeat(64),data});

test('explicit selection projects only safe fields and independently preserves origin, executor and milestones',()=>{
  const input=fixture();
  input.entries.push({...input.entries[0],selected:false}, {...input.entries[0],visibility:'internal'}, {summary:'unselected'});
  const out=projectCustomerActivity(input);
  assert.equal(out.entries.length,1);
  assert.deepEqual(Object.keys(out.entries[0]).sort(),['summary','requested_by','request_origin','executor','milestones','evidence_path'].sort());
  assert.equal(out.entries[0].request_origin,'legacy_staff');assert.equal(out.entries[0].executor,'xcentric_team');
  assert.equal(out.entries[0].milestones.production.state,'not_deployed');
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE-SENTINEL|confidential|private@example|internal-secret|github/);
  const row=fixture();delete row.entries[0].request_origin;
  assert.throws(()=>projectCustomerActivity(row)); // Never infer from author.
});

test('missing or unreviewed package defaults empty and imported private extras never enter response',()=>{
  assert.deepEqual(customerActivity(),{entries:[],as_of:null});
  for(const raw of [null,{},fixture(),{...envelope(fixture()),reviewed_sha256:''}]) assert.deepEqual(readCustomerActivity(raw),{entries:[],as_of:null});
  const projected=projectCustomerActivity(fixture());
  projected.entries[0].private_provenance='PRIVATE-SENTINEL';
  projected.entries[0].milestones.source.secret='PRIVATE-SENTINEL';
  assert.doesNotMatch(JSON.stringify(readCustomerActivity(envelope(projected))),/PRIVATE-SENTINEL|reviewed_sha256/);
});

test('unsafe links, malformed dates/states and unsupported attribution are refused',()=>{
  for(const path of ['https://example.invalid','//example.invalid','/%2f%2fexample.invalid','/programs?token=private','/programs#token','/../staff','/api','/api/staff/queue','/cdn-cgi','/cdn-cgi/access','/programs\\evil','/programs//evil','javascript:alert(1)']) {
    const input=fixture();input.entries[0].evidence_path=path;assert.throws(()=>projectCustomerActivity(input),path);
  }
  const patches=[x=>x.as_of='2026-02-30T12:00:00Z',x=>x.entries[0].executor='commit_author',
    x=>x.entries[0].milestones.source.state='done',x=>x.entries[0].milestones.production={state:'verified',at:null},
    x=>x.entries[0].milestones.approval={state:'approved',at:'2027-01-01T00:00:00Z'},
    x=>x.entries[0].summary='<script>fictional</script>',x=>x.entries[0].summary='x'.repeat(301)];
  for(const patch of patches){const input=fixture();patch(input);assert.throws(()=>projectCustomerActivity(input));}
});

test('existing assembly requires exact reviewed bytes, writes only projection and keeps static output clear',()=>{
  const root=mkdtempSync(join(tmpdir(),'fictional-customer-activity-'));
  try {
    const pkg=join(root,'package');mkdirSync(join(pkg,'functions/api/staff'),{recursive:true});mkdirSync(join(pkg,'functions/_lib'),{recursive:true});
    writeFileSync(join(pkg,'functions/api/staff/[[path]].js'),'// fictional package');
    const target=join(pkg,'functions/_lib/customer-activity-snapshot.mjs');writeFileSync(target,'export default null;');
    const inputPath=join(root,'private-fictional.json'), bytes=JSON.stringify(fixture());writeFileSync(inputPath,bytes);
    for(const reviewedSha256 of [undefined,'0'.repeat(64)]) assert.throws(()=>prepareCustomerActivity({inputPath,reviewedSha256,packageRoot:pkg}));
    assert.equal(readFileSync(target,'utf8'),'export default null;');
    writeFileSync(join(pkg,'.git'),'fictional worktree marker');
    assert.throws(()=>prepareCustomerActivity({inputPath,reviewedSha256:digest(bytes),packageRoot:pkg}));
    rmSync(join(pkg,'.git'));
    const receipt=prepareCustomerActivity({inputPath,reviewedSha256:digest(bytes),packageRoot:pkg});
    assert.equal(receipt.entries,1);assert.equal(receipt.reviewed_sha256,digest(bytes));
    const output=readFileSync(target,'utf8');assert.doesNotMatch(output,/PRIVATE-SENTINEL|private@example|github|internal-secret/);
    const module=JSON.parse(output.slice(output.indexOf('export default ')+15).trim().slice(0,-1));
    assert.equal(readCustomerActivity(module).entries[0].summary,'Fictional page wording update');
    writeFileSync(join(pkg,'staff.html'),'<html>fictional</html>');
    assert.deepEqual(buildSite(pkg,join(pkg,'dist')),['staff.html']);
    const changed=fixture();changed.entries[0].summary='Changed after review';writeFileSync(inputPath,JSON.stringify(changed));
    assert.throws(()=>prepareCustomerActivity({inputPath,reviewedSha256:digest(bytes),packageRoot:pkg}));
    assert.equal(readFileSync(target,'utf8'),output);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('private input anywhere inside package is refused before projection, including symlink aliases',()=>{
  const root=mkdtempSync(join(tmpdir(),'fictional-private-location-'));
  try {
    const pkg=join(root,'package'),outside=join(root,'private');
    mkdirSync(join(pkg,'functions/api/staff'),{recursive:true});mkdirSync(join(pkg,'functions/_lib'),{recursive:true});
    mkdirSync(join(pkg,'media'));mkdirSync(outside);
    writeFileSync(join(pkg,'functions/api/staff/[[path]].js'),'// fictional');
    const target=join(pkg,'functions/_lib/customer-activity-snapshot.mjs');writeFileSync(target,'export default null;');
    const bytes=JSON.stringify(fixture()),reviewedSha256=digest(bytes);
    const inside=join(pkg,'media','private-input.json');writeFileSync(inside,bytes);
    // This is the actual published-assets selector: JSON under media WOULD ship.
    assert.ok(selectSiteFiles(pkg).includes('media/private-input.json'));
    assert.throws(()=>prepareCustomerActivity({inputPath:inside,reviewedSha256,packageRoot:pkg}),/outside the entire package/);
    const alias=join(root,'outside-alias-to-package');symlinkSync(pkg,alias,'junction');
    assert.throws(()=>prepareCustomerActivity({inputPath:join(alias,'media/private-input.json'),reviewedSha256,packageRoot:pkg}),/outside the entire package/);
    writeFileSync(join(outside,'private-input.json'),bytes);
    const insideAlias=join(pkg,'private-alias');symlinkSync(outside,insideAlias,'junction');
    assert.throws(()=>prepareCustomerActivity({inputPath:join(insideAlias,'private-input.json'),reviewedSha256,packageRoot:pkg}),/outside the entire package/);
    assert.throws(()=>prepareCustomerActivity({inputPath:inside,reviewedSha256,packageRoot:alias}),/outside the entire package/);
    assert.equal(readFileSync(target,'utf8'),'export default null;');
    assert.equal(readFileSync(inside,'utf8'),bytes,'refusal does not delete or mutate retained input');
    // Remove only synthetic bad placement before proving the approved external route.
    rmSync(inside);rmSync(insideAlias);
    assert.equal(prepareCustomerActivity({inputPath:join(outside,'private-input.json'),reviewedSha256,packageRoot:pkg}).entries,1);
    assert.deepEqual(selectSiteFiles(pkg),[]);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('path boundary handles Windows case, drive and sibling prefixes without prefix confusion',()=>{
  assert.equal(withinDirectory('C:\\Build\\PACKAGE\\media\\input.json','c:\\build\\package','win32'),true);
  assert.equal(withinDirectory('C:\\Build\\package-other\\input.json','c:\\build\\package','win32'),false);
  assert.equal(withinDirectory('D:\\Build\\package\\input.json','c:\\build\\package','win32'),false);
  assert.equal(withinDirectory('\\\\SERVER\\Share\\Package\\media\\input.json','\\\\server\\share\\package','win32'),true);
  assert.equal(withinDirectory('/package-other/input.json','/package','linux'),false);
});

test('existing recent-changes API preserves original audit and adds empty safe projection/no-store',async()=>{
  const audit={id:7,actor:'fictional staff',action:'caregiver.update',entity:'caregiver',entity_id:'fictional',before_json:'{}',after_json:'{}',at:'2026-10-30 10:00:00'};
  const env={LEGACY_DB:{prepare:sql=>({all:async()=>({results:sql.includes('LIMIT 50')?[audit]:[]})})}};
  const response=await onRequestGet({env,request:new Request('https://fictional.invalid/api/staff/recent-changes')});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const result=await response.json();assert.deepEqual(result.changes,result.recent_changes);
  assert.equal(result.changes[0].id,7);assert.equal(result.changes[0].restorable,true);
  assert.deepEqual(result.release_activity,[]);assert.equal(result.release_activity_as_of,null);
});

test('existing panel separates customer notes from audit Undo, escapes text and rejects unsafe links',()=>{
  const js=readFileSync(new URL('../staff.js',import.meta.url),'utf8');
  const fn=js.slice(js.indexOf('function renderRecentChanges()'),js.indexOf('async function handleUndoChange'));
  const container={innerHTML:''}, note=projectCustomerActivity(fixture()).entries[0];
  note.summary='<img src=x onerror=alert(1)>';note.evidence_path='//evil.invalid';
  const context={document:{getElementById:()=>container},releaseActivity:[note],releaseActivityAsOf:'2026-10-30T12:00:00Z',
    recentChanges:[{id:7,actor:'fictional editor',action:'caregiver.update',entity:'caregiver',entity_id:'fictional',restorable:true}],
    escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
  vm.runInNewContext(fn+';renderRecentChanges();',context);
  assert.match(container.innerHTML,/Requested changes and releases/);assert.match(container.innerHTML,/Staff activity/);
  assert.match(container.innerHTML,/Legacy staff request/);assert.match(container.innerHTML,/X-Centric team/);
  assert.match(container.innerHTML,/Production: Not installed/);assert.doesNotMatch(container.innerHTML,/<img|href="\/\/evil/);
  assert.equal((container.innerHTML.match(/data-action="undo-change"/g)||[]).length,1);
  assert.match(container.innerHTML,/data-audit-id="7"/);
});
