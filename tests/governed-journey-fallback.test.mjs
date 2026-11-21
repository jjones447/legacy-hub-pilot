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
