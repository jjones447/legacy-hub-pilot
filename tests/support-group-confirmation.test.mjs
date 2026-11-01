// Support-group-ONLY confirmation slice of #285 (approved Nov 1). Ordinary event
// registrations must get NO confirmation dispatch in this release. Inert: node:sqlite with the
// real schema, fake provider fetch, fictional .invalid addresses. No network, provider or mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequestPost } from '../functions/api/intake.js';
import * as confirmations from '../functions/_lib/registration-email.mjs';
import { confirmSupportGroup } from '../functions/_lib/registration-email.mjs';
import { supportGroupSession } from '../functions/_lib/support-group-session.mjs';
import { sendEmail, signInEmail } from '../functions/_lib/email.js';

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

test('sender itself enforces exact confirmation recipient, rejects multi-recipient and unknown purpose', async () => {
  const f=fixture();
  const alias='owner+staging@example.invalid';
  const env={...f.env,ENVIRONMENT:'preview',CONFIRMATION_PREVIEW_MAIL_ENABLED:'1',CONFIRMATION_PREVIEW_RECIPIENTS:` ${alias}, second@example.invalid `};
  for(const to of ['owner@example.invalid','other@example.invalid',`${alias},other@example.invalid`,[alias], [alias,'other@example.invalid'], `${alias}\r\nBcc: other@example.invalid`, null]) {
    assert.deepEqual(await sendEmail(env,{to,purpose:'confirmation'},f.send),{ok:false,status:0});
  }
  for(const purpose of [undefined,'portal','bulk','Confirmation','',null]) {
    assert.deepEqual(await sendEmail(env,{to:alias,purpose},f.send),{ok:false,status:0});
  }
  for(const list of ['*','@example.invalid','example.invalid','owner@example.invalid','']) {
    assert.deepEqual(await sendEmail({...env,CONFIRMATION_PREVIEW_RECIPIENTS:list},{to:alias,purpose:'confirmation'},f.send),{ok:false,status:0});
  }
  assert.equal(f.fetches.length,0);
  for(const to of [alias.toUpperCase(),'second@example.invalid']) {
    assert.equal((await sendEmail(env,{to,purpose:'confirmation'},f.send)).ok,true);
    assert.deepEqual(JSON.parse(f.fetches.at(-1).init.body).to,[to]);
  }
  assert.equal(f.fetches.length,2);
});

test('confirmation-only preview gate fails closed without key, valid switch, recipient or preview environment', async () => {
  const f=fixture();
  const base={...f.env,ENVIRONMENT:'preview',CONFIRMATION_PREVIEW_MAIL_ENABLED:'1',CONFIRMATION_PREVIEW_RECIPIENTS:f.body.email};
  const patches=[{EMAIL_API_KEY:''},{EMAIL_API_KEY:'  '},{ENVIRONMENT:'development'},{ENVIRONMENT:'unknown'},
    ...[undefined,'','false','0','yes'].map(flag=>({CONFIRMATION_PREVIEW_MAIL_ENABLED:flag}))];
  for(const patch of patches) assert.deepEqual(await sendEmail({...base,...patch},{to:f.body.email,purpose:'confirmation'},f.send),{ok:false,status:0});
  assert.equal(f.fetches.length,0);
  // No new switch/allowlist requirement is imposed on existing production.
  for(const ENVIRONMENT of [undefined,'production']) {
    assert.equal((await sendEmail({...f.env,ENVIRONMENT},{to:f.body.email,purpose:'confirmation'},f.send)).ok,true);
    assert.equal((await sendEmail({...f.env,ENVIRONMENT},{to:f.body.email,...signInEmail('https://example.invalid/unused')},f.send)).ok,true);
  }
  assert.equal(f.fetches.length,4);
});

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
    const env={...f.env,ENVIRONMENT:'preview',CONFIRMATION_PREVIEW_MAIL_ENABLED:'1',CONFIRMATION_PREVIEW_RECIPIENTS:permitted?f.body.email:'different@example.invalid'};
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


// -- exclusion proof: ordinary event registrations send nothing ---------------------------------

async function withProviderSpy(run) {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200 }; };
  try { await run(calls); } finally { globalThis.fetch = original; }
  return calls;
}
const httpRequest = (body, ip) => ({ headers: new Headers({ 'cf-connecting-ip': ip }), json: async () => body });

for (const ENVIRONMENT of ['production', undefined]) test(`HTTP ordinary event registration (${ENVIRONMENT ?? 'no ENVIRONMENT'}) makes NO provider call and adds no confirmation work`, async () => {
  const f = fixture(); const env = { ...f.env, ENVIRONMENT };
  let res;
  const calls = await withProviderSpy(async () => { res = await onRequestPost({ request: httpRequest(f.body, '192.0.2.20'), env }); });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(Object.hasOwn(json, 'confirmation_email'), false, 'no confirmation outcome for ordinary events');
  assert.equal(calls.length, 0, 'no Resend request for an ordinary event registration');
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM registration').get().n, 1);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'confirmation.%'").get().n, 0);
  assert.equal(f.raw.prepare("SELECT detail FROM followup WHERE kind = 'event_confirmation'").get().detail, 'Confirm registration for ev_demo');
});

test('HTTP support-group sign-up in production makes exactly one confirmation provider call', async () => {
  const f = groupFixture(); let res;
  const calls = await withProviderSpy(async () => { res = await onRequestPost({ request: httpRequest(f.body, '192.0.2.21'), env: f.env }); });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).confirmation_email, 'submitted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'legacy-support-group-production-1');
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ['demo@example.invalid']);
});

test('the slice has no ordinary-registration confirmation code to dispatch', () => {
  assert.deepEqual(Object.keys(confirmations).sort(), ['confirmSupportGroup', 'confirmationMailAllowed', 'supportGroupEmail']);
  const intake = readFileSync(new URL('../functions/api/intake.js', import.meta.url), 'utf8');
  assert.doesNotMatch(intake, /confirmRegistration|event_registration/);
  assert.match(intake, /if \(isSupportGroup\(body\) && result\.body\.ok\)/);
  // The ordinary-event frontend copy hunk of #285 is not part of this slice.
  assert.doesNotMatch(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), /confirmation_email/);
});
