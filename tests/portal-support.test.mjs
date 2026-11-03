// Synthetic Node/SQLite contract tests for My Support (LP-02 staged increment).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
