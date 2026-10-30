import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { onRequestGet as portalGet, onRequestHead as portalHead } from '../functions/api/portal/[[path]].js';

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const CONFIRMATION_CSP = "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

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

test('staging hostname gets X-Robots-Tag noindex,nofollow', async () => {
  // LEGACY-STAGING-NOINDEX-R1: the staging preview branch must never be indexed.
  const request = new Request('https://staging.caregiversanctuary.org/index.html');
  const next = async () => new Response('public ok', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('production hostname does NOT get X-Robots-Tag', async () => {
  const request = new Request('https://www.caregiversanctuary.org/index.html');
  const next = async () => new Response('public ok', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('X-Robots-Tag'), null);
});

test('pages.dev alias gets X-Robots-Tag noindex,nofollow', async () => {
  const request = new Request('https://legacy-hub-5qo.pages.dev/index.html');
  const next = async () => new Response('public ok', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('Location'), 'https://caregiversanctuary.org/index.html');
  assert.equal(resp.headers.get('X-Robots-Tag'), 'noindex, nofollow');
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

test('js and css responses receive Cache-Control: no-cache, must-revalidate so zone proxy cannot apply 4h TTL', async () => {
  for (const assetPath of ['/app.js?v=92ea66804e5e', '/staff.js?v=3290cf839c52', '/styles.css?v=c33ec71a18bf']) {
    const request = new Request(`https://staging.caregiversanctuary.org${assetPath}`);
    const next = async () =>
      new Response('/* asset */', {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
      });
    const resp = await onRequest({ request, next, env: {} });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Cache-Control'), 'no-cache, must-revalidate');
  }
});

for (const method of ['GET', 'HEAD']) for (const suffix of ['', '/']) {
  test(`confirmation ${method}${suffix || ' canonical'} retains origin-only policy through actual middleware`, async () => {
    const request = new Request(`https://portal.synthetic.invalid/api/portal/verify${suffix}?token=synthetic-token`, { method });
    let databaseAccess = 0;
    const env = { PORTAL_TOKEN_SECRET: 'synthetic-confirmation-middleware-key',
      LEGACY_DB: { prepare() { databaseAccess++; throw new Error('No identity/token lookup on landing'); } } };
    const response = await onRequest({ env, request,
      next: () => (method === 'HEAD' ? portalHead : portalGet)({ env, request }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Content-Security-Policy'), CONFIRMATION_CSP);
    assert.equal(databaseAccess, 0);
    const html = await response.text();
    if (method === 'HEAD') {
      assert.equal(html, '');
      assert.equal(response.headers.get('Set-Cookie'), null);
    } else {
      assert.match(html, /<form method="post" action="\/api\/portal\/verify">/);
      assert.doesNotMatch(html, /no-referrer|<script|referrerpolicy=/);
      assert.doesNotMatch(response.headers.get('Set-Cookie'), /portal_session=/);
    }
  });
}

for (const [name, path, method, status, type, offered] of [
  ['other public page', '/portal.html', 'GET', 200, 'text/html', 'strict-origin'],
  ['different API', '/api/portal/me', 'GET', 200, 'text/html', 'strict-origin'],
  ['nested noncanonical path', '/api/portal/nested/verify', 'GET', 200, 'text/html', 'strict-origin'],
  ['confirmation POST', '/api/portal/verify', 'POST', 200, 'text/html', 'strict-origin'],
  ['confirmation error', '/api/portal/verify', 'GET', 400, 'text/html', 'strict-origin'],
  ['confirmation redirect', '/api/portal/verify', 'GET', 302, 'text/html', 'strict-origin'],
  ['confirmation JSON', '/api/portal/verify', 'GET', 200, 'application/json', 'strict-origin'],
  ['unsafe downstream policy', '/api/portal/verify', 'GET', 200, 'text/html', 'unsafe-url'],
  ['no downstream opt-in', '/api/portal/verify', 'GET', 200, 'text/html', ''],
]) test(`${name} cannot broaden the existing no-referrer policy`, async () => {
  const request = new Request(`https://portal.synthetic.invalid${path}?token=synthetic-token`, { method });
  const response = await onRequest({ request, env: {}, next: async () => new Response('synthetic', {
    status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store',
      'Content-Security-Policy': CONFIRMATION_CSP,
      ...(offered ? { 'Referrer-Policy': offered } : {}) },
  }) });
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Content-Security-Policy'), EXPECTED_CSP);
});

test('caller headers and incomplete downstream opt-in cannot select confirmation policy', async () => {
  for (const headers of [
    { 'Content-Type': 'text/html', 'Referrer-Policy': 'strict-origin', 'Cache-Control': 'no-store' },
    { 'Content-Type': 'text/html', 'Referrer-Policy': 'strict-origin', 'Content-Security-Policy': CONFIRMATION_CSP },
  ]) {
    const request = new Request('https://portal.synthetic.invalid/api/portal/verify', {
      headers: { 'Referrer-Policy': 'strict-origin', 'Content-Security-Policy': CONFIRMATION_CSP, 'Cache-Control': 'no-store' },
    });
    const response = await onRequest({ request, env: {}, next: async () => new Response('synthetic', { headers }) });
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(response.headers.get('Content-Security-Policy'), EXPECTED_CSP);
  }
});
