import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../../caregiver-tools.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../resource-save.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function page(t, fetch, host = 'staging.legacy-hub-5qo.pages.dev') {
  const dom = new JSDOM(html, { url: 'https://' + host + '/caregiver-tools', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  await new Promise(resolve => w.addEventListener('load', resolve, { once: true }));
  w.fetch = fetch;
  w.eval(script);
  w.dispatchEvent(new w.Event('pageshow'));
  await settle();
  return w;
}
const result = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('eligible cards save on explicit click, retry after failure, and clear private controls on pagehide', async t => {
  const writes = [];
  const w = await page(t, async (url, options) => {
    if (!options.method) return result({ ok: true, csrfToken: 'fixture', items: [], nextCursor: null });
    writes.push(options);
    return writes.length === 1 ? result({}, 503) : result({ ok: true, status: 'saved' });
  });
  const card = w.document.querySelector('[data-resource-id]');
  const button = card.querySelector('button');
  assert.equal(w.document.querySelectorAll('[data-save-controls]').length, 4);
  assert.equal(w.document.querySelector('.resource-item [data-save-controls]'), null);
  assert.equal(writes.length, 0);
  button.click();
  await settle();
  assert.equal(button.disabled, false);
  assert.match(card.querySelector('[role=status]').textContent, /Try again/);
  button.click();
  await settle();
  assert.deepEqual(JSON.parse(writes[1].body), { resource_id: card.dataset.resourceId });
  assert.equal(writes[1].headers['X-Portal-CSRF'], 'fixture');
  assert.equal(button.textContent, 'Saved');
  assert.equal(button.disabled, true);
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(w.document.querySelector('[data-save-controls]'), null);
});

test('signed-out visitors get a sign-in link only on enabled TEST', async t => {
  const signedOut = await page(t, () => result({}, 401));
  assert.equal(signedOut.document.querySelector('[data-save-controls] a').getAttribute('href'), '/portal');
  const disabled = await page(t, () => result({}, 404));
  assert.equal(disabled.document.querySelector('[data-save-controls]'), null);
  let reads = 0;
  const production = await page(t, () => { reads++; return result({}, 404); }, 'caregiversanctuary.org');
  assert.equal(reads, 0);
  assert.equal(production.document.querySelector('[data-save-controls]'), null);
});

test('saved state includes later pages and late reads cannot remount a departed page', async t => {
  let done;
  const id = /data-resource-id="([^"]+)"/.exec(html)[1];
  const w = await page(t, url => {
    if (url.includes('?cursor=')) return result({ ok: true, csrfToken: 'one', items: [{ resourceId: id }], nextCursor: null });
    return result({ ok: true, csrfToken: 'one', items: [], nextCursor: 'more' });
  });
  assert.equal(w.document.querySelector('[data-save-controls] button').textContent, 'Saved');
  w.fetch = () => new Promise(resolve => { done = resolve; });
  w.dispatchEvent(new w.Event('pageshow'));
  w.dispatchEvent(new w.Event('pagehide'));
  done(result({}, 401));
  await settle();
  assert.equal(w.document.querySelector('[data-save-controls]'), null);
});
