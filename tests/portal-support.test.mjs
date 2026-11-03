// Synthetic Node/SQLite contract tests for My Support (LP-02 staged increment).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { onRequestGet as staffGet, onRequestPost as staffPost } from '../functions/api/staff/[[path]].js';
import { onRequestPost as legacyFollowupsPost } from '../functions/api/followups.js';
import {
  SHANELLE_DISPLAY_NAME,
  SHANELLE_STAFF_EMAIL,
  SUPPORT_BODY_MAX_BYTES,
  SUPPORT_CONTACT_PREFERENCES,
  SUPPORT_SOURCE,
  SUPPORT_TYPES,
  SUPPORT_URGENCY_OPTIONS,
  computeSupportExternalRef,
  handleStaffSupportMutation,
} from '../functions/_lib/portal-support.js';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequestPost as postIntake } from '../functions/api/intake.js';

const SCHEMA_0001 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_0003 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_0006 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');
const SCHEMA_0011 = readFileSync(new URL('../schema/0011_staff_member.sql', import.meta.url), 'utf8');

const ORIGIN = 'https://portal.example.test';
const SECRET = 'synthetic-support-test-secret';
const ID = '00112233-4455-4677-8899-aabbccddeeff';
const ID_2 = '11223344-5566-4788-99aa-bbccddeeff00';

let raw;
let env;

function d1(options = {}) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            async first() {
              return raw.prepare(sql).get(...params) ?? null;
            },
            async run() {
              const info = raw.prepare(sql).run(...params);
              return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
            },
            async all() {
              return { success: true, results: raw.prepare(sql).all(...params) };
            },
          };
        },
        async all() {
          return { success: true, results: raw.prepare(sql).all() };
        },
        async first() {
          return raw.prepare(sql).get() ?? null;
        },
      };
    },
    async batch(statements) {
      if (options.beforeBatch) await options.beforeBatch();
      raw.exec('BEGIN IMMEDIATE');
      let results;
      try {
        results = statements.map((s, i) => {
          if (options.failIndex === i) throw new Error('synthetic SQL failure: private detail');
          const rows = raw.prepare(s.sql).all(...(s.params || []));
          return {
            success: true,
            results: rows,
            meta: { changes: raw.prepare('SELECT changes() AS n').get().n },
          };
        });
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
      if (options.afterCommit) await options.afterCommit();
      return results;
    },
  };
}

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(SCHEMA_0001);
  raw.exec(SCHEMA_0003);
  raw.exec(SCHEMA_0006);
  raw.exec(SCHEMA_0011);
  raw
    .prepare('INSERT INTO caregiver (id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)')
    .run('cg_synthetic_a', 'Synthetic', 'Alpha', 'alpha@example.test', '(414) 555-0101');
  raw
    .prepare('INSERT INTO caregiver (id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)')
    .run('cg_synthetic_b', 'Synthetic', 'Beta', 'beta@example.test', '(414) 555-0102');
  raw
    .prepare("INSERT INTO staff_member (email, display_name, role, status) VALUES (?, ?, 'staff', 'active')")
    .run('coordinator@legacyhomehealthservices.org', 'Care Coordinator');
  raw
    .prepare("INSERT INTO staff_member (email, display_name, role, status) VALUES (?, ?, 'staff', 'deactivated')")
    .run('former@legacyhomehealthservices.org', 'Former Staff');
  env = { LEGACY_DB: d1(), PORTAL_TOKEN_SECRET: SECRET };
});

afterEach(() => raw.close());

async function cookieFor(owner = 'cg_synthetic_a', expiry = Date.now() + 60_000) {
  const payload = `${owner}:${expiry}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${payload}`))
  );
  const sig = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `portal_session=${encodeURIComponent(`${payload}:${sig}`)}`;
}

function staffJwt(email) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function defaultPayload(overrides = {}) {
  return {
    request_id: ID,
    support_type: 'respite_services',
    urgency: 'as_soon_as_possible',
    contact_preference: 'phone_call',
    detail: 'Looking for weekday afternoon respite options.',
    ...overrides,
  };
}

async function buildPostRequest(options = {}) {
  const headers = new Headers({
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    'Sec-Fetch-Site': 'same-origin',
    Cookie: await cookieFor(options.owner, options.expiry),
  });
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  const body = options.rawBody ?? JSON.stringify(options.body ?? defaultPayload());
  return new Request(`${ORIGIN}${options.path || '/api/portal/support'}`, {
    method: 'POST',
    headers,
    body,
  });
}

async function submit(options = {}, useEnv = env) {
  return onRequestPost({ request: await buildPostRequest(options), env: useEnv });
}

