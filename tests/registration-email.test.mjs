import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequestPost } from '../functions/api/intake.js';
import { confirmRegistration, confirmSupportGroup, confirmationMailAllowed, registrationEmail, supportGroupEmail } from '../functions/_lib/registration-email.mjs';
import { supportGroupSession } from '../functions/_lib/support-group-session.mjs';

const schema = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(schema);
  raw.exec(`INSERT INTO event(id,title,type,starts_at,ends_at,location,capacity,publish_state)
    VALUES ('ev_demo','DEMO <social>','other','2026-11-04 17:00','2026-11-04 18:00','DEMO hall',5,'published')`);
  const db = {
    prepare(sql) {
      const statement = params => ({
        first: async () => raw.prepare(sql).get(...params) ?? null,
        run: async () => ({ success: true, meta: raw.prepare(sql).run(...params) }),
      });
      return { ...statement([]), bind: (...params) => statement(params) };
    },
    async batch(writes) {
      raw.exec('BEGIN');
      try { const results = []; for (const write of writes) results.push(await write.run()); raw.exec('COMMIT'); return results; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { LEGACY_DB: db, ENVIRONMENT: 'production', EMAIL_API_KEY: 'fictional-not-a-key' };
  const body = { kind: 'event_registration', source: 'site_form:event', event_id: 'ev_demo',
    first_name: 'DEMO', email: 'demo@example.invalid', external_ref: 'fictional-registration' };
  const fetches = [];
  const send = async (url, init) => { fetches.push({ url, init }); return { ok: true, status: 200 }; };
  return { raw, db, env, body, fetches, send };
}
async function registered() { const f = fixture(); assert.equal((await handleIntake(f.db, f.body)).status, 201); return f; }

test('one persisted registration produces one provider request with safe content and durable identity', async () => {
  const f = await registered();
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'submitted');
  assert.equal(f.fetches.length, 1);
  const { url, init } = f.fetches[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers['Idempotency-Key'], 'legacy-registration-production-1');
  assert.ok(init.signal instanceof AbortSignal);
  const sent = JSON.parse(init.body);
  assert.deepEqual(sent.to, ['demo@example.invalid']);
  assert.match(sent.text, /2026-11-04 17:00 \(America\/Chicago\)/);
  assert.match(sent.text, /DEMO hall/); assert.match(sent.text, /does not confirm payment or attendance/);
  assert.match(sent.text, /https:\/\/caregiversanctuary.org\/portal/);
  assert.match(sent.html, /DEMO &lt;social&gt;/); assert.doesNotMatch(sent.html, /<social>/);
  const audits = f.raw.prepare("SELECT * FROM audit_log WHERE action LIKE 'confirmation.%' ORDER BY id").all();
  assert.deepEqual(audits.map(a => a.action), ['confirmation.claimed','confirmation.accepted']);
  assert.doesNotMatch(JSON.stringify(audits), /demo@example|DEMO hall|<social>/);
  assert.match(f.raw.prepare('SELECT detail FROM followup').get().detail, /recipient delivery is not yet verified/);
});

test('public duplicate and a second concurrent fresh caller cannot resend', async () => {
  const f = await registered();
  await Promise.all([confirmRegistration(f.env, f.body, true, f.send), confirmRegistration(f.env, f.body, true, f.send)]);
  assert.equal(f.fetches.length, 1);
  assert.equal((await handleIntake(f.db, f.body)).body.duplicate, true);
  assert.equal(await confirmRegistration(f.env, { ...f.body, email: 'attacker@example.invalid' }, false, f.send), 'submitted');
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'submitted');
  assert.equal(f.fetches.length, 1);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM registration').get().n, 1);
});

test('an old durable claim blocks sending after the provider idempotency window has expired', async () => {
  const f = await registered();
  f.raw.exec(`INSERT INTO audit_log(actor,action,entity,entity_id,at)
    VALUES ('system','confirmation.claimed','registration','1','2000-01-01 00:00:00')`);
  assert.equal(await confirmRegistration(f.env,f.body,true,f.send),'needs_review');
  assert.equal(f.fetches.length,0);
});

test('duplicate historical registration without an email claim is never backfilled', async () => {
  const f = await registered();
  assert.equal(await confirmRegistration(f.env, f.body, false, f.send), 'not_sent');
  assert.equal(f.fetches.length, 0);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'confirmation.%'").get().n, 0);
});

