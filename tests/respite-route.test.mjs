import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { onRequestGet as staffGet, onRequestPost as staffPost } from '../functions/api/staff/[[path]].js';
import { setVerifiedAccessStaffActor } from '../functions/_lib/agent-confirmation.mjs';
import { cookie } from './helpers/caregiver-profile-fixture.mjs';
import { participantDetails, pendingCommand, respiteFixture } from './helpers/respite-fixture.mjs';

const origin = 'https://customer-test.legacy-hub-5qo.pages.dev';
const ownerRoute = '/api/portal/respite';
const staffRoute = '/api/staff/respite';
const staffEmail = 'staff@example.invalid';

async function setup(t) {
  const {raw, db} = respiteFixture();
  t.after(() => raw.close());
  raw.exec(`UPDATE caregiver SET segment_tags='["qa_test","exclude_reporting"]' WHERE id='owner'`);
  const env = {
    ENVIRONMENT: 'preview', LEGACY_DB: db, PORTAL_PREVIEW_MAIL_ENABLED: '1',
    PORTAL_TOKEN_SECRET: 'synthetic-profile-signing-key', PORTAL_RESPITE_TEST_ENABLED: '1',
    PORTAL_RESPITE_TEST_ORIGIN: origin, PORTAL_RESPITE_TEST_CAREGIVER_ID: 'owner',
    PORTAL_RESPITE_TEST_STAFF_EMAIL: staffEmail,
  };
  const ownerCookie = await cookie('owner');
  const fixture = {raw, env};
  fixture.send = async (suffix, { body, path = ownerRoute, from = origin, headers = {}, actor = staffEmail,
    verified = true, credential = ownerCookie, rawBody, method = body === undefined && rawBody === undefined ? 'GET' : 'POST' } = {}) => {
    const staff = path === staffRoute;
    const header = new Headers({
      Cookie: credential, 'Cf-Access-Jwt-Assertion': 'fictional-jwt',
      Origin: from, 'Content-Type': 'application/json', ...headers,
    });
    const request = new Request(from + path + suffix, {method, headers: header,
      ...(method === 'POST' ? {body: rawBody ?? JSON.stringify(body)} : {})});
    const data = {staffEmail: actor};
    if (staff && verified) setVerifiedAccessStaffActor(data, actor);
    const route = staff ? (method === 'POST' ? staffPost : staffGet) : (method === 'POST' ? onRequestPost : onRequestGet);
    const response = await route({request, env, data});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return {status: response.status, value: await response.json()};
  };
  return fixture;
}

test('qualified owner can request two dates and replay without a seat or duplicate audit', async t => {
  const f = await setup(t);
  const session = await f.send('/session');
  assert.equal(session.status, 200);
  assert.equal(session.value.visible, true);
  assert.equal(session.value.acknowledgments, undefined);
  const headers = {'X-Respite-Session': session.value.proof};
  const view = await f.send('', {headers});
  assert.equal(view.value.dates.length, 2);
  for (const [date, id] of [['session', 'respite_compose_date_01'], ['session2', 'respite_compose_date_02']]) {
    const body = pendingCommand({event_id: date, request_id: id});
    const beforeDisplayedProof = await f.send('/request', {headers, body});
    assert.equal(beforeDisplayedProof.value.error, 'new_acknowledgment_required');
    const proof = {...headers, 'X-Respite-Acknowledgments': view.value.acknowledgment_proof};
    const created = await f.send('/request', {headers: proof, body});
    assert.equal(created.status, 201);
    assert.equal(created.value.status, 'pending');
    const replay = await f.send('/request', {headers: proof, body});
    assert.equal(replay.status, 200);
    assert.equal(replay.value.id, created.value.id);
  }
  assert.equal(f.raw.prepare('SELECT count(*) AS n FROM registration').get().n, 0);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM audit_log WHERE action='respite.request.pending'").get().n, 2);
  assert.equal((await f.send('', {headers})).value.requests.length, 2);
});

