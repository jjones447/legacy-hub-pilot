import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/caregiver-profile-fixture.mjs';
import { PROFILE_FIELDS, PROFILE_SECTIONS, RESTRICTED_PROFILE_FIELDS, profileCompletion } from '../functions/_lib/caregiver-profile-fields.js';

const patch = (fields, revision = 0) => ({ method: 'POST', body: { revision, fields } });
function setup(t, options) { const f = fixture(options); t.after(() => f.close()); return f; }
const ALL_ANSWERS = {
  first_name: 'Fictional', last_name: 'Caregiver', preferred_name: 'Fictional preferred',
  date_of_birth: '1980-02-29', phone: '414-555-0123', street: '123 Fictional Street', city: 'Milwaukee', state: 'WI', zip: '53202',
  preferred_contact: 'Text Message', preferred_language: 'English',
  currently_caring: 'Yes', relationship: 'Parent', care_duration: '1–3 years', dementia_status: 'Yes, diagnosed',
  dementia_type: "Alzheimer's disease", lives_together: 'No', care_role: 'Primary caregiver', care_hours: '10–20 hours', care_help: 'Sometimes',
  support_needs: ['Respite care', 'Financial or legal resources'], care_challenge: 'Fictional scheduling challenge',
  contact_requested: 'Yes', support_contact_method: 'Phone Call', respite_used: 'No', respite_interest: 'Maybe', respite_type: 'Both',
  respite_barriers: ['Cost', 'Transportation'], race_ethnicity: ['White', 'Another identity (please specify)'], race_ethnicity_other: 'Fictional identity',
  gender: 'Another identity (please specify)', gender_other: 'Fictional gender', employment: 'Self-employed',
};

test('all five sections/every writable field round-trip; sensitive answers are separate and audit is payload-free', async t => {
  const f = setup(t);
  assert.deepEqual(PROFILE_SECTIONS.map(s => s.key), ['personal', 'journey', 'support', 'respite', 'demographics']);
  assert.deepEqual(Object.keys(ALL_ANSWERS).sort(), Object.values(PROFILE_FIELDS).filter(f => !f.readOnly).map(f => f.key).sort());
  assert.equal((await f.call(patch(ALL_ANSWERS))).status, 200);
  const result = await (await f.call()).json();
  assert.deepEqual(result.profile.fields, { ...ALL_ANSWERS, email: 'fictional.a@example.invalid' });
  assert.equal(result.profile.completion.complete, true);
  const row = f.raw.prepare('SELECT fields_json, restricted_json FROM caregiver_profile').get();
  const ordinary = JSON.parse(row.fields_json), restricted = JSON.parse(row.restricted_json);
  for (const key of RESTRICTED_PROFILE_FIELDS) { assert.equal(Object.hasOwn(ordinary, key), false); assert.deepEqual(restricted[key], ALL_ANSWERS[key]); }
  const audit = f.raw.prepare('SELECT before_json, after_json FROM audit_log').get();
  assert.deepEqual(JSON.parse(audit.after_json), { revision: 1 });
  assert.equal(audit.before_json, null);
});

test('only full name, account email and ZIP determine completion; optional decline does not block save', async t => {
  const f = setup(t);
  assert.deepEqual(profileCompletion({}), { required: 4, answered: 0, missing: ['first_name', 'last_name', 'email', 'zip'], complete: false });
  await f.call(patch({ last_name: 'Caregiver', zip: '53202', date_of_birth: null, gender: 'Prefer not to answer', race_ethnicity: ['Prefer not to answer'] }));
  const profile = (await (await f.call()).json()).profile;
  assert.equal(profile.completion.complete, true);
  assert.equal(profile.fields.date_of_birth, null);
  assert.equal(profile.fields.gender, 'Prefer not to answer');
});

test('conditional questions reject hidden additions, preserve saved answers, and allow former caregivers to skip', async t => {
  const f = setup(t);
  assert.equal((await f.call(patch({ dementia_type: 'Unknown' }))).status, 400);
  assert.equal((await f.call(patch({ support_contact_method: 'Email' }))).status, 400);
  assert.equal((await f.call(patch({ race_ethnicity_other: 'Fictional' }))).status, 400);
  assert.equal((await f.call(patch({ currently_caring: 'I was previously a caregiver', care_role: 'Primary caregiver' }))).status, 400);
  await f.call(patch(ALL_ANSWERS));
  assert.equal((await f.call(patch({ currently_caring: 'I was previously a caregiver', contact_requested: 'No' }, 1))).status, 200);
  const profile = (await (await f.call()).json()).profile;
  assert.equal(profile.fields.currently_caring, 'I was previously a caregiver');
  assert.equal(profile.fields.dementia_type, "Alzheimer's disease", 'saved conditional answers preserved for return');
});