for (const [label, response, expected] of [
  ['rejected', { ok: false, status: 422 }, 'rejected'],
  ['rate limited', { ok: false, status: 429 }, 'rejected'],
  ['server error', { ok: false, status: 500 }, 'unknown'],
  ['conflict', { ok: false, status: 409 }, 'unknown'],
  ['network or timeout', null, 'unknown'],
]) test(`${label}: registration is retained, task stays open, no automatic resend`, async () => {
  const f = await registered(); let calls = 0;
  const send = async () => { calls++; if (!response) throw new Error('fictional timeout'); return response; };
  assert.equal(await confirmRegistration(f.env, f.body, true, send), 'needs_review');
  assert.equal(await confirmRegistration(f.env, f.body, false, send), 'needs_review');
  assert.equal(await confirmRegistration(f.env, f.body, true, send), 'needs_review');
  assert.equal(calls, 1);
  assert.equal(f.raw.prepare('SELECT status FROM registration').get().status, 'registered');
  assert.equal(f.raw.prepare('SELECT status FROM followup').get().status, 'open');
  assert.ok(f.raw.prepare('SELECT id FROM audit_log WHERE action=?').get(`confirmation.${expected}`));
});

test('a lost claim acknowledgment never sends and never clears the committed claim', async () => {
  const f = await registered(); const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes("SELECT 'system','confirmation.claimed'")) return statement;
    return { bind(...args) { const bound = statement.bind(...args); return { async first() { await bound.first(); throw new Error('committed acknowledgement lost'); } }; } };
  };
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'needs_review');
  f.db.prepare = prepare;
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'needs_review');
  assert.equal(f.fetches.length, 0);
});

test('post-send outcome storage fault preserves the claim and prevents a duplicate', async () => {
  const f = await registered(); const batch = f.db.batch.bind(f.db);
  f.db.batch = async () => { throw new Error('fictional outcome store failure'); };
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'needs_review');
  f.db.batch = batch;
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'needs_review');
  assert.equal(f.fetches.length, 1);
  assert.match(f.raw.prepare('SELECT detail FROM followup').get().detail, /verification before any resend/);
});

test('claim-store refusal prevents all mail without damaging registration', async () => {
  const f = await registered();
  f.raw.exec(`CREATE TEMP TRIGGER fail_claim BEFORE INSERT ON audit_log WHEN NEW.action='confirmation.claimed'
    BEGIN SELECT RAISE(ABORT,'fictional store fault'); END;`);
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'needs_review');
  assert.equal(f.fetches.length, 0);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM registration').get().n, 1);
});

test('event registration, original audit and staff task roll back together on task or audit fault', async () => {
  for (const table of ['followup','audit_log']) {
    const f = fixture();
    f.raw.exec(`CREATE TEMP TRIGGER fail_event BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'fictional event failure'); END;`);
    await assert.rejects(handleIntake(f.db, f.body), /fictional event failure/);
    for (const name of ['registration','caregiver','followup','audit_log']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n, 0);
    f.raw.exec('DROP TRIGGER fail_event');
    assert.equal((await handleIntake(f.db, f.body)).status, 201);
  }
});

test('preview requires both existing opt-in and exact explicitly approved recipient', async () => {
  const f = await registered();
  const base = { ...f.env, ENVIRONMENT: 'preview' };
  assert.equal(confirmationMailAllowed(base, f.body.email), false);
  assert.equal(confirmationMailAllowed({ ...base, PORTAL_PREVIEW_MAIL_ENABLED:'1' }, f.body.email), false);
  assert.equal(confirmationMailAllowed({ ...base, CONFIRMATION_PREVIEW_RECIPIENTS:f.body.email }, f.body.email), false);
  const preview = { ...base, PORTAL_PREVIEW_MAIL_ENABLED:'1', CONFIRMATION_PREVIEW_RECIPIENTS:' DEMO@EXAMPLE.INVALID ' };
  assert.equal(confirmationMailAllowed(preview, f.body.email), true);
  assert.equal(confirmationMailAllowed(preview, 'other@example.invalid'), false);
  assert.equal(await confirmRegistration(preview, f.body, true, f.send), 'submitted');
  assert.match(JSON.parse(f.fetches[0].init.body).text, /https:\/\/staging.caregiversanctuary.org\/events/);
});

