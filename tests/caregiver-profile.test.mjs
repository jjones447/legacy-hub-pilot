import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cookie, ORIGIN } from './helpers/caregiver-profile-fixture.mjs';

function setup(t, options) { const f = fixture(options); t.after(() => f.close()); return f; }
const patch = (fields, revision = 0) => ({ method: 'POST', body: { revision, fields } });
const count = f => f.raw.prepare('SELECT COUNT(*) n FROM caregiver_profile').get().n;
const audit = f => f.raw.prepare("SELECT * FROM audit_log WHERE action='portal.profile_saved'").all();

test('prefill is read-only; partial drafts save/load/resume without changing identity or other records', async t => {
  const f = setup(t);
  const original = JSON.stringify(f.raw.prepare('SELECT * FROM caregiver ORDER BY id').all());
  const first = await f.call();
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  const { profile } = await first.json();
  assert.equal(profile.revision, 0);
  assert.equal(profile.fields.email, 'fictional.a@example.invalid');
  assert.equal(count(f), 0);
  assert.equal(audit(f).length, 0);
  assert.deepEqual(await (await f.call(patch({ zip: '53202', mailing_address: null }))).json(), { ok: true, revision: 1 });
  assert.deepEqual(await (await f.call(patch({ first_name: 'Updated fictional', email: 'different@example.invalid' }, 1))).json(), { ok: true, revision: 2 });
  const resumed = (await (await f.call()).json()).profile;
  assert.equal(resumed.revision, 2);
  assert.equal(resumed.fields.zip, '53202');
  assert.equal(resumed.fields.mailing_address, null);
  assert.equal(resumed.fields.email, 'different@example.invalid');
  assert.equal(resumed.fields.phone, profile.fields.phone);
  assert.equal(JSON.stringify(f.raw.prepare('SELECT * FROM caregiver ORDER BY id').all()), original);
  assert.deepEqual(audit(f).map(row => JSON.parse(row.after_json)), [{ revision: 1 }, { revision: 2 }]);
  assert.ok(audit(f).every(row => row.before_json === null));
  for (const table of ['followup', 'registration', 'note']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});

test('owner B cannot load or overwrite A, including query/body ownership injection', async t => {
  const f = setup(t);
  await f.call(patch({ zip: '53202' }));
  const b = (await (await f.call({ id: 'cg_b' })).json()).profile;
  assert.equal(b.revision, 0);
  assert.equal(b.fields.zip, undefined);
  assert.equal(b.fields.first_name, 'Fictional B');
  assert.equal((await f.call({ id: 'cg_b', path: '/api/portal/profile?caregiver_id=cg_a' })).status, 404);
  assert.equal((await f.call({ id: 'cg_b', ...patch({ caregiver_id: 'cg_a' }) })).status, 400);
  assert.equal((await f.call({ id: 'cg_b', ...patch({ zip: '53203' }, 1) })).status, 409);
  assert.equal((await (await f.call()).json()).profile.fields.zip, '53202');
  assert.equal(audit(f).length, 1);
});

for (const origin of [null, 'null', 'https://other.synthetic.invalid', `${ORIGIN}/`, `${ORIGIN}, ${ORIGIN}`]) {
  test(`write Origin ${origin} refuses before store or body`, async t => {
    const f = setup(t);
    const res = await f.call({ ...patch({ zip: '53202' }), headers: { Origin: origin }, rawBody: 'invalid JSON' });
    assert.equal(res.status, 403);
    assert.deepEqual(f.effects.statements, []);
    assert.equal(count(f), 0);
  });
}
for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded']) {
  test(`write content type ${type} refuses`, async t => {
    const f = setup(t);
    assert.equal((await f.call({ ...patch({ zip: '53202' }), headers: { 'Content-Type': type } })).status, 415);
    assert.deepEqual(f.effects.statements, []);
  });
}

for (const mode of ['disabled', 'preview', 'missing-cookie', 'expired', 'tampered', 'missing-owner', 'archived']) {
  test(`${mode} never reads or mutates protected profile`, async t => {
    const f = setup(t);
    let id = 'cg_a', headers = {}, status = 401;
    if (mode === 'disabled') { delete f.env.PORTAL_PROFILE_ENABLED; status = 404; }
    if (mode === 'preview') { f.env.ENVIRONMENT = 'preview'; status = 503; }
    if (mode === 'missing-cookie') headers.Cookie = null;
    if (mode === 'expired') headers.Cookie = await cookie('cg_a', Date.now() - 1000);
    if (mode === 'tampered') headers.Cookie = (await cookie()).replace('cg_a', 'cg_b');
    if (mode === 'missing-owner') id = 'cg_missing';
    if (mode === 'archived') f.raw.exec("UPDATE caregiver SET status='archived' WHERE id='cg_a'");
    for (const spec of [{}, patch({ zip: '53202' })]) {
      assert.equal((await f.call({ ...spec, id, headers })).status, status);
    }
    assert.equal(f.effects.statements.some(sql => sql.includes('caregiver_profile')), false);
    assert.equal(count(f), 0);
  });
}