test('all invalid choice values, duplicate/exclusive selections, invalid DOB and forbidden legacy fields refuse', async t => {
  const f = setup(t);
  for (const field of Object.values(PROFILE_FIELDS).filter(field => field.options)) {
    const invalid = field.type === 'multi' ? ['NOT AN OPTION'] : 'NOT AN OPTION';
    assert.equal((await f.call(patch({ [field.key]: invalid }))).status, 400, field.key);
  }
  for (const fields of [
    { race_ethnicity: ['White', 'White'] }, { race_ethnicity: ['White', 'Prefer not to answer'] },
    { respite_barriers: ['Cost', 'Nothing has prevented me'] }, { support_needs: ['Respite care', 'Prefer not to answer'] },
    { date_of_birth: '2023-02-29' }, { date_of_birth: '9999-01-01' }, { date_of_birth: '1980-1-1' },
    { gender_other: 'x'.repeat(121) }, { household_income: 20000 }, { medications: 'none' },
    { top_three: ['Respite care'] }, { wellness_preferences: 'none' },
  ]) assert.equal((await f.call(patch(fields))).status, 400);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM caregiver_profile').get().n, 0);
});

test('contact request creates only one generic review flag; edits do not duplicate; withdrawal dismisses only Profile flags', async t => {
  const f = setup(t);
  f.raw.exec("INSERT INTO followup(caregiver_id,kind,source) VALUES ('cg_a','unrelated','staff')");
  await f.call(patch({ contact_requested: 'Yes', support_contact_method: 'Email', care_challenge: 'SENSITIVE FICTIONAL challenge' }));
  await f.call(patch({ zip: '53202' }, 1));
  const flags = f.raw.prepare("SELECT * FROM followup WHERE source='caregiver_profile'").all();
  assert.equal(flags.length, 1);
  assert.equal(flags[0].status, 'open');
  assert.equal(flags[0].detail.includes('SENSITIVE'), false);
  assert.equal((await f.call(patch({ contact_requested: 'Yes' }))).status, 409);
  await f.call(patch({ contact_requested: 'No' }, 2));
  assert.equal(f.raw.prepare("SELECT status FROM followup WHERE source='caregiver_profile'").get().status, 'dismissed');
  assert.equal(f.raw.prepare("SELECT status FROM followup WHERE source='staff'").get().status, 'open');
  await f.call(patch({ contact_requested: 'Yes' }, 3));
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM followup WHERE source='caregiver_profile' AND status='open'").get().n, 1);
  for (const table of ['registration', 'grant_application', 'note']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.equal(f.raw.prepare("SELECT sanctuary_member FROM caregiver WHERE id='cg_a'").get().sanctuary_member, 0);
});

test('review flag storage failure rolls back Profile and audit together', async t => {
  const f = setup(t);
  f.raw.exec("CREATE TRIGGER fail_profile_flag BEFORE INSERT ON followup BEGIN SELECT RAISE(ABORT,'synthetic flag failure'); END");
  assert.equal((await f.call(patch({ contact_requested: 'Yes' }))).status, 500);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM caregiver_profile').get().n, 0);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 0);
});

test('admin receives restricted answers; ordinary staff never receive individual DOB/demographic values or keys', async t => {
  const f = setup(t);
  await f.call(patch(ALL_ANSWERS));
  const admin = await f.staffCall(undefined, { actor: 'admin@example.invalid' });
  assert.equal(admin.status, 200);
  assert.equal(admin.headers.get('Cache-Control'), 'no-store');
  const a = (await admin.json()).profile.fields;
  assert.equal(a.date_of_birth, ALL_ANSWERS.date_of_birth);
  const staff = await f.staffCall();
  const b = (await staff.json()).profile.fields;
  assert.equal(b.support_needs[0], 'Respite care');
  for (const key of RESTRICTED_PROFILE_FIELDS) assert.equal(Object.hasOwn(b, key), false);
  assert.equal(JSON.stringify(b).includes('1980-02-29'), false);
  assert.equal(JSON.stringify(b).includes('Fictional identity'), false);
});

for (const denial of ['no-proof', 'service', 'missing', 'deactivated', 'disabled']) test(`staff ${denial} cannot access individual or aggregate answers`, async t => {
  const f = setup(t);
  await f.call(patch(ALL_ANSWERS));
  const opts = {};
  if (denial === 'no-proof') { opts.verified = false; opts.headers = { 'x-dev-actor': 'admin@example.invalid', 'Cf-Access-Authenticated-User-Email': 'admin@example.invalid' }; }
  if (denial === 'service') opts.actor = 'service:admin@example.invalid';
  if (denial === 'missing') opts.actor = 'nobody@example.invalid';
  if (denial === 'deactivated') f.raw.exec("UPDATE staff_member SET status='deactivated'");
  if (denial === 'disabled') delete f.env.PORTAL_PROFILE_ENABLED;
  for (const path of ['/api/staff/caregiver-profile/cg_a', '/api/staff/profile-summary']) {
    const res = await f.staffCall(path, opts);
    assert.ok([403, 404].includes(res.status));
    const body = await res.text();
    assert.equal(body.includes('1980'), false); assert.equal(body.includes('Fictional'), false);
  }
});

test('current role downgrade inside read prevents restricted result even after middleware proof', async t => {
  const f = setup(t, { beforeRead(raw, sql) {
    if (sql.includes('FROM staff_member s JOIN caregiver')) raw.exec("UPDATE staff_member SET role='staff' WHERE email='admin@example.invalid'");
  } });
  await f.call(patch(ALL_ANSWERS));
  const body = await (await f.staffCall(undefined, { actor: 'admin@example.invalid' })).json();
  for (const key of RESTRICTED_PROFILE_FIELDS) assert.equal(Object.hasOwn(body.profile.fields, key), false);
});

test('corrupt ordinary storage containing a restricted key fails without disclosing its value', async t => {
  const f = setup(t);
  await f.call(patch(ALL_ANSWERS));
  f.raw.prepare('UPDATE caregiver_profile SET fields_json=?').run(JSON.stringify({ date_of_birth: '1980-02-29' }));
  const res = await f.staffCall();
  assert.equal(res.status, 500);
  assert.equal((await res.text()).includes('1980'), false);
});

test('aggregates have no individual filters/rows/free text; small cells and complements are suppressed', async t => {
  const f = setup(t);
  await f.call(patch(ALL_ANSWERS));
  let res = await f.staffCall('/api/staff/profile-summary');
  let data = (await res.json()).summary;
  assert.equal(data.total_profiles, null);
  assert.ok(Object.values(data.groups).flat().every(item => item.count === null));
  for (let i = 0; i < 11; i++) {
    f.raw.prepare('INSERT INTO caregiver(id,first_name)VALUES(?,?)').run(`cg_extra_${i}`, `Fictional ${i}`);
    const restricted = { date_of_birth: '1980-02-29', gender: i < 5 ? 'Woman' : 'Man', race_ethnicity: null };
    f.raw.prepare('INSERT INTO caregiver_profile(caregiver_id,revision,fields_json,restricted_json)VALUES(?,1,?,?)')
      .run(`cg_extra_${i}`, '{}', JSON.stringify(restricted));
  }
  res = await f.staffCall('/api/staff/profile-summary');
  const body = await res.text(); data = JSON.parse(body).summary;
  assert.equal(data.total_profiles, 12);
  assert.equal(body.includes('1980-02-29'), false);
  assert.equal(body.includes('Fictional identity'), false);
  assert.equal(body.includes('cg_a'), false);
  assert.ok(data.groups.gender.every(item => item.count === null), 'rare third identity suppresses whole group');
  f.raw.prepare('UPDATE caregiver_profile SET restricted_json=? WHERE caregiver_id=?').run(JSON.stringify({ gender: 'Woman' }), 'cg_a');
  data = (await (await f.staffCall('/api/staff/profile-summary')).json()).summary;
  assert.equal(data.groups.gender.find(item => item.label === 'Woman').count, 6);
  assert.equal(data.groups.gender.find(item => item.label === 'Man').count, 6);
  f.raw.exec("UPDATE caregiver SET source='qa_test' WHERE id='cg_extra_0'");
  data = (await (await f.staffCall('/api/staff/profile-summary')).json()).summary;
  assert.equal(data.total_profiles, 11, 'internal QA records excluded from reporting');
  for (const path of ['/api/staff/profile-summary?caregiver_id=cg_a', '/api/staff/caregiver-profile/cg_a?include_demographics=1']) {
    assert.equal((await f.staffCall(path)).status, 404);
  }
});

test('staff storage errors never put sensitive values into response or logs', async t => {
  const f = setup(t, { beforeRead(raw, sql) {
    if (sql.includes('FROM staff_member s')) throw new Error('SENSITIVE FICTIONAL DOB 1980-02-29');
  } });
  await f.call(patch(ALL_ANSWERS));
  const original = console.error, logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    for (const path of ['/api/staff/caregiver-profile/cg_a', '/api/staff/profile-summary']) {
      const response = await f.staffCall(path);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
    }
  } finally { console.error = original; }
  assert.equal(logged.length, 2);
  assert.equal(logged.join(' ').includes('SENSITIVE'), false);
  assert.equal(logged.join(' ').includes('1980'), false);
});