for (const patch of [{ ENVIRONMENT:'development' }, { ENVIRONMENT:'unknown' }, { EMAIL_API_KEY:'' }, { ENVIRONMENT:'preview', PORTAL_PREVIEW_MAIL_ENABLED:'1' }]) {
  test(`blocked mail policy ${JSON.stringify(patch)} retains signup without external call`, async () => {
    const f = await registered();
    assert.equal(await confirmRegistration({ ...f.env,...patch }, f.body, true, f.send), 'needs_review');
    assert.equal(f.fetches.length, 0);
    assert.ok(f.raw.prepare("SELECT id FROM audit_log WHERE action='confirmation.skipped'").get());
  });
}

test('malformed stored recipient, cancelled registration and invalid event time cannot cause mail', async () => {
  for (const sql of ["UPDATE caregiver SET email='a@example.invalid,b@example.invalid'", "UPDATE registration SET status='cancelled'", "UPDATE event SET starts_at='2026-02-30 17:00'"]) {
    const f = await registered(); f.raw.exec(sql);
    assert.equal(await confirmRegistration(f.env, f.body, true, f.send), 'needs_review');
    assert.equal(f.fetches.length, 0);
  }
});

test('offset event time is rendered in the agreed zone, and untrusted HTML is escaped', () => {
  const result = registrationEmail({ status:'registered',title:'<img src=x>', starts_at:'2026-11-04T23:00:00Z',location:'<script>private</script>' }, 'production');
  assert.match(result.text, /5:00 PM CST/); assert.doesNotMatch(result.html, /<script>|<img/);
});

test('HTTP registration succeeds even with unavailable mail configuration and duplicate never triggers mail', async () => {
  const f = fixture();
  const request = { headers:new Headers({ 'cf-connecting-ip':'192.0.2.10' }), json:async () => f.body };
  const env = { LEGACY_DB:f.db, ENVIRONMENT:'development' };
  const first = await onRequestPost({ request,env });
  assert.equal(first.status,201); assert.equal((await first.json()).confirmation_email,'needs_review');
  const duplicate = await onRequestPost({ request,env });
  assert.equal(duplicate.status,200); assert.equal((await duplicate.json()).duplicate,true);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM registration').get().n,1);
});

test('existing production convention without ENVIRONMENT retains production key and URLs', async () => {
  const f = await registered(); delete f.env.ENVIRONMENT;
  assert.equal(await confirmRegistration(f.env, f.body, true, f.send),'submitted');
  assert.equal(f.fetches[0].init.headers['Idempotency-Key'],'legacy-registration-production-1');
  assert.match(JSON.parse(f.fetches[0].init.body).text,/https:\/\/caregiversanctuary.org\/events/);
});