test('owner proof refuses session changes, foreign principals, invalid origin, stale acknowledgments and schema drift', async t => {
  const f = await setup(t);
  const {value: session} = await f.send('/session');
  const headers = {'X-Respite-Session': session.proof};
  assert.equal((await f.send('', {credential: await cookie('owner', Date.now() + 120000), headers})).status, 403);
  assert.equal((await f.send('/session', {credential: await cookie('foreign')})).status, 403);
  assert.equal((await f.send('/session', {credential: ''})).status, 401);
  assert.equal((await f.send('/session?unsafe=1')).status, 404);
  const participant = {request_id: 'respite_participant_01', details: participantDetails};
  assert.equal((await f.send('/participant', {headers: {...headers, Origin: 'null'}, body: participant})).status, 403);
  assert.equal((await f.send('/participant', {headers: {...headers, 'Content-Type': 'text/plain'}, body: participant})).status, 415);
  assert.equal((await f.send('/participant', {headers, rawBody: ' '.repeat(32769)})).status, 400);
  assert.equal((await f.send('/participant', {headers, body: {...participant, caregiver_id: 'foreign'}})).status, 400);
  const {value: view} = await f.send('', {headers});
  const ack = {...headers, 'X-Respite-Acknowledgments': view.acknowledgment_proof};
  const body = pendingCommand({acknowledgment_versions: {privacy: 'retired', nonmedical: 'retired'}});
  assert.equal((await f.send('/request', {headers: ack, body})).value.error, 'new_acknowledgment_required');
  assert.equal((await f.send('/participant', {headers, body: participant})).status, 201);
  f.raw.exec('CREATE TABLE respite_schema_drift(id)');
  assert.equal((await f.send('', {headers})).status, 503);
  assert.equal(f.raw.prepare('SELECT count(*) AS n FROM respite_request').get().n, 0);
});

test('flag and preview origin gate the trial and all human Staff grants use the pinned fixture', async t => {
  const f = await setup(t);
  f.env.PORTAL_RESPITE_TEST_ENABLED = '0';
  assert.equal((await f.send('/session')).status, 404);
  f.env.PORTAL_RESPITE_TEST_ENABLED = '1';
  assert.equal((await f.send('/session', {from: 'https://staging.legacy-hub-5qo.pages.dev'})).status, 404);
  f.env.ENVIRONMENT = 'production';
  assert.equal((await f.send('/session')).status, 404);
  f.env.ENVIRONMENT = 'preview';
  assert.equal((await f.send('/session', {path: staffRoute, verified: false})).status, 403);
  assert.equal((await f.send('/session', {path: staffRoute, actor: 'other@example.invalid'})).status, 403);
  const {value: session} = await f.send('/session', {path: staffRoute});
  const options = {path: staffRoute, headers: {'X-Respite-Session': session.proof}};
  assert.deepEqual((await f.send('', options)).value.requests, []);
  assert.equal((await f.send('/eligibility', {...options, body: {caregiver_id: 'foreign', revision: 0, enabled: true}})).status, 400);
  f.raw.exec("DELETE FROM caregiver_profile WHERE caregiver_id='owner'");
  assert.equal((await f.send('/session')).value.visible, false);
  assert.equal((await f.send('/eligibility', {...options, body: {caregiver_id: 'owner', revision: 0, enabled: true}})).status, 200);
  assert.equal((await f.send('/session')).value.visible, true);
  assert.equal((await f.send('/eligibility', {...options, body: {caregiver_id: 'owner', revision: 1, enabled: false}})).status, 200);
  assert.deepEqual((await f.send('/eligibility', options)).value, {ok: true, revision: 2, enabled: false});
  assert.equal((await f.send('/session')).value.visible, false);
  f.raw.exec("UPDATE staff_member SET status='deactivated'");
  assert.equal((await f.send('', options)).status, 403);
  f.raw.exec("UPDATE caregiver SET segment_tags='[\"qa_test\"]' WHERE id='owner'");
  assert.equal((await f.send('/session')).status, 403);
});