async function getSupport(options = {}, useEnv = env) {
  const headers = new Headers({
    Cookie: await cookieFor(options.owner, options.expiry),
  });
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  const query = options.query ? `?${options.query}` : '';
  const req = new Request(`${ORIGIN}${options.path || '/api/portal/support'}${query}`, {
    method: 'GET',
    headers,
  });
  return onRequestGet({ request: req, env: useEnv });
}

function counts() {
  return {
    tasks: raw.prepare("SELECT COUNT(*) AS n FROM followup WHERE source = 'portal_support_v1'").get().n,
    audits: raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.support_requested'").get().n,
    caregivers: raw.prepare("SELECT COUNT(*) AS n FROM caregiver WHERE id IN ('cg_synthetic_a', 'cg_synthetic_b')").get().n,
  };
}

function empty() {
  assert.deepEqual(counts(), { tasks: 0, audits: 0, caregivers: 2 });
}

test('authenticated submit saves structured request, returns truthful receipt, and preserves profile email/phone', async () => {
  const res = await submit({
    body: defaultPayload({
      contact_preference: 'email',
      contact_email: 'override-alpha@example.test',
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.request.request_id, ID);
  assert.equal(body.request.support_type, 'respite_services');
  assert.equal(body.request.support_type_label, 'Respite Services');
  assert.equal(body.request.urgency, 'as_soon_as_possible');
  assert.equal(body.request.urgency_label, 'As soon as possible');
  assert.equal(body.request.contact_preference, 'email');
  assert.equal(body.request.contact_preference_label, 'Email');
  assert.equal(body.request.status, 'received');
  assert.equal(body.request.status_label, 'Received');
  assert.equal(body.request.detail, 'Looking for weekday afternoon respite options.');
  assert.ok(body.request.submitted_at);
  assert.equal(body.request.last_status_updated_at, body.request.submitted_at);
  // Internal staff fields must never leak in caregiver receipt
  assert.equal(body.request.assigned_to, undefined);
  assert.equal(body.request.contact_email, undefined);
  assert.equal(body.request.private_notes, undefined);

  // Sign-in profile email must NOT be overwritten by request-specific contact override
  const cg = raw.prepare('SELECT email, phone FROM caregiver WHERE id = ?').get('cg_synthetic_a');
  assert.equal(cg.email, 'alpha@example.test');
  assert.equal(cg.phone, '(414) 555-0101');
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
});

test('all 8 support types, 3 urgency options, and 3 contact preferences work without external provider sends', async () => {
  for (const key of ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'PORTAL_DEV_RETURN_LINK']) {
    Object.defineProperty(env, key, {
      configurable: true,
      get() {
        throw new Error('provider configuration must not be read');
      },
    });
  }

  let index = 0;
  for (const st of SUPPORT_TYPES) {
    const urg = SUPPORT_URGENCY_OPTIONS[index % SUPPORT_URGENCY_OPTIONS.length];
    const pref = SUPPORT_CONTACT_PREFERENCES[index % SUPPORT_CONTACT_PREFERENCES.length];
    const reqId = `00112233-4455-4677-8899-aabbccddeef${index.toString(16)}`;
    const res = await submit({
      body: {
        request_id: reqId,
        support_type: index % 2 === 0 ? st.code : st.label,
        urgency: index % 2 === 0 ? urg.code : urg.label,
        contact_preference: index % 2 === 0 ? pref.code : pref.label,
      },
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.request.support_type, st.code);
    assert.equal(data.request.support_type_label, st.label);
    assert.equal(data.request.urgency, urg.code);
    assert.equal(data.request.contact_preference, pref.code);
    index += 1;
  }
  assert.equal(counts().tasks, 8);
  assert.equal(counts().audits, 8);
});

test('same-caregiver retry creates exactly one request/followup/audit; changed retry refuses with 409; second caregiver cannot read or collide', async () => {
  const first = await submit();
  assert.equal(first.status, 201);
  const firstData = await first.json();

  // Exact retry (including uppercase UUID variant) returns identical receipt without extra rows
  const retry = await submit({ body: defaultPayload({ request_id: ID.toUpperCase() }) });
  assert.equal(retry.status, 201);
  const retryData = await retry.json();
  assert.deepEqual(retryData, firstData);
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });

  // Changed-payload retry with same request_id refuses with 409 and does NOT overwrite
  const changed = await submit({
    body: defaultPayload({ support_type: 'other', detail: 'Attempted overwrite' }),
  });
  assert.equal(changed.status, 409);
  assert.deepEqual(await changed.json(), { ok: false, error: 'request_id_conflict' });
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });

  // Caregiver B cannot read Caregiver A's request by request_id or in list history
  const bReadA = await getSupport({ owner: 'cg_synthetic_b', query: `request_id=${ID}` });
  assert.equal(bReadA.status, 404);
  const bList = await getSupport({ owner: 'cg_synthetic_b' });
  assert.equal(bList.status, 200);
  assert.deepEqual((await bList.json()).requests, []);

  // Caregiver A reads own request by request_id and in list history
  const aRead = await getSupport({ owner: 'cg_synthetic_a', query: `request_id=${ID}` });
  assert.equal(aRead.status, 200);
  assert.deepEqual((await aRead.json()).request, firstData.request);

  // Caregiver B submitting the same UUID creates a separate request for B without disclosing A
  const bSubmit = await submit({
    owner: 'cg_synthetic_b',
    body: defaultPayload({ support_type: 'programs_events', detail: 'Beta request' }),
  });
  assert.equal(bSubmit.status, 201);
  assert.deepEqual(counts(), { tasks: 2, audits: 2, caregivers: 2 });

  const aListAfter = await (await getSupport({ owner: 'cg_synthetic_a' })).json();
  const bListAfter = await (await getSupport({ owner: 'cg_synthetic_b' })).json();
  assert.equal(aListAfter.requests.length, 1);
  assert.equal(aListAfter.requests[0].support_type, 'respite_services');
  assert.equal(bListAfter.requests.length, 1);
  assert.equal(bListAfter.requests[0].support_type, 'programs_events');
});