test('invalid JSON values and full/unpublished events do not create registration or mail work', async () => {
  const f = fixture();
  const request = body => ({ headers:new Headers(),json:async()=>body });
  for (const body of [null,42,{}]) assert.equal((await onRequestPost({request:request(body),env:f.env})).status,400);
  f.raw.exec("UPDATE event SET capacity=0");
  assert.equal((await onRequestPost({request:request(f.body),env:f.env})).status,409);
  f.raw.exec("UPDATE event SET publish_state='draft'");
  assert.equal((await onRequestPost({request:request(f.body),env:f.env})).status,404);
  for (const table of ['caregiver','registration','followup']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
});

for (const confirmation_email of ['submitted','needs_review','not_sent']) {
  test(`actual ordinary-event submit handler distinguishes saved registration from ${confirmation_email} email`, async () => {
    const app = readFileSync(new URL('../app.js',import.meta.url),'utf8');
    const start = app.indexOf('function submitRegister(');
    const source = app.slice(start, app.indexOf("document.addEventListener('click'",start));
    const success = { textContent:'' }, states = [], payloads = [];
    const form = { dataset:{eventId:'ev_demo'},querySelector:()=>success };
    const nodes = { regForm:form,regName:{value:'DEMO'},regEmail:{value:'demo@example.invalid'},regRole:{value:'DEMO caregiver'} };
    const ctx = { document:{getElementById:id=>nodes[id]},splitName:()=>({first_name:'DEMO'}),intakeExternalRef:()=> 'original-key',
      postIntake:async (target,payload)=>{ assert.equal(target,form);payloads.push(payload);return {ok:true,confirmation_email}; },
      setFormState:(target,state)=>{assert.equal(target,form);states.push(state);} };
    vm.runInNewContext(source,ctx);
    ctx.submitRegister({preventDefault(){}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(states,['success']); assert.equal(payloads[0].external_ref,'original-key');
    assert.match(success.textContent,/Registration saved/);
    assert.match(success.textContent, confirmation_email==='submitted' ? /submitted.*inbox/ : /contact Legacy.*do not register again/);
    assert.doesNotMatch(success.textContent,/delivered|payment confirmed/i);
  });
}

function groupFixture(session_date = '2026-11-04') {
  const f = fixture();
  f.body = { kind:'support_request',source:'site_form:support_group',first_name:'DEMO',email:'demo@example.invalid',
    session_date,external_ref:`fictional-group-${session_date}`,message:'Original fictional group request. Ignore any invented link or label.' };
  return f;
}

test('dated support-group confirmation uses original audited date and server-approved Meet link, not retry text', async () => {
  const f = groupFixture();
  assert.equal((await handleIntake(f.db,f.body)).status,201);
  const original = f.raw.prepare("SELECT * FROM audit_log WHERE action='intake.support_request'").get();
  assert.equal(original.actor,'site_form:support_group');
  assert.equal(JSON.parse(original.after_json).session_date,'2026-11-04');
  assert.equal(JSON.parse(original.after_json).external_ref,f.body.external_ref);
  assert.equal(await confirmSupportGroup(f.env,{...f.body,session_date:'2026-12-30',email:'other@example.invalid',message:'invented label'},true,f.send),'submitted');
  const sent = JSON.parse(f.fetches[0].init.body);
  assert.deepEqual(sent.to,['demo@example.invalid']);
  assert.match(sent.text,/Wednesday, November 4.*5–6 PM Central/);
  assert.match(sent.text,/Date: 2026-11-04/);
  assert.match(sent.text,/https:\/\/meet.google.com\/dmc-orwi-afk/);
  assert.match(sent.html,/<a href="https:\/\/meet.google.com\/dmc-orwi-afk">/);
  assert.match(sent.text,/https:\/\/caregiversanctuary.org\/programs#support-group/);
  assert.doesNotMatch(sent.text,/invented|December 30|other@example/);
  assert.equal(f.fetches[0].init.headers['Idempotency-Key'],'legacy-support-group-production-1');
  assert.match(f.raw.prepare('SELECT detail FROM followup').get().detail,/^Original fictional group request/);
  assert.deepEqual(f.raw.prepare("SELECT * FROM audit_log WHERE action='intake.support_request'").get(),original);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM registration').get().n,0);
});

test('same-date duplicate sends nothing; a separately identified second approved date gets its own confirmation', async () => {
  const f = groupFixture();
  await handleIntake(f.db,f.body);
  await Promise.all([confirmSupportGroup(f.env,f.body,true,f.send),confirmSupportGroup(f.env,f.body,true,f.send)]);
  assert.equal((await handleIntake(f.db,{...f.body,session_date:'2026-11-11'})).body.duplicate,true);
  assert.equal(await confirmSupportGroup(f.env,f.body,false,f.send),'submitted');
  assert.equal(f.fetches.length,1);
  const second = {...f.body,external_ref:'fictional-group-2026-11-11',session_date:'2026-11-11'};
  assert.equal((await handleIntake(f.db,second)).status,201);
  assert.equal(await confirmSupportGroup(f.env,second,true,f.send),'submitted');
  assert.equal(f.fetches.length,2);
  assert.notEqual(f.fetches[0].init.headers['Idempotency-Key'],f.fetches[1].init.headers['Idempotency-Key']);
  assert.match(JSON.parse(f.fetches[1].init.body).text,/Date: 2026-11-11/);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM followup').get().n,2);
});

for (const date of [null,undefined]) test(`general joining (${date}) has an explicit null audit date, weekly schedule and no invented booking`, async () => {
  const f = groupFixture(null); if (date === undefined) delete f.body.session_date;
  await handleIntake(f.db,f.body);
  assert.equal(JSON.parse(f.raw.prepare("SELECT after_json FROM audit_log WHERE action='intake.support_request'").get().after_json).session_date,null);
  assert.equal(await confirmSupportGroup(f.env,f.body,true,f.send),'submitted');
  const mail = JSON.parse(f.fetches[0].init.body);
  assert.match(mail.text,/Every Wednesday, 5–6 PM Central/);
  assert.match(mail.text,/general sign-up, not a reservation/);
  assert.match(mail.text,/some Wednesdays may be cancelled/);
  assert.doesNotMatch(mail.text,/Date: /);
});

test('actual calendar dates must occur exactly in the authoritative session list', async () => {
  for (const date of ['2026-02-30','2026-13-04','2026-11-31','2026-11-25','2026-12-23','2026-11-05','2027-11-04','2026-11-04T00:00:00Z','2026-1-4','',42,{},['2026-11-04']]) {
    const f = groupFixture(date);
    const result = await handleIntake(f.db,f.body);
    assert.equal(result.status,400,JSON.stringify(date));
    for(const table of ['caregiver','followup','audit_log']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  }
  for(const date of ['2026-11-04','2026-11-11','2026-11-18','2026-12-02','2026-12-09','2026-12-16','2026-12-30']) {
    assert.equal(supportGroupSession(date).date,date);
  }
});

test('session_date cannot be supplied on other intake purposes', async () => {
  for(const patch of [{kind:'membership'},{source:'site_form:support'},{kind:'event_registration',event_id:'ev_demo'}]) {
    const f=groupFixture();
    assert.equal((await handleIntake(f.db,{...f.body,...patch})).status,400);
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM caregiver').get().n,0);
  }
});

test('support-group original audit fault rolls back the complete sign-up before any mail', async () => {
  const f=groupFixture();
  f.raw.exec(`CREATE TEMP TRIGGER fail_group_audit BEFORE INSERT ON audit_log WHEN NEW.action='intake.support_request'
    BEGIN SELECT RAISE(ABORT,'fictional group audit failure'); END;`);
  await assert.rejects(handleIntake(f.db,f.body),/fictional group audit failure/);
  for(const table of ['caregiver','followup','audit_log']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  assert.equal(await confirmSupportGroup(f.env,f.body,true,f.send),'needs_review');
  assert.equal(f.fetches.length,0);
});

test('support-group mail failure leaves original request/date and an open recovery task; duplicate never resends', async () => {
  const f=groupFixture(); await handleIntake(f.db,f.body); let attempts=0;
  const sender=async()=>{ attempts++; throw new Error('fictional uncertain send'); };
  assert.equal(await confirmSupportGroup(f.env,f.body,true,sender),'needs_review');
  assert.equal(await confirmSupportGroup(f.env,f.body,false,sender),'needs_review');
  assert.equal(attempts,1);
  const task=f.raw.prepare('SELECT * FROM followup').get();
  assert.equal(task.status,'open'); assert.match(task.detail,/Original fictional group request[\s\S]*outcome unknown/);
  assert.equal(JSON.parse(f.raw.prepare("SELECT after_json FROM audit_log WHERE action='intake.support_request'").get().after_json).session_date,'2026-11-04');
});

test('support-group confirmation uses the same preview allowlist and correct preview URL', async () => {
  for(const permitted of [false,true]) {
    const f=groupFixture(); await handleIntake(f.db,f.body);
    const env={...f.env,ENVIRONMENT:'preview',PREVIEW_MAIL_ENABLED:'1',CONFIRMATION_PREVIEW_RECIPIENTS:permitted?f.body.email:'different@example.invalid'};
    assert.equal(await confirmSupportGroup(env,f.body,true,f.send),permitted?'submitted':'needs_review');
    assert.equal(f.fetches.length,permitted?1:0);
    if(permitted) assert.match(JSON.parse(f.fetches[0].init.body).text,/staging.caregiversanctuary.org\/programs#support-group/);
  }
});

test('historical support-group sign-up never sends or gets a manufactured original date', async () => {
  const f=groupFixture();
  // Legacy row deliberately has no original intake audit; no retrofit write.
  f.raw.exec(`INSERT INTO caregiver(id,first_name,email) VALUES('cg_old','DEMO','demo@example.invalid');
    INSERT INTO followup(caregiver_id,kind,detail,source,external_ref)
    VALUES('cg_old','support_request','Original old label','site_form:support_group','fictional-group-2026-11-04')`);
  assert.equal(await confirmSupportGroup(f.env,f.body,false,f.send),'needs_review');
  assert.equal(f.fetches.length,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n,0);
  assert.equal(f.raw.prepare('SELECT detail FROM followup').get().detail,'Original old label');
});

test('support-group and registration ID spaces cannot suppress one another', async () => {
  const f=await registered(); await confirmRegistration(f.env,f.body,true,f.send);
  const body=groupFixture().body; await handleIntake(f.db,body);
  assert.equal(await confirmSupportGroup(f.env,body,true,f.send),'submitted');
  assert.equal(f.fetches.length,2);
  const claims=f.raw.prepare("SELECT entity,entity_id FROM audit_log WHERE action='confirmation.claimed' ORDER BY id").all();
  assert.deepEqual(claims.map(c=>c.entity),['registration','followup']);
});
