import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/_middleware.js';
import { maybeRewriteContent, getPublishedSections, _resetContentCache, getHTMLRewriterClass } from '../functions/_content.mjs';
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const originalRewriter = globalThis.HTMLRewriter;
afterEach(() => { _resetContentCache(); if (originalRewriter === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = originalRewriter; });
const row = paragraph => ({ id: 'ps_home.journey', data: JSON.stringify({ paragraph }) });
const db = rows => ({ prepare: () => ({ all: async () => ({ results: rows }) }) });
const render = (env, path = '/') => maybeRewriteContent({ request: new Request('https://preview.invalid'+path), env }, new Response(source, { headers: { 'content-type': 'text/html', etag: 'static-asset', 'cache-control': 'public, max-age=3600' } }));
async function assertUnavailable(response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'Content is temporarily unavailable. Please try again later.');
}
for (const [name, env] of [
  ['missing binding', {}],
  ['invalid binding', { LEGACY_DB: {} }],
  ['query failure', { LEGACY_DB: { prepare() { throw Error('unavailable'); } } }],
  ['empty results', { LEGACY_DB: db([]) }],
  ['missing target row', { LEGACY_DB: db([{ id: 'ps_home.hero', data: '{"title":"Present"}' }]) }],
  ['malformed JSON', { LEGACY_DB: db([{ id: 'ps_home.journey', data: '{' }]) }],
  ...[{}, [], null, {paragraph: null}, {paragraph: 3}, {paragraph: []}, {paragraph: ''}, {paragraph: ' \n '}].map((data, i) => ['invalid target '+i, { LEGACY_DB: db([{ id: 'ps_home.journey', data: JSON.stringify(data) }]) }]),
]) {
  test('governed journey fails closed on '+name+' even with a warm stale cache', async () => {
    await getPublishedSections({ LEGACY_DB: db([row('Stale cached copy')]) });
    await assertUnavailable(await render(env));
  });
}
test('every public home alias requires published data; asset-marker detection also protects other aliases', async () => {
  for (const path of ['/', '/index', '/index.html', '/index/', '/other-alias']) await assertUnavailable(await render({}, path));
});
test('fresh published rows override static copy and later edits override a warm cache', async () => {
  let current = 'Old published';
  const binding = { prepare: () => ({ all: async () => ({ results: [row(current)] }) }) };
  for (const value of ['Old published', 'Approved published', 'Later human edit']) {
    current = value;
    const response = await render({ LEGACY_DB: binding });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null);
    const html = await response.text();
    assert.ok(html.includes('<p>'+value+'</p>'));
    assert.ok(!html.includes('Caring for someone living with dementia can change every part of life.'));
  }
  binding.prepare = () => { throw Error('later outage'); };
  await assertUnavailable(await render({ LEGACY_DB: binding }));
});
for (const failure of ['construction', 'stream', 'unvisited binding']) {
  test('governed response fails closed on rewrite '+failure, async () => {
    globalThis.HTMLRewriter = class {
      constructor() { if (failure === 'construction') throw Error('synthetic rewrite error'); }
      on() { return this; }
      transform(response) {
        if (failure === 'unvisited binding') return response;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(source)); controller.error(Error('late failure')); } }));
      }
    };
    await assertUnavailable(await render({ LEGACY_DB: db([row('Current human value')]) }));
  });
}
test('lazy provider-style rewriting is consumed before the governed response is returned', async () => {
  const Base = getHTMLRewriterClass();
  globalThis.HTMLRewriter = class {
    constructor() { this.base = new Base(); }
    on(...args) { this.base.on(...args); return this; }
    transform(response) {
      const base = this.base;
      return new Response(new ReadableStream({ async pull(controller) {
        try { const rewritten = await base.transform(response); controller.enqueue(new TextEncoder().encode(await rewritten.text())); controller.close(); }
        catch (error) { controller.error(error); }
      } }));
    }
  };
  const response = await render({ LEGACY_DB: db([row('Current published')]) });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes('<p>Current published</p>'));
});

