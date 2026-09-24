import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { internalError } from '../functions/_lib/errors.js';
import { onRequestGet as getEvents } from '../functions/api/events.js';
import { onRequestGet as getFollowups, onRequestPost as postFollowups } from '../functions/api/followups.js';
import { onRequestGet as getGrants, onRequestPost as postGrants } from '../functions/api/grants/[[path]].js';
import { onRequestGet as getRegistrations, onRequestPost as postRegistrations } from '../functions/api/registrations.js';
import { onRequestGet as getStaff, onRequestPost as postStaff, onRequestPatch as patchStaff } from '../functions/api/staff/[[path]].js';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { onRequestPost as postGivebutter } from '../functions/api/webhooks/givebutter.js';
import { onRequestPost as postSquare } from '../functions/api/webhooks/square.js';

const LEAK_SENTINEL = 'SQLITE_ERROR: table credentials_store does not exist near SELECT * FROM secrets';

const throwingDb = {
  prepare() {
    throw new Error(LEAK_SENTINEL);
  }
};

function mockRequest(urlStr, method = 'GET', body = null, headers = {}) {
  const normHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    normHeaders[k.toLowerCase()] = v;
  }
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body || {});
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        return normHeaders[name.toLowerCase()] || null;
      }
    },
    async json() {
      if (typeof body === 'string') return JSON.parse(body);
      return body || {};
    },
    async text() {
      return bodyText;
    }
  };
}

async function assertGenericInternalError(response) {
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('content-type'), 'application/json');
  const rawText = await response.text();
  assert.equal(rawText.includes(LEAK_SENTINEL), false, 'response body must not leak error text');
  assert.equal(rawText.includes('credentials_store'), false, 'response body must not leak SQL table name');
  assert.equal(rawText.includes('stack'), false, 'response body must not contain stack traces');

  const parsed = JSON.parse(rawText);
  assert.deepEqual(parsed, { ok: false, error: 'internal_error' });
}

test('functions/_lib/errors.js internalError returns generic response and logs server-side', async () => {
  let loggedRoute = null;
  let loggedError = null;
  const originalConsoleError = console.error;
  console.error = (msg, err) => {
    loggedRoute = msg;
    loggedError = err;
  };

  try {
    const testErr = new Error('simulated disk failure in database subsystem');
    const res = internalError('test/route', testErr);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { ok: false, error: 'internal_error' });
    assert.equal(loggedRoute, 'test/route failed');
    assert.equal(loggedError, testErr);
  } finally {
    console.error = originalConsoleError;
  }
});

test('functions/api/events.js handles unexpected database error with generic 500', async () => {
  const res = await getEvents({ env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(res);
});

test('functions/api/followups.js handles unexpected database error with generic 500 (GET and POST)', async () => {
  // GET /api/followups
  const resGet = await getFollowups({ env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resGet);

  // POST /api/followups
  const reqPost = mockRequest('http://localhost/api/followups', 'POST', { id: 1, status: 'done' });
  const resPost = await postFollowups({ request: reqPost, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resPost);
});

test('functions/api/grants/[[path]].js handles unexpected database error with generic 500 (GET and POST)', async () => {
  // GET /api/grants
  const reqGet = mockRequest('http://localhost/api/grants', 'GET');
  const resGet = await getGrants({ request: reqGet, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resGet);

  // POST /api/grants/1/review
  const reqPost = mockRequest('http://localhost/api/grants/1/review', 'POST', { notes: 'looking good' });
  const resPost = await postGrants({ request: reqPost, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resPost);
});

test('functions/api/registrations.js handles unexpected database error with generic 500 (GET and POST)', async () => {
  // GET /api/registrations
  const reqGet = mockRequest('http://localhost/api/registrations?event_id=ev_1', 'GET');
  const resGet = await getRegistrations({ request: reqGet, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resGet);

  // POST /api/registrations
  const reqPost = mockRequest('http://localhost/api/registrations', 'POST', { id: 1, status: 'attended' });
  const resPost = await postRegistrations({ request: reqPost, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resPost);
});

test('functions/api/staff/[[path]].js handles unexpected database error with generic 500 (GET, POST, PATCH)', async () => {
  // GET /api/staff/queue
  const reqGet = mockRequest('http://localhost/api/staff/queue', 'GET');
  const resGet = await getStaff({ request: reqGet, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resGet);

  // POST /api/staff/followup/1/resolve
  const reqPost = mockRequest('http://localhost/api/staff/followup/1/resolve', 'POST');
  const resPost = await postStaff({ request: reqPost, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resPost);

  // PATCH /api/staff/caregiver/cg_1
  const reqPatch = mockRequest('http://localhost/api/staff/caregiver/cg_1', 'PATCH', { first_name: 'Updated' });
  const resPatch = await patchStaff({ request: reqPatch, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resPatch);
});

test('functions/api/agent/[[path]].js handles unexpected database error with generic 500 (GET and POST)', async () => {
  // GET /api/agent/drafts
  const reqGet = mockRequest('http://localhost/api/agent/drafts', 'GET');
  const resGet = await getAgent({ request: reqGet, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resGet);

  // POST /api/agent/change/draft
  const reqPost = mockRequest('http://localhost/api/agent/change/draft', 'POST', {
    area: 'grant',
    target_id: 1,
    request: 'Update review notes'
  });
  const resPost = await postAgent({ request: reqPost, env: { LEGACY_DB: throwingDb } });
  await assertGenericInternalError(resPost);
});

test('functions/api/webhooks/givebutter.js handles unexpected database error with generic 500', async () => {
  const secret = 'test-givebutter-secret';
  const payload = JSON.stringify({ id: 'evt_gb_999', event: 'donation' });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const req = mockRequest('http://localhost/api/webhooks/givebutter', 'POST', payload, {
    Signature: signature
  });
  const env = {
    GIVEBUTTER_WEBHOOK_SECRET: secret,
    LEGACY_DB: throwingDb
  };

  const res = await postGivebutter({ request: req, env });
  await assertGenericInternalError(res);
});

test('functions/api/webhooks/square.js handles unexpected database error with generic 500', async () => {
  const secret = 'test-square-secret';
  const url = 'https://example.org/api/webhooks/square';
  const payload = JSON.stringify({
    event_id: 'sq_evt_999',
    type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'pay_999',
          buyer_email_address: 'caregiver@example.com',
          amount_money: { amount: 5000, currency: 'USD' }
        }
      }
    }
  });
  const signature = crypto.createHmac('sha256', secret).update(url + payload).digest('base64');

  const req = mockRequest(url, 'POST', payload, {
    'x-square-hmacsha256-signature': signature
  });
  const env = {
    SQUARE_WEBHOOK_SIGNATURE_KEY: secret,
    SQUARE_WEBHOOK_URL: url,
    LEGACY_DB: throwingDb
  };

  const res = await postSquare({ request: req, env });
  await assertGenericInternalError(res);
});