test('Shanelle Staff-queue handoff, lifecycle transitions (Received -> In Progress -> Completed), active reassignment, concurrency & private notes', async () => {
  const created = await (await submit({ body: defaultPayload({ request_id: ID }) })).json();
  assert.equal(created.request.status, 'received');

  // 1. Staff queue shows the new item assigned to Shanelle and increments shanelle_support_inbox_count
  const queueRes = await staffGet({
    request: new Request(`${ORIGIN}/api/staff/queue`, {
      headers: { 'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL) },
    }),
    env,
  });
  assert.equal(queueRes.status, 200);
  const queueData = await queueRes.json();
  assert.equal(queueData.shanelle_support_inbox_count, 1);
  assert.equal(queueData.queue.length, 1);
  const followupId = queueData.queue[0].id;
  assert.equal(queueData.queue[0].support_request.request_id, ID);
  assert.equal(queueData.queue[0].support_request.assigned_to, SHANELLE_STAFF_EMAIL);
  assert.equal(queueData.queue[0].support_request.assigned_to_name, SHANELLE_DISPLAY_NAME);
  assert.equal(queueData.queue[0].support_request.status, 'received');
  assert.equal(queueData.queue[0].support_request.version, 1);

  // 2. Unauthorized/fallback/deactivated/x-dev-actor Staff actors are refused
  for (const badHeaders of [
    { 'Cf-Access-Jwt-Assertion': staffJwt('former@legacyhomehealthservices.org') },
    { 'Cf-Access-Jwt-Assertion': staffJwt('unknown@example.test') },
    { 'x-dev-actor': SHANELLE_STAFF_EMAIL },
    {},
  ]) {
    const denied = await staffPost({
      request: new Request(`${ORIGIN}/api/staff/followup/${followupId}/support`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...badHeaders,
        },
        body: JSON.stringify({ status: 'in_progress', expected_version: 1 }),
      }),
      env: { ...env, ALLOW_DEV_CONSOLE: '1' },
    });
    assert.equal(denied.status, 403);
  }

  // 3. Inactive or unknown assignee is refused
  for (const badAssignee of ['former@legacyhomehealthservices.org', 'nobody@example.test']) {
    const badAssignRes = await staffPost({
      request: new Request(`${ORIGIN}/api/staff/followup/${followupId}/support`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL),
        },
        body: JSON.stringify({ assigned_to: badAssignee, expected_version: 1 }),
      }),
      env,
    });
    assert.equal(badAssignRes.status, 400);
  }

  // 4. Shanelle transitions request to In Progress, reassigns to active Care Coordinator, and adds a private note
  const inProgRes = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/${followupId}/support`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL),
      },
      body: JSON.stringify({
        status: 'in_progress',
        assigned_to: 'coordinator@legacyhomehealthservices.org',
        expected_version: 1,
        note: 'Internal staff triage note: called caregiver and scheduled respite intake.',
      }),
    }),
    env,
  });
  assert.equal(inProgRes.status, 200);
  const inProgData = await inProgRes.json();
  assert.equal(inProgData.support_request.status, 'in_progress');
  assert.equal(inProgData.support_request.status_label, 'In Progress');
  assert.equal(inProgData.support_request.assigned_to, 'coordinator@legacyhomehealthservices.org');
  assert.equal(inProgData.support_request.assigned_to_name, 'Care Coordinator');
  assert.equal(inProgData.support_request.version, 2);
  assert.equal(inProgData.support_request.private_notes.length, 1);

  // 5. Stale expected_version refuses with 409 without mutating state
  const staleRes = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/${followupId}/support`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt('coordinator@legacyhomehealthservices.org'),
      },
      body: JSON.stringify({ status: 'completed', expected_version: 1 }),
    }),
    env,
  });
  assert.equal(staleRes.status, 409);

  // 6. Legacy /api/followups POST and Staff resolve 'dismissed' cannot bypass managed lifecycle
  const legacyBypass = await legacyFollowupsPost({
    request: new Request(`${ORIGIN}/api/followups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: followupId, status: 'dismissed' }),
    }),
    env,
  });
  assert.equal(legacyBypass.status, 409);

  const dismissBypass = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/${followupId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt('coordinator@legacyhomehealthservices.org'),
      },
      body: JSON.stringify({ status: 'dismissed' }),
    }),
    env,
  });
  assert.equal(dismissBypass.status, 409);

  // 7. Caregiver history sees In Progress status, never sees private note body or internal fields
  const memberInProgRaw = await (await getSupport({ owner: 'cg_synthetic_a' })).text();
  assert.ok(!memberInProgRaw.includes('Internal staff triage note'));
  assert.ok(!memberInProgRaw.includes('coordinator@legacyhomehealthservices.org'));
  const memberInProg = JSON.parse(memberInProgRaw);
  assert.equal(memberInProg.requests[0].status, 'in_progress');
  assert.equal(memberInProg.requests[0].status_label, 'In Progress');

  // 8. Care Coordinator transitions request to Completed; queue closes item while caregiver history retains it
  const completeRes = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/${followupId}/support`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt('coordinator@legacyhomehealthservices.org'),
      },
      body: JSON.stringify({ status: 'completed', expected_version: 2 }),
    }),
    env,
  });
  assert.equal(completeRes.status, 200);
  const completeData = await completeRes.json();
  assert.equal(completeData.support_request.status, 'completed');
  assert.equal(completeData.support_request.version, 3);

  const queueAfter = await (
    await staffGet({
      request: new Request(`${ORIGIN}/api/staff/queue`, {
        headers: { 'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL) },
      }),
      env,
    })
  ).json();
  assert.equal(queueAfter.queue.length, 0);
  assert.equal(queueAfter.shanelle_support_inbox_count, 0);

  // Caregiver history retains Completed request; Staff caregiver detail retains full reporting & notes
  const memberCompleted = await (await getSupport({ owner: 'cg_synthetic_a' })).json();
  assert.equal(memberCompleted.requests.length, 1);
  assert.equal(memberCompleted.requests[0].status, 'completed');
  assert.equal(memberCompleted.requests[0].status_label, 'Completed');

  const cgDetail = await (
    await staffGet({
      request: new Request(`${ORIGIN}/api/staff/caregiver/cg_synthetic_a`, {
        headers: { 'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL) },
      }),
      env,
    })
  ).json();
  assert.equal(cgDetail.followups.length, 1);
  assert.equal(cgDetail.followups[0].support_request.status, 'completed');
  assert.equal(cgDetail.followups[0].support_request.private_notes.length, 1);
  assert.equal(cgDetail.followups[0].support_request.reporting_history.length, 4);
});

