import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../functions/api/agent/[[path]].js';
import { setVerifiedPublisher, publisherActor, isPublisherPayload, publisherRouteAllowed } from '../functions/_lib/publisher-identity.mjs';
import { confirmationActor } from '../functions/_lib/agent-confirmation.mjs';
import { PUBLISHER_APPROVALS } from '../functions/_lib/publisher-approvals.mjs';
const entry = PUBLISHER_APPROVALS[0];
function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8'));
  raw.exec('ALTER TABLE content_item ADD COLUMN draft_of TEXT');
  raw.prepare('INSERT INTO content_type VALUES (?,?)').run('page_section', '{}');
  raw.prepare('INSERT INTO content_item(id,type_id,data,status,updated_by) VALUES (?,?,?,?,?)')
    .run(entry.target_id, 'page_section', JSON.stringify({ heading: 'Keep this', paragraph: 'Old' }), 'published', 'prior');
  let beforeBatch = () => {};
  const wrap = (sql, params = []) => ({ sql, params, bind: (...p) => wrap(sql, p),
    first: async () => raw.prepare(sql).get(...params) ?? null,
    run: async () => raw.prepare(sql).run(...params),
  });
  const db = { prepare: sql => wrap(sql), async batch(statements) {
    beforeBatch(); raw.exec('BEGIN');
    try { for (const s of statements) raw.prepare(s.sql).run(...s.params); raw.exec('COMMIT'); }
    catch(e) { raw.exec('ROLLBACK'); throw e; }
  } };
  const data = {}; setVerifiedPublisher(data, true);
  const call = (action, body, options = {}) => onRequestPost({
    request: new Request((options.origin || 'https://preview.invalid')+'/api/agent/publisher/'+action, {
      method: 'POST', headers: { 'content-type':'application/json', ...options.headers }, body: JSON.stringify(body),
    }), env: { LEGACY_DB: db }, data: options.data || data,
  });
  const draft = async () => (await (await call('draft', {approval_ref:entry.approval_ref,target_id:entry.target_id,changes:entry.changes})).json()).draft_id;
  const preview = async id => (await (await call('preview', { draft_id:id, approval_ref:entry.approval_ref })).json()).preview_version;
  return { raw, call, draft, preview, setBeforeBatch: fn => { beforeBatch = fn; } };
}
test('publisher is a distinct server capability and only the pinned service payload qualifies', () => {
  const data = { actor:'service:legacy-publisher', publisher:true };
  assert.equal(publisherActor(data), null);
  setVerifiedPublisher(data, true); assert.equal(confirmationActor(data), null);
  assert.equal(publisherActor(data), 'service:legacy-publisher');
  for (const [payload, env] of [
    [{ common_name:'wrong' }, { LEGACY_PUBLISHER_CLIENT_ID:'pinned' }],
    [{ common_name:'pinned', email:'human@example.invalid' }, { LEGACY_PUBLISHER_CLIENT_ID:'pinned' }],
    [{ common_name:'pinned' }, {}], [{ sub:'pinned' }, { LEGACY_PUBLISHER_CLIENT_ID:'pinned' }],
  ]) assert.equal(isPublisherPayload(payload,env),false);
  assert.equal(isPublisherPayload({common_name:'pinned'},{LEGACY_PUBLISHER_CLIENT_ID:'pinned'}),true);
});
test('publisher transport fence denies workflow/assistant/direct/production People and all People writes', () => {
  for (const [method,path,env] of [
    ['POST','/api/agent/confirm',{}], ['POST','/api/agent/converse',{}],
    ['POST','/api/agent/caregiver/confirm',{}], ['POST','/api/staff/caregivers',{ENVIRONMENT:'preview'}],
    ['GET','/api/staff/caregivers',{}], ['GET','/api/staff/subscribers',{ENVIRONMENT:'preview'}],
    ['GET','/api/agent/publisher/confirm',{}], ['POST','/api/agent/publisher/confirm/extra',{}],
  ]) assert.equal(publisherRouteAllowed(new Request('https://test.invalid'+path,{method}),env),false);
  assert.equal(publisherRouteAllowed(new Request('https://test.invalid/api/staff/caregivers'),{ENVIRONMENT:'preview'}),true);
});
test('draft, explicit preview, same-version confirmation preserve unrelated fields and original rollback audit', async () => {
  const f=fixture(), id=await f.draft(), version=await f.preview(id);
  assert.equal(typeof version,'string');
  const r=await f.call('confirm',{draft_id:id,preview_version:version,approval_ref:entry.approval_ref});
  assert.equal(r.status,200);
  const target=f.raw.prepare('SELECT * FROM content_item WHERE id=?').get(entry.target_id);
  assert.deepEqual(JSON.parse(target.data),{heading:'Keep this',...entry.changes});
  const audit=f.raw.prepare('SELECT * FROM audit_log').get();
  assert.equal(audit.actor,'service:legacy-publisher');
  assert.equal(JSON.parse(audit.before_json).data.paragraph,'Old');
  assert.equal(JSON.parse(audit.after_json).approval_ref,entry.approval_ref);
  assert.equal(f.raw.prepare('SELECT status FROM content_item WHERE id=?').get(id).status,'archived');
  assert.equal((await f.call('confirm',{draft_id:id,preview_version:version,approval_ref:entry.approval_ref})).status,409);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n,1);
});
for(const mutation of ['missing-ref','invented-ref','wrong-target','changed-copy','actor','thread_id']) {
  test('draft refuses '+mutation+' before a write',async()=>{
    const f=fixture(), body=structuredClone(entry); delete body.type_id;
    if(mutation==='missing-ref') delete body.approval_ref;
    if(mutation==='invented-ref') body.approval_ref='tracker:made-up';
    if(mutation==='wrong-target') body.target_id='ps_other';
    if(mutation==='changed-copy') body.changes.paragraph='Unapproved';
    if(['actor','thread_id'].includes(mutation)) body[mutation]='forged';
    assert.ok((await f.call('draft',body)).status>=400);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM content_item WHERE status='draft'").get().n,0);
  });
}
for(const mutation of ['no-proof','json-proof','wrong-ref','missing-version','wrong-version','cross-origin','target-drift','draft-drift','owner-drift','audit-failure','batch-drift']) {
  test('confirm fails closed and preserves target/audit on '+mutation,async()=>{
    const f=fixture(), id=await f.draft(), version=await f.preview(id);
    const body={draft_id:id,preview_version:version,approval_ref:entry.approval_ref}, options={};
    if(mutation==='no-proof') options.data={};
    if(mutation==='json-proof') options.data={publisher:true,actor:'service:legacy-publisher'};
    if(mutation==='wrong-ref') body.approval_ref='tracker:other';
    if(mutation==='missing-version') delete body.preview_version;
    if(mutation==='wrong-version') body.preview_version='0'.repeat(64);
    if(mutation==='cross-origin') options.origin='https://other.invalid';
    if(mutation==='target-drift') f.raw.prepare("UPDATE content_item SET updated_by='intervening' WHERE id=?").run(entry.target_id);
    if(mutation==='draft-drift') f.raw.prepare("UPDATE content_item SET data='{}' WHERE id=?").run(id);
    if(mutation==='owner-drift') f.raw.prepare("UPDATE content_item SET updated_by='access_staff:human@example.invalid' WHERE id=?").run(id);
    if(mutation==='audit-failure') f.raw.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    if(mutation==='batch-drift') f.setBeforeBatch(()=>f.raw.prepare("UPDATE content_item SET updated_by='concurrent' WHERE id=?").run(entry.target_id));
    assert.ok((await f.call('confirm',body,options)).status>=400);
    assert.equal(JSON.parse(f.raw.prepare('SELECT data FROM content_item WHERE id=?').get(entry.target_id).data).paragraph,'Old');
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n,0);
  });
}
test('in-product human/service/dev proof cannot confirm publisher draft',async()=>{
  const f=fixture(),id=await f.draft(),version=await f.preview(id);
  const r=await f.call('confirm',{draft_id:id,preview_version:version,approval_ref:entry.approval_ref},{data:{actor:'human@example.invalid'}});
  assert.equal(r.status,403);
});
