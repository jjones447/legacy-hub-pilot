import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

test('security headers on public page response', async () => {
  const request = new Request('https://legacy-hub.pages.dev/index.html');
  const next = async () => new Response('public ok', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });

  assert.equal(resp.status, 200);
  assert.equal(
    resp.headers.get('Content-Security-Policy'),
    EXPECTED_CSP,
  );
  assert.equal(resp.headers.get('Content-Security-Policy-Report-Only'), null);
  assert.equal(
    resp.headers.get('Strict-Transport-Security'),
    'max-age=31536000; includeSubDomains',
  );
  assert.equal(resp.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(resp.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(resp.headers.get('Referrer-Policy'), 'no-referrer');
});

test('security headers on console response via non-prod escape', async () => {
  const request = new Request('https://legacy-hub.pages.dev/staff.html');
  const next = async () => new Response('console ok', { status: 200 });
  const resp = await onRequest({
    request,
    next,
    env: { ALLOW_DEV_CONSOLE: '1' },
  });

  assert.equal(resp.status, 200);
  assert.equal(
    resp.headers.get('Content-Security-Policy'),
    EXPECTED_CSP,
  );
  assert.equal(resp.headers.get('Content-Security-Policy-Report-Only'), null);
  assert.equal(
    resp.headers.get('Strict-Transport-Security'),
    'max-age=31536000; includeSubDomains',
  );
  assert.equal(resp.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(resp.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(resp.headers.get('Referrer-Policy'), 'no-referrer');
});

test('security headers on fail-closed 403 response', async () => {
  const request = new Request('https://legacy-hub.pages.dev/staff.html');
  const next = async () => new Response('unreachable', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });

  assert.equal(resp.status, 403);
  assert.equal(
    resp.headers.get('Content-Security-Policy'),
    EXPECTED_CSP,
  );
  assert.equal(resp.headers.get('Content-Security-Policy-Report-Only'), null);
  assert.equal(
    resp.headers.get('Strict-Transport-Security'),
    'max-age=31536000; includeSubDomains',
  );
  assert.equal(resp.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(resp.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(resp.headers.get('Referrer-Policy'), 'no-referrer');
});
