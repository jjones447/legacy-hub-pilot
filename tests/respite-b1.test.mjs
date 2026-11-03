// Fictional SQLite + real handlers, no remote DB/runtime/provider. pc1-codex-5.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { onRequestGet as publicGet, onRequestPost as publicPost } from '../functions/api/respite.js';
import { onRequestGet as staffGet, onRequestPost as staffPost } from '../functions/api/staff/respite.js';
import { ACK_VERSION, ACK_COPY, FIELDS, validateApplication } from '../functions/_lib/respite-b1.mjs';
import { setVerifiedAccessStaffActor } from '../functions/_lib/agent-confirmation.mjs';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as attendance } from '../functions/api/registrations.js';
const origin = 'https://fixture.example.invalid', actor = 'reviewer@example.invalid';
let raw, db, env, beforeBatch, afterCommit;
beforeEach(() => {
  raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_init.sql','0011_staff_member.sql','candidates/0019_respite_pending_review.sql']) {
    raw.exec(readFileSync(new URL('../schema/' + file, import.meta.url), 'utf8'));
  }
  raw.exec("INSERT INTO caregiver(id,first_name,email) VALUES('cg_fixture','Fictional','same@example.invalid')");
  raw.exec("INSERT INTO event(id,title,type,starts_at,publish_state,capacity,respite_review_required) VALUES('ev_fixture','Fictional respite','other','2099-11-19 10:00','published',1,1),('ev_ordinary','Ordinary','other','2099-11-19 10:00','published',10,0)");
  raw.prepare('INSERT INTO staff_member(email) VALUES(?)').run(actor);
  beforeBatch = null; afterCommit = null;
  db = { prepare(sql) {
    const bound = params => ({ sql, params,
      async first() { return raw.prepare(sql).get(...params) ?? null; },
      async all() { return { success: true, results: raw.prepare(sql).all(...params) }; },
      async run() { const result = raw.prepare(sql).run(...params); return { success: true, meta: { changes: result.changes } }; },
    });
    return { ...bound([]), bind: (...params) => bound(params) };
  }, async batch(items) {
    if (beforeBatch) { const action = beforeBatch; beforeBatch = null; action(); }
    raw.exec('BEGIN IMMEDIATE');
    let results;
    try {
      results = items.map(({sql,params}) => ({ success: true, results: raw.prepare(sql).all(...params), meta: { changes: raw.prepare('SELECT changes() n').get().n } }));
      raw.exec('COMMIT');
    } catch (error) { raw.exec('ROLLBACK'); throw error; }
    if (afterCommit) { const action = afterCommit; afterCommit = null; action(); }
    return results;
  } };
  env = { LEGACY_DB: db, ENVIRONMENT: 'preview', RESPITE_B1_COLLECTION: ACK_VERSION,
    RESPITE_B1_REVIEWERS: JSON.stringify([actor]) };
});
afterEach(() => raw.close());
function payload(extra = {}) {
  return { ...Object.fromEntries(Object.keys(FIELDS).map(key => [key, 'Fictional'])),
    age: '', personal_care_detail: '', safety: '', comfort: '',
    request_id: randomUUID(), event_id: 'ev_fixture', contact_email: 'same@example.invalid',
    contact_phone: '555-010-0101', emergency_phone: '555-010-0102', first_time: true,
    personal_care_help: false, medication_help: false, caregiver_onsite: false,
    privacy_ack: true, nonmedical_ack: true, ack_version: ACK_VERSION, ...extra };
}
function request(path, body, headers = {}) {
  return new Request(origin + path, { method: body ? 'POST' : 'GET',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
const submit = (body, headers) => publicPost({ env, request: request('/api/respite', body, headers) });
function staffContext(body, query = '', who = actor) {
  const data = {}; if (who) setVerifiedAccessStaffActor(data, who);
  return { env, data, request: request('/api/staff/respite' + query, body) };
}
function row() { return raw.prepare('SELECT * FROM respite_application ORDER BY created_at,id LIMIT 1').get(); }
const count = table => raw.prepare('SELECT COUNT(*) n FROM ' + table).get().n;
async function action(name, extra = {}, selected = row()) {
  return staffPost(staffContext({ id: selected.id, revision: selected.revision, action: name, ...extra }));
}
async function createReady(extra = {}) {
  assert.equal((await submit(payload(extra))).status, 202);
  assert.equal((await action('resolve_identity', { caregiver_id: 'cg_fixture', identity_verified: true })).status, 200);
  assert.equal((await action('complete_followup')).status, 200);
}
test('default OFF, production, missing reviewer policy and absent schema do not collect', async () => {
  for (const patch of [{ RESPITE_B1_COLLECTION: undefined },{ENVIRONMENT:'production'},{RESPITE_B1_REVIEWERS:'[]'},
    {RESPITE_B1_REVIEWERS:'not-json'}, {RESPITE_B1_REVIEWERS:'["Mixed@EXAMPLE.invalid"]'}]) {
    const res = await publicPost({env:{...env,...patch},request:request('/api/respite',payload())});
    assert.equal(res.status,404); assert.equal(count('respite_application'),0);
  }
  raw.exec('DROP TABLE respite_application_private');
  assert.equal((await submit(payload())).status,503);
  assert.equal(count('respite_application'),0);
});
test('public config has only eligible session metadata, no private data or profiles', async () => {
  const res = await publicGet({env}); assert.equal(res.headers.get('Cache-Control'),'no-store');
  const body = await res.json(); assert.deepEqual(body.acknowledgments,ACK_COPY);
  assert.deepEqual(body.sessions.map(x=>x.id),['ev_fixture']);
  assert.doesNotMatch(JSON.stringify(body),/same@example|caregiver_id|snapshot_json/);
});
test('partially installed candidate without producer guard cannot collect or review', async () => {
  raw.exec('DROP TRIGGER respite_registration_insert');
  assert.equal((await submit(payload())).status,404);
  assert.equal((await staffGet(staffContext(undefined,'?event_id=ev_fixture'))).status,404);
  assert.equal(count('respite_application'),0);
});
test('strict independent acknowledgments, booleans, schema/field whitelist and bounded UTF8 body', async () => {
  for (const patch of [{privacy_ack:false},{privacy_ack:'true'},{nonmedical_ack:false},{ack_version:'unknown'},
    {caregiver_id:'cg_fixture'},{first_time:'yes'},{age:'one'},{event_id:true},{contact_phone:'x'},
    {participant_name:'x'.repeat(121)},{personal_care_help:true,personal_care_detail:''}]) {
    assert.equal(validateApplication(payload(patch)),null);
    assert.equal((await submit(payload(patch))).status,400);
  }
  assert.equal((await publicPost({env,request:new Request(origin+'/api/respite',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:' '.repeat(12001)})})).status,400);
  assert.equal((await submit(payload(),{Origin:'https://foreign.example.invalid'})).status,403);
  assert.equal((await submit(payload(),{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal(count('respite_application'),0);
});
test('anonymous exact email/phone matches never link, read, modify or create caregiver', async () => {
  const caregiver = raw.prepare('SELECT * FROM caregiver').get();
  const p = payload(); const res = await submit(p); assert.equal(res.status,202);
  const stored = row(); assert.equal(stored.caregiver_id,null); assert.equal(stored.identity_basis,'unresolved');
  assert.equal(stored.status,'pending'); assert.equal(count('registration'),0); assert.equal(count('followup'),0);
  assert.deepEqual(raw.prepare('SELECT * FROM caregiver').get(),caregiver);
  assert.equal(count('caregiver'),1); assert.equal(stored.privacy_version,ACK_VERSION); assert.ok(stored.acknowledged_at);
  assert.doesNotMatch(JSON.stringify(await res.json()),/same@example|Fictional|caregiver_id|ra_/);
  assert.doesNotMatch(JSON.stringify(raw.prepare('SELECT * FROM audit_log').all()),/same@example|Fictional|snapshot_json/);
});
test('exact retry/lost acknowledgment are idempotent; changed payload never replaces snapshot', async () => {
  const p = payload(); afterCommit = ()=>{throw Error('unknown committed outcome');};
  assert.equal((await submit(p)).status,503); assert.equal(count('respite_application'),1);
  assert.equal((await submit(p)).status,202); assert.equal(count('respite_application_private'),1);
  assert.equal((await submit({...p,participant_name:'Changed'})).status,409);
  assert.equal(JSON.parse(raw.prepare('SELECT snapshot_json FROM respite_application_private').get().snapshot_json).participant_name,'Fictional');
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='respite.pending'").get().n,1);
});
test('staff fail closed for plain JSON, unlisted, deactivated and service actors', async () => {
  await submit(payload());
  for (const who of [null,'foreign@example.invalid','service:robot@example.invalid']) {
    const ctx = staffContext(undefined,'?event_id=ev_fixture',who); ctx.data.actor = actor;
    assert.equal((await staffGet(ctx)).status,403);
  }
  raw.prepare("UPDATE staff_member SET status='deactivated' WHERE email=?").run(actor);
  assert.equal((await staffGet(staffContext(undefined,'?id='+row().id))).status,403);
});
test('Access middleware guards staff route, dev bypass cannot mint reviewer capability', async () => {
  const req=request('/api/staff/respite?event_id=ev_fixture');
  assert.equal((await middleware({request:req,env:{},next:()=>{throw Error('must not enter');}})).status,403);
  assert.equal((await middleware({request:req,env:{...env,ALLOW_DEV_CONSOLE:'1'},next:()=>staffGet({request:req,env,data:{}})})).status,403);
});
test('staff summaries omit private answers; private detail is separate, no-store and explicitly gated', async () => {
  await submit(payload({safety:'Fictional private safety detail'}));
  const summary = await staffGet(staffContext(undefined,'?event_id=ev_fixture'));
  assert.equal(summary.status,200); assert.doesNotMatch(JSON.stringify(await summary.json()),/Fictional|same@example|safety/);
  const detail=await staffGet(staffContext(undefined,'?id='+row().id));
  assert.equal(detail.headers.get('Cache-Control'),'no-store'); assert.equal((await detail.json()).details.safety,'Fictional private safety detail');
});
test('first-time requires explicit identity verification and completed followup before staffed confirmation', async () => {
  await submit(payload()); assert.equal((await action('confirm')).status,409);
  assert.equal((await action('resolve_identity',{caregiver_id:'cg_fixture'})).status,400);
  assert.equal((await action('resolve_identity',{caregiver_id:'cg_fixture',identity_verified:true})).status,200);
  assert.equal((await action('confirm')).status,409);
  assert.equal((await action('complete_followup')).status,200);
  const stale=row(); assert.equal((await action('confirm')).status,200);
  assert.equal(row().status,'confirmed'); assert.ok(row().registration_id); assert.equal(count('registration'),1);
  assert.equal((await action('confirm',{},stale)).status,409); assert.equal(count('registration'),1);
  const attended = await attendance({env,request:request('/api/registrations',{id:row().registration_id,status:'attended'})});
  assert.equal(attended.status,200); assert.equal(raw.prepare('SELECT status FROM registration').get().status,'attended');
});
test('decline is final and never creates registration', async () => {
  await submit(payload()); assert.equal((await action('decline')).status,200);
  assert.equal(row().status,'declined'); assert.equal(count('registration'),0); assert.equal((await action('confirm')).status,409);
});
test('returning participant can confirm after verification without first-time followup', async () => {
  await submit(payload({first_time:false}));
  await action('resolve_identity',{caregiver_id:'cg_fixture',identity_verified:true});
  assert.equal((await action('confirm')).status,200); assert.equal(row().followup_at,null);
});
for (const [name, drift] of [
  ['reviewer deactivation',()=>raw.prepare("UPDATE staff_member SET status='deactivated' WHERE email=?").run(actor)],
  ['caregiver archive',()=>raw.exec("UPDATE caregiver SET status='archived'")],
  ['event archive',()=>raw.exec("UPDATE event SET publish_state='archived' WHERE id='ev_fixture'")],
  ['stale revision',()=>raw.exec('UPDATE respite_application SET revision=revision+1')],
  ['capacity fill',()=>raw.exec("UPDATE event SET capacity=0 WHERE id='ev_fixture'")],
  ['audit failure',()=>raw.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'fixture failure'); END")],
]) test('atomic confirm refuses '+name+' drift with no partial state or audit', async () => {
  await createReady(); const before=count('audit_log'); beforeBatch=drift;
  assert.equal((await action('confirm')).status,409);
  assert.equal(row().status,'pending'); assert.equal(count('registration'),0); assert.equal(count('audit_log'),before);
});
test('two pending applications competing for one place: second whole batch rolls back', async () => {
  await createReady(); const first=row(); assert.equal((await action('confirm')).status,200);
  await submit(payload({first_time:false})); const second=raw.prepare("SELECT * FROM respite_application WHERE status='pending'").get();
  await action('resolve_identity',{caregiver_id:'cg_fixture',identity_verified:true},second);
  const current=raw.prepare('SELECT * FROM respite_application WHERE id=?').get(second.id);
  assert.equal((await action('confirm',{},current)).status,409); assert.equal(count('registration'),1);
  assert.equal(raw.prepare('SELECT status FROM respite_application WHERE id=?').get(second.id).status,'pending');
  assert.equal(first.caregiver_id,'cg_fixture');
});
test('ordinary intake cannot spoof reserved source or bypass pending review; rollback preserves profile', async () => {
  const p={kind:'event_registration',first_name:'Fictional',email:'same@example.invalid',external_ref:randomUUID(),event_id:'ev_fixture'};
  assert.equal((await handleIntake(db,{...p,source:'respite_b1_v1'})).status,400);
  const before=raw.prepare('SELECT * FROM caregiver').get();
  await assert.rejects(handleIntake(db,p),/respite staffed review required/);
  assert.deepEqual(raw.prepare('SELECT * FROM caregiver').get(),before); assert.equal(count('registration'),0); assert.equal(count('followup'),0);
  assert.equal((await handleIntake(db,{...p,event_id:'ev_ordinary'})).status,201);
});
test('provider-shaped atomic batches cannot partially update caregiver/payment result for marked event', async () => {
  for (const source of ['square','givebutter','staff']) {
    const before=raw.prepare('SELECT * FROM caregiver').get();
    await assert.rejects(db.batch([
      db.prepare("UPDATE caregiver SET first_name='Changed' WHERE id='cg_fixture'"),
      db.prepare("INSERT INTO registration(caregiver_id,event_id,source,external_ref) VALUES('cg_fixture','ev_fixture',?,?)").bind(source,randomUUID()),
    ]),/respite staffed review required/);
    assert.deepEqual(raw.prepare('SELECT * FROM caregiver').get(),before); assert.equal(count('registration'),0);
  }
});
test('private snapshot, event identity and confirmed registration reparent are immutable', async () => {
  await createReady(); await action('confirm');
  assert.throws(()=>raw.exec("UPDATE respite_application_private SET snapshot_json='{}'"),/immutable/);
  assert.throws(()=>raw.exec("UPDATE respite_application SET event_id='ev_ordinary'"),/immutable/);
  assert.throws(()=>raw.exec("UPDATE registration SET event_id='ev_ordinary'"),/identity locked/);
  assert.throws(()=>raw.exec('UPDATE respite_application SET registration_id=NULL'),/link locked/);
  assert.throws(()=>raw.exec('DELETE FROM registration'),/retained/);
  assert.throws(()=>raw.exec("UPDATE event SET respite_review_required=0 WHERE id='ev_fixture'"),/reconciliation/);
});