test('public intake cannot occupy the signed support namespace, and legacy namespace pollution is refused', async () => {
  const externalRef = await computeSupportExternalRef('cg_synthetic_a', ID);
  const body = {
    kind: 'support_request',
    first_name: 'Synthetic A',
    email: 'alpha@example.test',
    source: SUPPORT_SOURCE,
    external_ref: externalRef,
    message: 'Synthetic intake text',
  };
  const denied = await postIntake({
    env,
    request: new Request(`${ORIGIN}/api/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  assert.equal(denied.status, 400);
  assert.equal(counts().tasks, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.support_requested'").get().n, 0);

  const directDenied = await handleIntake(
    {
      prepare() {
        throw new Error('must not read or mutate');
      },
    },
    body
  );
  assert.equal(directDenied.status, 400);

  // Pre-existing polluted row without original portal audit is refused without adoption
  raw
    .prepare('INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, ?, ?, ?, ?)')
    .run('cg_synthetic_a', 'support_request', 'Untrusted detail', SUPPORT_SOURCE, externalRef);
  assert.equal((await submit()).status, 404);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.support_requested'").get().n, 0);
});

test('preview containment, expired/archived/missing session, CSRF Origin, and invalid enums/bodies are refused', async () => {
  // 1. Preview containment (503 preview_portal_disabled)
  assert.equal((await submit({}, { ...env, ENVIRONMENT: 'preview' })).status, 503);
  assert.equal((await getSupport({}, { ...env, ENVIRONMENT: 'preview' })).status, 503);

  // 2. Expired or missing session (401)
  assert.equal((await submit({ expiry: Date.now() - 1000 })).status, 401);
  assert.equal((await getSupport({ expiry: Date.now() - 1000 })).status, 401);
  assert.equal((await submit({ headers: { Cookie: null } })).status, 401);

  // 3. Archived caregiver refuses
  raw.prepare("UPDATE caregiver SET status = 'archived' WHERE id = 'cg_synthetic_a'").run();
  assert.equal((await submit()).status, 404);
  assert.equal((await getSupport()).status, 401);
  raw.prepare("UPDATE caregiver SET status = 'active' WHERE id = 'cg_synthetic_a'").run();

  // 4. CSRF Origin and Sec-Fetch-Site checks
  assert.equal((await submit({ headers: { Origin: null } })).status, 403);
  assert.equal((await submit({ headers: { Origin: 'null' } })).status, 403);
  assert.equal((await submit({ headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await submit({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);

  // 5. Invalid enum / unknown field / oversized body refusal
  assert.equal((await submit({ body: defaultPayload({ support_type: 'invalid_type' }) })).status, 400);
  assert.equal((await submit({ body: defaultPayload({ urgency: 'right_now' }) })).status, 400);
  assert.equal((await submit({ body: defaultPayload({ contact_preference: 'fax' }) })).status, 400);
  assert.equal((await submit({ body: { ...defaultPayload(), caregiver_id: 'cg_synthetic_b' } })).status, 400);
  assert.equal((await submit({ rawBody: ' '.repeat(SUPPORT_BODY_MAX_BYTES + 1) })).status, 413);
  empty();
});

for (const failIndex of [0, 1, 2]) {
  test(`batch statement ${failIndex + 1} failure rolls back followup and audit`, async () => {
    env.LEGACY_DB = d1({ failIndex });
    const res = await submit();
    assert.equal(res.status, 503);
    empty();
    env.LEGACY_DB = d1();
    assert.equal((await submit()).status, 201);
    assert.equal(counts().tasks, 1);
    assert.equal(counts().audits, 1);
  });
}

test('lost acknowledgement after committed batch retries same request_id idempotently without duplicate', async () => {
  env.LEGACY_DB = d1({
    afterCommit() {
      throw new Error('synthetic lost response');
    },
  });
  assert.equal((await submit({ body: defaultPayload({ request_id: ID_2 }) })).status, 503);
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });

  env.LEGACY_DB = d1();
  const retry = await submit({ body: defaultPayload({ request_id: ID_2 }) });
  assert.equal(retry.status, 201);
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
});

test('fences canonical request version inside db.batch on concurrent same-state updates and requires expected_version on resolve', async () => {
  assert.equal((await submit()).status, 201);

  let raced = false;
  const racingDb = d1({
    async beforeBatch() {
      if (raced) return;
      raced = true;
      const winner = await handleStaffSupportMutation(d1(), SHANELLE_STAFF_EMAIL, 1, {
        status: 'received',
        expected_version: 1,
      });
      assert.equal(winner.ok, true);
      assert.equal(winner.support_request.version, 2);
    },
  });

  const stale = await handleStaffSupportMutation(racingDb, SHANELLE_STAFF_EMAIL, 1, {
    status: 'received',
    expected_version: 1,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(stale.error, 'version_conflict');

  const audits = raw
    .prepare("SELECT id, after_json FROM audit_log WHERE action = 'staff.support_request_updated' ORDER BY id")
    .all();
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0].after_json).version, 2);

  // Resolve endpoint requires expected_version for managed portal_support_v1 rows
  const missingVersionRes = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL),
      },
      body: JSON.stringify({ status: 'done' }),
    }),
    env,
  });
  assert.equal(missingVersionRes.status, 400);
  assert.equal((await missingVersionRes.json()).error, 'expected_version_required');

  const staleResolveRes = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL),
      },
      body: JSON.stringify({ status: 'done', expected_version: 1 }),
    }),
    env,
  });
  assert.equal(staleResolveRes.status, 409);
  assert.equal((await staleResolveRes.json()).error, 'version_conflict');

  const validResolveRes = await staffPost({
    request: new Request(`${ORIGIN}/api/staff/followup/1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL),
      },
      body: JSON.stringify({ status: 'done', expected_version: 2 }),
    }),
    env,
  });
  assert.equal(validResolveRes.status, 200);
  const validResolveBody = await validResolveRes.json();
  assert.equal(validResolveBody.support_request.status, 'completed');
  assert.equal(validResolveBody.support_request.version, 3);
});

