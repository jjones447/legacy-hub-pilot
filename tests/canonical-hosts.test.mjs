import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

test('known public provider aliases send human page visits to the matching canonical environment', async () => {
  for (const [host, expected] of [['legacy-hub-5qo.pages.dev', 'caregiversanctuary.org'], ['staging.legacy-hub-5qo.pages.dev', 'staging.caregiversanctuary.org']]) {
    for (const path of ['/', '/staff', '/portal?view=events', '/programs.html']) {
      const response = await onRequest({ request: new Request(`https://${host}${path}`), env: {}, next() { throw Error('Do not serve duplicate page'); } });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('Location'), `https://${expected}${path}`);
      assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    }
  }
});

test('webhooks, assets, canonical hosts and deployment-specific previews keep their existing routes', async () => {
  for (const [host, path, method] of [
    ['legacy-hub-5qo.pages.dev', '/api/webhooks/givebutter', 'POST'],
    ['legacy-hub-5qo.pages.dev', '/api/health', 'GET'],
    ['legacy-hub-5qo.pages.dev', '/app.js', 'GET'],
    ['caregiversanctuary.org', '/', 'GET'],
    ['staging.caregiversanctuary.org', '/', 'GET'],
    ['abc123.legacy-hub-5qo.pages.dev', '/', 'GET'],
  ]) {
    const response = await onRequest({ request: new Request(`https://${host}${path}`, { method }), env: {}, next: async () => new Response('existing route') });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Location'), null);
  }
});

test('origin-bound draft preview remains guarded and is not redirected', async () => {
  const response = await onRequest({ request: new Request('https://staging.legacy-hub-5qo.pages.dev/?preview_draft=example'), env: {}, next() { throw Error('must stay guarded'); } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Location'), null);
});