test('archive between initial auth and joined read cannot disclose saved answers', async t => {
  let revoke = false;
  const f = setup(t, { beforeRead(raw, sql) {
    if (revoke && sql.includes('LEFT JOIN caregiver_profile')) raw.exec("UPDATE caregiver SET status='archived' WHERE id='cg_a'");
  } });
  await f.call(patch({ mailing_address: 'Fictional private address' }));
  revoke = true;
  const res = await f.call();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: 'unauthorized' });
});

for (const revision of [0, 1]) test(`archive immediately before revision ${revision} write fences data and audit`, async t => {
  let revoke = false;
  const f = setup(t, { beforeBatch(raw) { if (revoke) raw.exec("UPDATE caregiver SET status='archived' WHERE id='cg_a'"); } });
  if (revision) await f.call(patch({ zip: '53202' }));
  revoke = true;
  assert.equal((await f.call(patch({ zip: '53203' }, revision))).status, 409);
  assert.equal(audit(f).length, revision);
  assert.equal(count(f), revision);
  if (revision) assert.equal(JSON.parse(f.raw.prepare('SELECT fields_json FROM caregiver_profile').get().fields_json).zip, '53202');
});

for (const revision of [0, 1]) test(`concurrent revision ${revision} saves have one winner, stale retry cannot overwrite`, async t => {
  const f = setup(t);
  if (revision) await f.call(patch({ zip: '53200' }));
  const results = await Promise.all([f.call(patch({ zip: '53201' }, revision)), f.call(patch({ zip: '53202' }, revision))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = (await (await f.call()).json()).profile;
  assert.equal(saved.revision, revision + 1);
  assert.equal((await f.call(patch({ zip: '53299' }, revision))).status, 409);
  assert.deepEqual((await (await f.call()).json()).profile, saved);
  assert.equal(audit(f).length, revision + 1);
});

test('audit failure rolls back draft, response leaks no answers or database details', async t => {
  const f = setup(t);
  f.raw.exec("CREATE TRIGGER profile_audit_fault BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'SYNTHETIC private audit failure'); END");
  const res = await f.call(patch({ zip: '53202' }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, error: 'internal_error' });
  assert.equal(count(f), 0);
  assert.equal(audit(f).length, 0);
});
for (const fault of ['lostAck', 'unknownMeta']) test(`${fault} requires readback; stale replay creates no second save`, async t => {
  const f = setup(t, { [fault]: true });
  const res = await f.call(patch({ zip: '53202' }));
  assert.equal(res.status, 500);
  assert.equal((await (await f.call()).json()).profile.revision, 1);
  assert.equal((await f.call(patch({ zip: '53203' }))).status, 409);
  assert.equal(audit(f).length, 1);
});

test('invalid types, unknown fields, revisions, malformed or oversized bodies never mutate', async t => {
  const f = setup(t);
  const bodies = [null, [], {}, { revision: -1, fields: { zip: '53202' } },
    { revision: '0', fields: { zip: '53202' } }, { revision: 0.5, fields: { zip: '53202' } },
    { revision: 0, fields: {} }, { revision: 0, fields: [] },
    { revision: 0, fields: { zip: 'bad' } }, { revision: 0, fields: { zip: 53202 } },
    { revision: 0, fields: { email: 'bad@' } }, { revision: 0, fields: { first_name: 'x'.repeat(121) } },
    { revision: 0, fields: { phone: '\u0000private' } },
    { revision: 0, fields: { journal: 'never collect' } },
    { revision: 0, fields: { __proto_marker: 'no' } },
    { revision: 0, fields: { status: 'active' } },
    { revision: 0, fields: { zip: '53202' }, caregiver_id: 'cg_b' }];
  for (const body of bodies) assert.equal((await f.call({ method: 'POST', body })).status, 400, JSON.stringify(body));
  for (const rawBody of ['{', ' '.repeat(8193) + '{}', '{"revision":0,"fields":{"__proto__":"bad"}}']) {
    assert.equal((await f.call({ method: 'POST', rawBody })).status, 400);
  }
  assert.equal(f.effects.batches, 0);
  assert.equal(count(f), 0);
});

test('empty and declined optional drafts persist; absent fields survive later partial saves', async t => {
  const f = setup(t);
  assert.equal((await f.call(patch({ first_name: '', email: null, zip: '', mailing_address: null }))).status, 200);
  assert.equal((await f.call(patch({ phone: '414-555-0199' }, 1))).status, 200);
  const { fields } = (await (await f.call()).json()).profile;
  assert.equal(fields.email, null);
  assert.equal(fields.mailing_address, null);
  assert.equal(fields.zip, '');
  assert.equal(fields.first_name, '');
});
