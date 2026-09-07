// Which routes the Access guard actually covers.
//
// console-auth.test.mjs proves the JWT verification is correct. It does NOT prove the
// guard is applied to the right paths, and on 2026-09-06 it was not: /api/registrations,
// /api/followups and /api/grants were reachable anonymously in production while every
// console-auth test passed. A green suite that only exercises the guarded path is how a
// leak on the default path stays invisible -- so this file asserts the routing decision
// itself, from the outside, with Access unconfigured (the fail-closed production state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

// Endpoints that return or mutate data spanning multiple caregivers.
const MUST_BE_GUARDED = [
  '/staff.html',
  '/api/staff/registrations',
  '/api/agent/edit',
  '/api/registrations',
  '/api/registrations?event_id=1',
  '/api/followups',
  '/api/grants',
  '/api/grants/1001',
];

// Public or self-authenticating by design.
const MUST_STAY_REACHABLE = [
  '/api/intake',      // a caregiver submitting their own details
  '/api/portal/me',   // enforces its own signed portal_session cookie
  '/api/portal/login',
  '/api/events',      // public listing, no personal data
  '/api/health',
  '/index.html',
];

async function statusFor(path, env = {}) {
  const request = new Request('https://legacy-hub.pages.dev' + path);
  const next = async () => new Response('handler', { status: 200 });
  const resp = await onRequest({ request, next, env });
  return resp.status;
}

test('back-office routes fail closed when Access is not configured', async () => {
  for (const path of MUST_BE_GUARDED) {
    assert.equal(await statusFor(path), 403,
      `${path} must be guarded, but it reached its handler`);
  }
});

test('public and self-authenticating routes are not blocked', async () => {
  for (const path of MUST_STAY_REACHABLE) {
    assert.equal(await statusFor(path), 200,
      `${path} must stay reachable, but the guard blocked it`);
  }
});

test('a lookalike path does not inherit a guard it should not have', async () => {
  // '/api/grants' must not be widened into guarding '/api/grants-public'.
  assert.equal(await statusFor('/api/grants-public'), 200);
});

test('guarded routes still fail closed when only one Access variable is set', async () => {
  assert.equal(await statusFor('/api/grants', { CF_ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com' }), 403);
  assert.equal(await statusFor('/api/grants', { CF_ACCESS_AUD: 'aud' }), 403);
});

test('security headers are present on a public response', async () => {
  const request = new Request('https://legacy-hub.pages.dev/index.html');
  const next = async () => new Response('ok', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });
  assert.equal(resp.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(resp.headers.get('X-Content-Type-Options'), 'nosniff');
});