test('prevents partial note or note-audit writes when concurrent lifecycle compare loses', async () => {
  assert.equal((await submit()).status, 201);

  let raced = false;
  const racingDb = d1({
    async beforeBatch() {
      if (raced) return;
      raced = true;
      const winner = await handleStaffSupportMutation(d1(), SHANELLE_STAFF_EMAIL, 1, {
        status: 'in_progress',
        expected_version: 1,
      });
      assert.equal(winner.ok, true);
    },
  });

  const loser = await handleStaffSupportMutation(racingDb, SHANELLE_STAFF_EMAIL, 1, {
    status: 'in_progress',
    expected_version: 1,
    note: 'should not persist on stale version',
  });
  assert.equal(loser.ok, false);
  assert.equal(loser.status, 409);
  assert.equal(loser.error, 'version_conflict');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM note').get().n, 0);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'staff.support_request_note'").get().n,
    0
  );
});

test('app.js preserves unresolved request_id across member edits and cancel/reopen, retains reference on 409 when GET fails or lacks matching receipt, and reconciles later without an extra POST', async () => {
  const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = code.indexOf('/* ---------- Portal: My Support requests');
  const end = code.indexOf("document.addEventListener('click'", start);
  const els = {
    portalSupportForm: { classList: { add() {}, remove() {} }, reset() {} },
    portalSupportBtn: { classList: { add() {}, remove() {} } },
    portalSupportMsg: { textContent: '' },
    portalSupportSubmitBtn: { disabled: false },
    portalSupportType: { value: 'respite_services' },
    portalSupportUrgency: { value: 'next_few_days' },
    portalSupportContactPref: { value: 'phone_call' },
    portalSupportEmail: { value: 'alpha@example.test' },
    portalSupportPhone: { value: '(414) 555-0101' },
    portalSupportDetail: { value: 'Initial note' },
    portalSupportHistory: { open: false },
    portalSupportHistoryRows: { textContent: '', appendChild() {} },
  };
  let seq = 0;
  const posted = [];
  let postMode = 'timeout_then_201';
  let getMode = 'match_latest';
  const ctx = vm.createContext({
    console,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-00000000000${++seq}` },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({ className: '', textContent: '', appendChild() {} }),
      createTextNode: () => ({}),
    },
    fetch: async (_url, opts = {}) => {
      if (opts.method === 'POST') {
        posted.push(JSON.parse(opts.body));
        if (postMode === 'timeout_then_201') {
          if (posted.length === 1) throw new Error('network timeout after server may have committed');
          return {
            ok: true,
            status: 201,
            async json() {
              return { ok: true, request: { support_type_label: 'Respite Services', status_label: 'Received' } };
            },
          };
        }
        if (postMode === 'timeout_then_409') {
          if (posted.length === 3) throw new Error('network timeout after server committed');
          return {
            ok: false,
            status: 409,
            async json() {
              return { ok: false, error: 'request_id_conflict' };
            },
          };
        }
      }
      if (getMode === 'fail') {
        throw new Error('history temporarily unavailable');
      }
      if (getMode === 'missing_receipt') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              requests: [
                {
                  request_id: '00000000-0000-4000-8000-000000000099',
                  support_type_label: 'Other',
                  status: 'received',
                  status_label: 'Received',
                },
              ],
            };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            requests: [
              {
                request_id: posted.at(-1)?.request_id,
                support_type_label: 'Respite Services',
                status: 'received',
                status_label: 'Received',
              },
            ],
          };
        },
      };
    },
  });
  vm.runInContext(
    code.slice(start, end) +
      ';globalThis.getPendingRequest=()=>portalSupportPendingRequest ? { ...portalSupportPendingRequest } : null;',
    ctx
  );

  // 1. Unknown outcome -> edit field -> cancel/reopen -> retry reuses exact same request_id
  await ctx.submitPortalSupport({ preventDefault() {} });
  els.portalSupportDetail.value = 'Edited note after unknown save';
  ctx.closePortalSupportForm();
  ctx.openPortalSupportForm();
  await ctx.submitPortalSupport({ preventDefault() {} });
  assert.equal(posted.length, 2);
  assert.equal(posted[0].request_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(posted[1].request_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(ctx.getPendingRequest(), null);

  // 2. Unknown save -> edited retry returns 409 request_id_conflict while owner-scoped GET fails:
  //    pending request reference is retained and feedback does NOT falsely claim receipt is shown in history.
  postMode = 'timeout_then_409';
  getMode = 'fail';
  els.portalSupportDetail.value = 'Second request initial note';
  await ctx.submitPortalSupport({ preventDefault() {} });
  assert.equal(posted.length, 3);
  assert.equal(posted[2].request_id, '00000000-0000-4000-8000-000000000002');
  els.portalSupportDetail.value = 'Second request edited after server already saved';
  await ctx.submitPortalSupport({ preventDefault() {} });
  assert.equal(posted.length, 4);
  assert.equal(posted[3].request_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(ctx.getPendingRequest()?.requestId, '00000000-0000-4000-8000-000000000002');
  assert.equal(els.portalSupportHistoryRows.textContent, 'Your support requests are not available right now.');
  assert.match(els.portalSupportMsg.textContent, /not available right now to confirm the saved receipt/);
  assert.doesNotMatch(els.portalSupportMsg.textContent, /shown in your history below/);

  // 3. Retry when owner-scoped GET succeeds (200) but lacks the matching receipt:
  //    pending request reference is still retained and feedback states matching receipt is not verified yet.
  getMode = 'missing_receipt';
  await ctx.submitPortalSupport({ preventDefault() {} });
  assert.equal(posted.length, 5);
  assert.equal(posted[4].request_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(ctx.getPendingRequest()?.requestId, '00000000-0000-4000-8000-000000000002');
  assert.match(els.portalSupportMsg.textContent, /could not verify a matching receipt/);
  assert.doesNotMatch(els.portalSupportMsg.textContent, /shown in your history below/);

  // 4. Later history load (loadPortalSupport) returns the matching owner-scoped receipt WITHOUT an extra POST:
  //    reconciles and clears the pending reference, and updates feedback to confirm the receipt is shown in history.
  getMode = 'match_latest';
  const reconciled = await ctx.loadPortalSupport();
  assert.equal(posted.length, 5);
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.matchedReceipt?.request_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(ctx.getPendingRequest(), null);
  assert.match(els.portalSupportMsg.textContent, /already saved and is shown in your history below/);
});

test('staff.js renders usable queue and caregiver-detail support triage controls and posts expected_version to /api/staff/followup/:id/support', async () => {
  assert.equal((await submit({ body: defaultPayload({ detail: 'Caregiver detail <script>alert(1)</script>' }) })).status, 201);

  const staffCode = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
  const slice = (from, to) => {
    const s = staffCode.indexOf(from);
    const e = staffCode.indexOf(to, s);
    assert.ok(s >= 0 && e > s, `slice ${from} .. ${to}`);
    return staffCode.slice(s, e);
  };

  const nodes = {
    needsAttentionCount: { textContent: '' },
    needsAttentionBody: { innerHTML: '' },
    needsAttentionMessage: { textContent: '', classList: { toggle() {} } },
    staffDashboardView: { classList: { add() {}, remove() {} } },
    caregiverDetailView: { classList: { add() {}, remove() {} } },
    caregiverBackButton: { focus() {} },
    caregiverDetailHeading: { focus() {} },
    caregiverRecordPanel: { innerHTML: '', dataset: {} },
    caregiverLifecycleMessage: { textContent: '', classList: { toggle() {} } },
  };
  const calls = [];
  const context = vm.createContext({
    console,
    URLSearchParams,
    encodeURIComponent,
    Number,
    Boolean,
    Array,
    Set,
    String,
    Object,
    JSON,
    Math,
    Date,
    Promise,
    currentCaregiverId: null,
    currentGrantId: null,
    currentSearchOffset: 0,
    noteNeedsAttentionActionable() {},
    searchCaregivers: async () => {},
    loadRecentChanges: async () => {},
    window: { scrollY: 0, scrollTo() {}, confirm: () => true },
    document: {
      activeElement: null,
      getElementById: (id) => nodes[id] || null,
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
      const req = new Request(`${ORIGIN}${url}`, {
        method: options.method || 'GET',
        headers: {
          ...(options.headers || {}),
          'Cf-Access-Jwt-Assertion': staffJwt(SHANELLE_STAFF_EMAIL),
        },
        body: options.body,
      });
      const res = (options.method || 'GET') === 'POST'
        ? await staffPost({ request: req, env })
        : await staffGet({ request: req, env });
      return {
        ok: res.ok,
        status: res.status,
        json: async () => res.json(),
      };
    },
  });

  vm.runInContext(slice('function escapeHtml(', 'function formatStatusLine('), context);
  vm.runInContext(slice('// Follow-ups: "Mark complete"', '// A focused caregiver view preserves'), context);
  vm.runInContext(slice('// A focused caregiver view', 'async function loadEvents('), context);

  // 1. Queue renders support metadata, Shanelle inbox count, Mark in progress, and Mark complete with version
  await context.loadFollowups();
  assert.equal(nodes.needsAttentionCount.textContent, '(1 open · 1 in Shanelle support inbox)');
  assert.match(nodes.needsAttentionBody.innerHTML, /Request ID: <code>00112233-4455-4677-8899-aabbccddeeff<\/code> · v1/);
  assert.match(nodes.needsAttentionBody.innerHTML, /Assigned: <strong>Shanelle Snowden<\/strong>/);
  assert.match(nodes.needsAttentionBody.innerHTML, /data-action="support-in-progress" data-followup-id="1" data-support-version="1"/);
  assert.match(nodes.needsAttentionBody.innerHTML, /data-action="resolve-followup" data-followup-id="1" data-support-version="1"/);
  assert.doesNotMatch(nodes.needsAttentionBody.innerHTML, /<script>/);

  // 2. Queue "Mark in progress" transitions via /api/staff/followup/1/support with expected_version: 1
  const inProgressBtn = {
    disabled: false,
    setAttribute() {},
    removeAttribute() {},
    closest: () => inProgressBtn,
  };
  await context.transitionSupportFollowup(1, 1, 'in_progress', {
    stopPropagation() {},
    target: inProgressBtn,
  });
  const supportPost1 = calls.find((c) => c.method === 'POST' && c.url === '/api/staff/followup/1/support');
  assert.deepEqual(supportPost1.body, { status: 'in_progress', expected_version: 1 });
  assert.match(nodes.needsAttentionBody.innerHTML, /v2 · Status: <strong>In Progress<\/strong>/);

  // 3. Caregiver detail view renders My Support Requests triage form, private notes, and reporting history
  await context.viewCaregiver('cg_synthetic_a');
  assert.match(nodes.caregiverRecordPanel.innerHTML, /My Support Requests:/);
  assert.match(nodes.caregiverRecordPanel.innerHTML, /data-action="submit-support-triage" data-followup-id="1" data-expected-version="2"/);
  assert.doesNotMatch(nodes.caregiverRecordPanel.innerHTML, /<script>/);

  // 4. Submitting the caregiver detail triage form reassigns, adds a request-linked private note, and completes
  const msgEl = { textContent: '', classList: { add() {}, remove() {} } };
  const submitBtn = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const triageForm = {
    getAttribute(attr) {
      if (attr === 'data-followup-id') return '1';
      if (attr === 'data-expected-version') return '2';
      return null;
    },
    querySelector(sel) {
      if (sel === '[name="expected_version"]') return { value: '2' };
      if (sel === '[name="status"]') return { value: 'completed' };
      if (sel === '[name="assigned_to"]') return { value: 'coordinator@legacyhomehealthservices.org' };
      if (sel === '[name="note"]') return { value: 'Spoke by phone and scheduled respite intake.' };
      if (sel === '.support-triage-msg') return msgEl;
      if (sel === 'button[type="submit"]') return submitBtn;
      return null;
    },
  };
  await context.submitStaffSupportTriage(triageForm);
  const triagePost = calls.filter((c) => c.method === 'POST' && c.url === '/api/staff/followup/1/support').at(-1);
  assert.deepEqual(triagePost.body, {
    expected_version: 2,
    status: 'completed',
    assigned_to: 'coordinator@legacyhomehealthservices.org',
    note: 'Spoke by phone and scheduled respite intake.',
  });
  assert.match(nodes.caregiverRecordPanel.innerHTML, /v3/);
  assert.match(nodes.caregiverRecordPanel.innerHTML, /Spoke by phone and scheduled respite intake\./);
  assert.match(nodes.caregiverRecordPanel.innerHTML, /staff\.support_request_note/);

  // 5. Submitting a stale version surfaces inline refusal feedback in .support-triage-msg
  await context.submitStaffSupportTriage(triageForm);
  assert.match(msgEl.textContent, /Could not save support triage: version_conflict/);
});
