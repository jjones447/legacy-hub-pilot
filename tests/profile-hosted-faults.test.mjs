// Causal LOCAL SQLite tests of unchanged handler + durable fault adapter.
// No Cloudflare, provider credentials, browser, mail, native or customer claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/caregiver-profile-fixture.mjs';
import { saveCaregiverProfile } from '../functions/_lib/caregiver-profile.js';
import { onRequestPost } from '../functions/api/portal/[[path]].js';
import { createHostedProfileFixture } from './runtime/profile-hosted-boundary.mjs';
import { createProfileFaultDb, recoverProfileFault, profileFaultWitness, caregiverDigest, LEDGER_SQL, AUDIT_TRIGGER_SQL, TRIGGER_NAME } from './runtime/profile-hosted-faults.mjs';
const A = 'profile_ct13_20261121_a_571d390c', B = 'profile_ct13_20261121_b_82e4a90f';
const ORIGIN = 'https://profile-fixture-unit.legacy-hub-5qo.pages.dev', SECRET = 'a'.repeat(64);
async function setup(t, scenario = 'archive', owner = A, hooks = {}) {
  const f = fixture(); t.after(() => f.close());
  f.raw.exec(`DELETE FROM caregiver; ${LEDGER_SQL}`);
  f.raw.prepare('INSERT INTO caregiver(id,first_name,email,status) VALUES (?,?,?,?)').run(owner,'Fictional','fictional@example.invalid','active');
  const revision = owner === A ? 4 : 0;
  if (revision) f.raw.prepare('INSERT INTO caregiver_profile(caregiver_id,revision,fields_json,restricted_json) VALUES (?,?,?,?)').run(owner,4,JSON.stringify({zip:'53202',contact_requested:'No'}),'{}');
  let productBatches = 0, batches = 0;
  const db = {
    prepare(sql) {
      const statement = (args = []) => ({
        bind: (...values) => statement(values),
        async first() { return f.raw.prepare(sql).get(...args) ?? null; },
        async all() { return { success: true, results: f.raw.prepare(sql).all(...args) }; },
        async run() {
          await hooks.beforeRun?.(sql, f.raw);
          const result = { success: true, meta: f.raw.prepare(sql).run(...args) };
          await hooks.afterRun?.(sql, f.raw);
          return result;
        },
        _sql: sql,
      }); return statement();
    },
    async batch(statements) {
      const type = statements.some(s=>s._sql.startsWith('CREATE TRIGGER')) ? 'create'
        : statements.some(s=>s._sql.startsWith('DROP TRIGGER')) ? 'drop'
        : statements[0]._sql.startsWith("UPDATE caregiver SET status = 'archived'") ? 'archive'
        : statements[0]._sql.startsWith('UPDATE caregiver SET status = ?') ? 'restore' : 'product';
      batches++; if (type === 'product') productBatches++;
      await hooks.beforeBatch?.(type, f.raw);
      f.raw.exec('BEGIN');let results=[];
      try { for (const s of statements) results.push(await s.run()); f.raw.exec('COMMIT'); }
      catch (error) { f.raw.exec('ROLLBACK'); throw error; }
      await hooks.afterBatch?.(type, f.raw);
      return results;
    },
  };
  const before = await profileFaultWitness(db, owner);
  const plan = { id: `profile_fault_20261121_${scenario}_${owner === A ? 'a' : 'b'}`, owner, revision, scenario,
    caregiverHash: await caregiverDigest(before.caregiver), witnessHash: await caregiverDigest(before) };
  const wrapped = createProfileFaultDb(db, plan);
  const now = Date.now();
  const boundary = createHostedProfileFixture({ manifest: { origin: ORIGIN, startsAt: now - 1000, expiresAt: now + 600000,
    owners: [A,B,'profile_ct13_20261121_archived_614ab108'] }, get: () => new Response(),
    post: context => onRequestPost({...context,env:{...context.env,LEGACY_DB:wrapped}}) });
  async function call({id=owner,signature,revision:rev=revision,fields={contact_requested:'Yes'},origin=ORIGIN,query=''}={}) {
    const payload = `${id}:${Date.now()+120000}`;
    const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sig = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('session:'+payload))).toString('hex');
    const request = new Request(ORIGIN+'/api/portal/profile'+query,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'portal_session='+encodeURIComponent(payload+':'+(signature??sig))},body:JSON.stringify({revision:rev,fields})});
    return boundary.fetch(request,{ENVIRONMENT:'preview',PROFILE_FIXTURE_SECRET:SECRET,LEGACY_DB:db});
  }
  return {...f,db,plan,before,call, counts:()=>({productBatches,batches}), row:()=>f.raw.prepare('SELECT * FROM profile_qualification_operation').get(), witness:()=>profileFaultWitness(db,owner)};
}
for (const owner of [A,B]) test(`archive at batch boundary prevents ${owner === A ? 'update' : 'initial insert'}, restores full caregiver, and is durably one-use`,async t=>{
  const f=await setup(t,'archive',owner);
  const r=await f.call();assert.equal(r.status,409);assert.deepEqual(await r.json(),{ok:false,error:'profile_conflict'});
  assert.deepEqual(await f.witness(),f.before);assert.equal(f.row().phase,'cleaned');assert.equal(f.row().outcome,'NO_WRITE_ACKNOWLEDGED');
  assert.equal(f.counts().productBatches,1);
  assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,1);
  assert.deepEqual(await recoverProfileFault(f.db,f.plan),{phase:'cleaned',originalOperation:'NO_WRITE_ACKNOWLEDGED'});
});
test('audit failure rolls back Profile/contact followup, strips diagnostics and removes exact trigger',async t=>{
  const f=await setup(t,'audit');const r=await f.call();assert.equal(r.status,500);
  assert.deepEqual(await r.json(),{ok:false,error:'internal_error'});assert.deepEqual(await f.witness(),f.before);
  assert.equal(f.row().phase,'cleaned');assert.equal(f.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(TRIGGER_NAME),undefined);
  assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,1);
});
for(const fault of ['create','archive']) test(`${fault} lost acknowledgement cleans owned effect without dispatching or retrying product`,async t=>{
  let once=true;const f=await setup(t,fault==='create'?'audit':'archive',A,{afterBatch(type){if(type===fault&&once){once=false;throw Error('lost ack');}}});
  assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,0);assert.equal(f.row().phase,'cleaned');
  assert.deepEqual(await f.witness(),f.before);assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,0);
});
for(const cleanup of ['drop','restore']) test(`${cleanup} committed unknown acknowledgement is read back, not blindly retried`,async t=>{
  let count=0;const f=await setup(t,cleanup==='drop'?'audit':'archive',A,{afterBatch(type){if(type===cleanup){count++;throw Error('lost cleanup ack');}}});
  const r=await f.call();assert.equal(r.status,cleanup==='drop'?500:409);assert.equal(count,1);assert.equal(f.row().phase,'cleaned');assert.deepEqual(await f.witness(),f.before);
});
test('unknown claim spends operation without injection; reconstructed adapter cannot resume it',async t=>{
  let once=true;const f=await setup(t,'archive',A,{afterRun(sql){if(sql.includes('INSERT INTO profile_qualification_operation')&&once){once=false;throw Error('lost claim ack');}}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'claimed');assert.equal(f.counts().batches,0);
  assert.equal((await f.call()).status,500);assert.equal(f.counts().batches,0);
  assert.deepEqual(await recoverProfileFault(f.db,f.plan),{phase:'claimed',originalOperation:'UNKNOWN_NO_REPLAY'});
});
test('pre-existing same-name different trigger is untouched and blocks claim',async t=>{
  const f=await setup(t,'audit');f.raw.exec(`CREATE TRIGGER ${TRIGGER_NAME} BEFORE INSERT ON audit_log BEGIN SELECT 1; END`);
  const before=f.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(TRIGGER_NAME).sql;
  assert.equal((await f.call()).status,500);assert.equal(f.row(),undefined);assert.equal(f.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(TRIGGER_NAME).sql,before);
});
test('changed trigger definition refuses cleanup, leaves durable injected state and blocks replay',async t=>{
  const f=await setup(t,'audit',A,{beforeBatch(type,raw){if(type==='product'){raw.exec(`DROP TRIGGER ${TRIGGER_NAME}; CREATE TRIGGER ${TRIGGER_NAME} BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'other'); END`);}}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'injected');await assert.rejects(recoverProfileFault(f.db,f.plan));
  assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,1);
});
test('intervening caregiver drift prevents restoration rather than overwriting external changes',async t=>{
  const f=await setup(t,'archive',A,{beforeBatch(type,raw){if(type==='product')raw.prepare('UPDATE caregiver SET phone=? WHERE id=?').run('414-555-0199',A);}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'injected');assert.equal(f.raw.prepare('SELECT status FROM caregiver WHERE id=?').get(A).status,'archived');
  await assert.rejects(recoverProfileFault(f.db,f.plan));assert.equal((await f.call()).status,401);assert.equal(f.counts().productBatches,1);
});
test('zero-change transition does not dispatch or restore a status it did not own',async t=>{
  const f=await setup(t,'archive',A,{beforeBatch(type,raw){if(type==='archive')raw.prepare("UPDATE caregiver SET status='archived' WHERE id=?").run(A);}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'claimed');assert.equal(f.counts().productBatches,0);
  assert.equal(f.raw.prepare('SELECT status FROM caregiver WHERE id=?').get(A).status,'archived');
});
for(const request of [{signature:'0'.repeat(64)},{id:B},{revision:3},{fields:{caregiver_id:B}},{fields:{zip:'53299'}},{origin:'https://other.invalid'},{query:'?hook=audit'}])test(`unqualified request never claims or injects ${JSON.stringify(request)}`,async t=>{
  const f=await setup(t);assert.ok((await f.call(request)).status>=400);assert.equal(f.row(),undefined);assert.equal(f.counts().batches,0);
});
test('full witness drift blocks injection even if revision is unchanged',async t=>{
  const f=await setup(t);f.raw.prepare('UPDATE caregiver_profile SET fields_json=? WHERE caregiver_id=?').run('{"zip":"53299"}',A);
  assert.equal((await f.call()).status,500);assert.equal(f.row(),undefined);assert.equal(f.counts().batches,0);
});
test('recovery verifies the exact stored witness digest before restoring status',async t=>{
  let failRestore=true;const f=await setup(t,'archive',A,{beforeBatch(type){if(type==='restore'&&failRestore)throw Error('offline');}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'injected');failRestore=false;
  f.raw.prepare("UPDATE profile_qualification_operation SET before_json='{}'").run();await assert.rejects(recoverProfileFault(f.db,f.plan));
  assert.equal(f.raw.prepare('SELECT status FROM caregiver WHERE id=?').get(A).status,'archived');
});

test('transactional DROP guard prevents schema replacement after outer inspection',async t=>{
  let once=true;const f=await setup(t,'audit',A,{beforeBatch(type,raw){if(type==='drop'&&once){once=false;raw.exec(`DROP TRIGGER ${TRIGGER_NAME}; CREATE TRIGGER ${TRIGGER_NAME} BEFORE INSERT ON audit_log BEGIN SELECT 1; END`);}}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'injected');
  assert.ok(f.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(TRIGGER_NAME).sql.includes('SELECT 1'));
  assert.deepEqual(await f.witness(),f.before);
});
test('transactional CREATE guard refuses lost operation custody without installing a trigger',async t=>{
  const f=await setup(t,'audit',A,{beforeBatch(type,raw){if(type==='create')raw.prepare("UPDATE profile_qualification_operation SET ticket='other'").run();}});
  assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,0);
  assert.equal(f.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(TRIGGER_NAME),undefined);
  assert.deepEqual(await f.witness(),f.before);
});

test('cleanup-only restart resolves owned pending restoration without resuming product batch',async t=>{
  let offline=true;const f=await setup(t,'archive',A,{beforeBatch(type){if(type==='restore'&&offline)throw Error('offline');}});
  assert.equal((await f.call()).status,500);assert.equal(f.row().phase,'injected');const count=f.counts().productBatches;
  offline=false;assert.equal((await recoverProfileFault(f.db,f.plan)).phase,'cleaned');
  assert.equal(f.counts().productBatches,count);assert.deepEqual(await f.witness(),f.before);
  assert.equal((await f.call()).status,500);assert.equal(f.counts().productBatches,count);
});
test('a second operation ID cannot bypass an unresolved owner claim',async t=>{
  const f=await setup(t);f.raw.prepare(`INSERT INTO profile_qualification_operation VALUES (?,?,?,?,?,?,?,?)`)
    .run('profile_fault_20261121_prior',A,4,'archive','prior-ticket','claimed',JSON.stringify(f.before),'UNKNOWN_NO_REPLAY');
  const other=createProfileFaultDb(f.db,{...f.plan,id:'profile_fault_20261121_second'});
  await assert.rejects(saveCaregiverProfile(other,A,{revision:4,fields:{contact_requested:'Yes'}}));
  assert.equal(f.counts().productBatches,0);assert.deepEqual(await f.witness(),f.before);
});