test('public middleware preserves the unavailable response and its no-store policy', async () => {
  const response = await onRequest({ request: new Request('https://caregiversanctuary.org/'), env: {}, next: async () => new Response(source, { headers: { 'content-type': 'text/html' } }) });
  await assertUnavailable(response);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

// A correct byte-range of the source contains no binding marker, so the route
// fence must run before status/type passthrough, not infer safety from the slice.
const fragmentStart = source.indexOf('Caring for someone living with dementia');
const fragment = source.slice(fragmentStart, fragmentStart + 181);
for (const status of [206, 304, 204, 302, 404, 500]) {
  test('governed middleware refuses upstream status '+status+' without releasing source or cache validators', async () => {
    for (const path of ['/', '/index', '/index.html', '/index/', '/%69ndex.html']) {
      const response = await onRequest({
        request: new Request('https://caregiversanctuary.org'+path, { headers: { Range: `bytes=${fragmentStart}-${fragmentStart + 180}`, 'If-None-Match': 'source-etag', 'If-Modified-Since': 'Fri, 20 Nov 2026 00:00:00 GMT' } }),
        env: { LEGACY_DB: db([row('Later human edit')]) },
        next: async () => new Response([204,304].includes(status) ? null : fragment, { status, headers: { 'content-type': 'text/html', 'content-range': `bytes ${fragmentStart}-${fragmentStart + 180}/${source.length}`, etag: 'source-etag', 'cache-control': 'public, max-age=3600', location: '/' } }),
      });
      await assertUnavailable(response);
      for (const name of ['etag', 'last-modified', 'content-range', 'location']) assert.equal(response.headers.get(name), null);
    }
  });
}
test('Range request with full 200 HTML still requires the governed rewrite and clears range metadata', async () => {
  const response = await onRequest({ request: new Request('https://caregiversanctuary.org/', { headers: { Range: 'bytes=0-100', 'If-None-Match': 'source-etag' } }), env: { LEGACY_DB: db([row('Latest published')]) }, next: async () => new Response(source, { headers: { 'content-type': 'text/html', 'accept-ranges': 'bytes', etag: 'source-etag' } }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('accept-ranges'), null);
  assert.equal(response.headers.get('etag'), null);
  const html = await response.text();
  assert.ok(html.includes('<p>Latest published</p>'));
  assert.ok(!html.includes(fragment));
});
test('governed non-HTML 200 and HEAD metadata fail closed', async () => {
  for (const [method, status, contentType] of [['GET',200,'text/plain'], ['HEAD',200,'text/html'], ['HEAD',304,'text/html']]) {
    const response = await onRequest({ request: new Request('https://caregiversanctuary.org/', { method }), env: {}, next: async () => new Response(method === 'HEAD' ? null : fragment, { status, headers: { 'content-type': contentType, etag: 'static' } }) });
    assert.equal(response.status,503);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('etag'),null);
    if (method === 'HEAD') assert.equal(await response.text(),'');
    else assert.ok(!(await response.text()).includes(fragment));
  }
});
test('unrelated partial and conditional responses retain their status, body and headers', async () => {
  for (const status of [206,304]) {
    const response = await onRequest({ request: new Request('https://caregiversanctuary.org/about.html', { headers: { Range: 'bytes=0-10' } }), env: {}, next: async () => new Response(status === 304 ? null : 'About slice', { status, headers: { 'content-type':'text/html', etag:'about-version' } }) });
    assert.equal(response.status,status);
    assert.equal(response.headers.get('etag'),'about-version');
    assert.equal(await response.text(),status === 304 ? '' : 'About slice');
  }
});

// Alias redirects release no asset body; the destination retains the published
// row gate. An upstream arbitrary redirect must never become a redirect oracle.
test('exact Pages home canonicalization is body-free and still reaches the governed root', async () => {
  for (const path of ['/index', '/index/', '/index.html', '/index.html?campaign=fixture']) {
    for (const status of [301, 308]) {
      const query = new URL('https://caregiversanctuary.org' + path).search;
      const response = await onRequest({
        request: new Request('https://caregiversanctuary.org' + path), env: {},
        next: async () => new Response(fragment, { status, headers: { location: '/' + query, etag: 'static', 'cache-control': 'public' } }),
      });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), '/' + query);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('etag'), null);
      assert.equal(await response.text(), '');
      await assertUnavailable(await render({}, '/' + query));
      const root = await render({ LEGACY_DB: db([row('Fresh after alias redirect')]) }, '/' + query);
      assert.equal(root.status, 200);
      assert.ok((await root.text()).includes('<p>Fresh after alias redirect</p>'));
    }
  }
});
test('home redirect exception excludes unexpected destinations, cache/range requests and previews', async () => {
  const cases = [
    { location: 'https://other.invalid/' }, { location: '//other.invalid/' },
    { location: '/about.html' }, { location: '/?different=1' },
    { location: 'https://user:pass@caregiversanctuary.org/' },
    { location: '/', path: '/' }, { location: '/', path: '/%69ndex.html' },
    ...['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since', 'If-Match', 'If-Unmodified-Since']
      .map(name => ({ location: '/', headers: { [name]: 'fixture' } })),
  ];
  for (const entry of cases) {
    const response = await onRequest({ request: new Request('https://caregiversanctuary.org' + (entry.path || '/index.html'), { headers: entry.headers }), env: {},
      next: async () => new Response(fragment, { status: 301, headers: { location: entry.location } }) });
    await assertUnavailable(response);
    assert.equal(response.headers.get('location'), null);
  }
  for (const query of ['preview_draft=fixture', 'preview_version=fixture']) {
    const response = await onRequest({ request: new Request('https://caregiversanctuary.org/index.html?' + query), env: {},
      next: async () => new Response(fragment, { status: 301, headers: { location: '/?' + query } }) });
    assert.notEqual(response.status, 308);
    assert.equal(response.headers.get('location'), null);
    assert.ok(!(await response.text()).includes(fragment));
  }
});
