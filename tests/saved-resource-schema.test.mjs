import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { saveResource, removeSavedResource, listSavedResources } from '../functions/_lib/domain/saved-resources.mjs';
import { listSavedResourcePage } from '../functions/_lib/saved-resource-page.mjs';
import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/portal/[[path]].js';
import { createHmac } from 'node:crypto';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_init.sql', 'candidates/saved_resources.sql']) {
    db.exec(readFileSync(new URL('../schema/' + file, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO caregiver (id, first_name) VALUES ('cg_a', 'Fictional A'), ('cg_b', 'Fictional B');
    INSERT INTO saved_resource_catalog (resource_id, published) VALUES ('example-guide', 1);
  `);
  return db;
}

const save = `INSERT INTO saved_resource (caregiver_id, resource_id) VALUES (?, ?)
              ON CONFLICT (caregiver_id, resource_id) DO NOTHING`;

test('each owner can save the same resource and repeat a save without replacing its receipt', t => {
  const db = setup(t);
  const insert = db.prepare(save);
  insert.run('cg_a', 'example-guide');
  const first = db.prepare('SELECT * FROM saved_resource WHERE caregiver_id = ?').get('cg_a');
  assert.equal(insert.run('cg_a', 'example-guide').changes, 0);
  assert.equal(insert.run('cg_b', 'example-guide').changes, 1);
  assert.deepEqual(db.prepare('SELECT * FROM saved_resource WHERE caregiver_id = ?').get('cg_a'), first);
  db.prepare('DELETE FROM saved_resource WHERE caregiver_id = ? AND resource_id = ?').run('cg_b', 'example-guide');
  assert.deepEqual(db.prepare('SELECT * FROM saved_resource').all(), [first]);
});

test('retiring a resource blocks new saves and preserves removal of an existing bookmark', t => {
  const db = setup(t);
  const insert = db.prepare(save);
  insert.run('cg_a', 'example-guide');
  db.exec("UPDATE saved_resource_catalog SET published = 0 WHERE resource_id = 'example-guide'");
  for (const owner of ['cg_a', 'cg_b']) {
    assert.throws(() => insert.run(owner, 'example-guide'), /saved resource unavailable/);
  }
  assert.equal(db.prepare('DELETE FROM saved_resource WHERE caregiver_id = ? AND resource_id = ?').run('cg_a', 'example-guide').changes, 1);
  assert.equal(db.prepare('SELECT published FROM saved_resource_catalog').get().published, 0);
});

test('insertion requires a current caregiver and published resource, and saved rows cannot be reassigned', t => {
  const db = setup(t);
  const insert = db.prepare(save);
  db.exec("UPDATE caregiver SET status = 'archived' WHERE id = 'cg_b'");
  db.exec("INSERT INTO saved_resource_catalog (resource_id) VALUES ('unpublished-guide')");
  for (const [owner, resource] of [
    ['cg_b', 'example-guide'], ['absent', 'example-guide'],
    ['cg_a', 'unpublished-guide'], ['cg_a', 'missing-guide'],
  ]) {
    assert.throws(() => insert.run(owner, resource), /saved resource unavailable/);
  }
  insert.run('cg_a', 'example-guide');
  assert.throws(() => db.exec("UPDATE saved_resource SET caregiver_id = 'cg_b'"), /immutable/);
});

function atomicStore(sqlite) {
  return {
    prepare(sql) {
      return { bind: (...values) => ({ sql, values }) };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(({ sql, values }) => {
          const bindings = Object.fromEntries(values.map((value, i) => ['?' + (i + 1), value]));
          return { results: sqlite.prepare(sql).all(bindings) };
        });
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('store returns the original save receipt and removes only the verified owner’s bookmark', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  const other = { ...owner, caregiverId: 'cg_b' };
  const receipt = await saveResource(db, owner, 'example-guide');
  assert.equal(receipt.status, 'saved');
  assert.ok(receipt.createdAt);
  assert.deepEqual(await saveResource(db, owner, 'example-guide'), receipt);
  assert.deepEqual(await removeSavedResource(db, other, 'example-guide'), { status: 'removed' });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM saved_resource').get().n, 1);
  sqlite.exec('UPDATE saved_resource_catalog SET published = 0');
  assert.deepEqual(await saveResource(db, owner, 'example-guide'), { status: 'unavailable' });
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await removeSavedResource(db, owner, 'example-guide'), { status: 'removed' });
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM saved_resource').get().n, 0);
});

test('store checks session expiry and current caregiver eligibility within the write batch', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  await saveResource(db, owner, 'example-guide');
  const expired = { ...owner, expiresAtMs: Date.now() - 1 };
  for (const operation of [saveResource, removeSavedResource]) {
    assert.deepEqual(await operation(db, expired, 'example-guide'), { status: 'unauthorized' });
  }
  sqlite.exec("UPDATE caregiver SET status = 'archived' WHERE id = 'cg_a'");
  assert.deepEqual(await removeSavedResource(db, owner, 'example-guide'), { status: 'unauthorized' });
  assert.deepEqual(await saveResource(db, owner, 'example-guide'), { status: 'unauthorized' });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM saved_resource').get().n, 1);
});

test('owner list pages through ties after removal and returns retired bookmarks as unavailable', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  const other = { ...owner, caregiverId: 'cg_b' };
  const publish = sqlite.prepare('INSERT INTO saved_resource_catalog VALUES (?, 1)');
  const bookmark = sqlite.prepare('INSERT INTO saved_resource (caregiver_id, resource_id, created_at) VALUES (?, ?, ?)');
  for (let i = 0; i < 52; i++) {
    const id = 'guide-' + String(i).padStart(2, '0');
    publish.run(id);
    bookmark.run('cg_a', id, i === 51 ? '2026-11-25 01:00:00' : '2026-11-24 01:00:00');
  }
  await saveResource(db, other, 'example-guide');
  sqlite.exec("UPDATE saved_resource_catalog SET published = 0 WHERE resource_id = 'guide-00'");

  const first = await listSavedResources(db, owner);
  assert.equal(first.status, 'ok');
  assert.equal(first.items.length, 50);
  assert.equal(first.items[0].resourceId, 'guide-51');
  assert.equal(first.items[1].available, false);
  assert.deepEqual(first.next, { createdAt: '2026-11-24 01:00:00', resourceId: 'guide-48' });
  await removeSavedResource(db, owner, first.next.resourceId);
  const second = await listSavedResources(db, owner, first.next);
  assert.deepEqual(second.items.map(item => item.resourceId), ['guide-49', 'guide-50']);
  assert.equal(second.next, null);
  assert.deepEqual((await listSavedResources(db, other)).items.map(item => item.resourceId), ['example-guide']);
});

test('listing distinguishes an eligible empty list from an expired or archived caregiver', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  assert.deepEqual(await listSavedResources(db, owner), { status: 'ok', items: [], next: null });
  await saveResource(db, owner, 'example-guide');
  assert.deepEqual(await listSavedResources(db, { ...owner, expiresAtMs: 0 }), { status: 'unauthorized' });
  sqlite.exec("UPDATE caregiver SET status = 'archived' WHERE id = 'cg_a'");
  assert.deepEqual(await listSavedResources(db, owner), { status: 'unauthorized' });
});

test('a page cursor continues only within its issuing caregiver session', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  const secret = 'fictional portal key for local unit fixtures';
  const publish = sqlite.prepare('INSERT INTO saved_resource_catalog VALUES (?, 1)');
  const bookmark = sqlite.prepare('INSERT INTO saved_resource (caregiver_id, resource_id) VALUES (?, ?)');
  for (let i = 0; i < 51; i++) {
    const resource = 'guide-' + String(i).padStart(74, '0');
    publish.run(resource);
    bookmark.run(owner.caregiverId, resource);
  }
  const first = await listSavedResourcePage(db, owner, secret);
  assert.equal(first.items.length, 50);
  assert.equal(typeof first.nextCursor, 'string');
  const second = await listSavedResourcePage(db, owner, secret, first.nextCursor);
  assert.equal(second.items.length, 1);
  assert.ok(!first.items.some(item => item.resourceId === second.items[0].resourceId));
  assert.equal(second.nextCursor, null);
  for (const session of [{ ...owner, caregiverId: 'cg_b' }, { ...owner, expiresAtMs: owner.expiresAtMs + 1 }]) {
    assert.deepEqual(await listSavedResourcePage(db, session, secret, first.nextCursor), { status: 'invalid_cursor' });
  }
  const changed = first.nextCursor.slice(0, -1) + (first.nextCursor.endsWith('0') ? '1' : '0');
  for (const invalid of ['', changed, 'x'.repeat(400)]) {
    assert.deepEqual(await listSavedResourcePage(db, owner, secret, invalid), { status: 'invalid_cursor' });
  }
});

test('the portal saves, reloads and removes a signed-in caregiver’s bookmarks on opted-in TEST', async t => {
  const sqlite = setup(t);
  const guide = JSON.parse(readFileSync(new URL('../content/resources.json', import.meta.url), 'utf8')).downloads[0];
  sqlite.prepare('INSERT INTO saved_resource_catalog VALUES (?, 1)').run(guide.resource_id);
  const db = atomicStore(sqlite);
  const secret = 'fictional local test secret';
  const expiresAtMs = Date.now() + 60000;
  const env = {
    ENVIRONMENT: 'preview', PORTAL_PREVIEW_MAIL_ENABLED: '1', PORTAL_SAVED_RESOURCES_ENABLED: '1',
    PORTAL_TOKEN_SECRET: secret, LEGACY_DB: db,
  };
  const path = 'https://staging.legacy-hub-5qo.pages.dev/api/portal/saved-resources';
  const get = (cookie, url = path, settings = env) => onRequestGet({
    request: new Request(url, { headers: { Cookie: cookie } }), env: settings,
  });
  function cookieFor(id) {
    const payload = id + ':' + expiresAtMs;
    const signature = createHmac('sha256', secret).update('session:' + payload).digest('hex');
    return 'portal_session=' + encodeURIComponent(payload + ':' + signature);
  }

  const cookie = cookieFor('cg_a');
  const otherCookie = cookieFor('cg_b');
  const token = (await (await get(cookie)).json()).csrfToken;
  const otherToken = (await (await get(otherCookie)).json()).csrfToken;
  function write(method, sessionCookie, proof, body = { resource_id: guide.resource_id }) {
    const request = new Request(path, {
      method, headers: {
        Cookie: sessionCookie, Origin: new URL(path).origin, 'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json', 'X-Portal-CSRF': proof,
      }, body: JSON.stringify(body),
    });
    return (method === 'PUT' ? onRequestPut : onRequestDelete)({ request, env });
  }
  assert.equal((await write('PUT', cookie, '')).status, 403);
  assert.equal((await write('PUT', cookie, otherToken)).status, 403);
  assert.equal((await write('PUT', cookie, token, { owner: 'cg_b', resource_id: guide.resource_id })).status, 400);
  assert.equal((await write('PUT', cookie, token, { resource_id: 'x'.repeat(1500) })).status, 400);
  assert.equal((await write('PUT', cookie, token, { resource_id: 'example-guide' })).status, 404);
  const saved = await (await write('PUT', cookie, token)).json();
  assert.equal(saved.status, 'saved');
  assert.deepEqual(await (await write('PUT', cookie, token)).json(), saved);
  assert.equal((await write('DELETE', otherCookie, otherToken)).status, 200);
  const response = await get(cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const page = await response.json();
  assert.equal(page.ok, true);
  assert.deepEqual(page.items.map(item => item.resourceId), [guide.resource_id]);
  assert.equal(page.items[0].title, guide.title);
  assert.equal(page.items[0].href, '/caregiver-tools#' + guide.resource_id);
  assert.equal(page.nextCursor, null);
  sqlite.prepare('UPDATE saved_resource_catalog SET published = 0 WHERE resource_id = ?').run(guide.resource_id);
  const [retired] = (await (await get(cookie)).json()).items;
  assert.equal(retired.available, false);
  assert.equal(retired.href, null);
  assert.equal(retired.title, null);
  assert.deepEqual((await (await get(cookieFor('cg_b'))).json()).items, []);

  assert.equal((await write('DELETE', cookie, token)).status, 200);
  assert.equal((await write('DELETE', cookie, token)).status, 200);
  assert.deepEqual((await (await get(cookie)).json()).items, []);

  assert.equal((await get('')).status, 401);
  assert.equal((await get(cookie + '; ' + cookie)).status, 401);
  assert.equal((await get(cookie, path + '?owner=other')).status, 400);
  assert.equal((await get(cookie, path + '?cursor=bad')).status, 400);
  assert.equal((await get(cookie, path, { ...env, PORTAL_SAVED_RESOURCES_ENABLED: '' })).status, 404);
  assert.equal((await get(cookie, path, { ...env, ENVIRONMENT: 'production' })).status, 404);
  assert.equal((await get(cookie, path.replace('staging.', 'unlisted.'))).status, 404);
});
