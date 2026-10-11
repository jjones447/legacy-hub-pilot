// Closed synthetic unit tests: no SQLite, CLI/subprocess, fixture files,
// network, providers or actual restore invocation. Source reads only for wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyBackupIntegrity } from '../scripts/restore-from-backup.mjs';

function fixture() {
  const payloads = new Map([
    ['alpha', Buffer.from('[{"id":"synthetic-1","text":"café ☃"}]', 'utf8')],
    ['empty', Buffer.from('[]')]
  ]);
  const references = Object.fromEntries([...payloads].map(([name, bytes]) => [name, {
    key: `legacy-hub/2026-10-12/${name}.json`, byte_length: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }]));
  return { payloads, manifest: { version: 1, tables: { alpha: 1, empty: 0 },
    integrity: { algorithm: 'SHA-256', encoding: 'utf-8', tables: references } } };
}

test('exact original UTF-8 and empty table bytes match independent digest references', () => {
  const f = fixture();
  assert.deepEqual(verifyBackupIntegrity(f.manifest, f.payloads, { requireIntegrity: true }),
    { verified: true, tableCount: 2, basis: 'sha256-matches-supplied-manifest' });
});

test('same-row-count corruption and whitespace-only byte changes refuse', () => {
  for (const text of ['[{"id":"synthetic-2","text":"café ☃"}]', '[ {"id":"synthetic-1","text":"café ☃"} ]']) {
    const f = fixture();
    f.payloads.set('alpha', Buffer.from(text, 'utf8'));
    assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /bytes do not match/);
  }
});

test('missing or substituted payload refuses without exposing bytes or digests', () => {
  const f = fixture();
  f.payloads.delete('alpha');
  assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), error =>
    /REFUSAL/.test(error.message) && !error.message.includes(f.manifest.integrity.tables.alpha.sha256));
});

test('legacy manifests are explicitly unverified, strict mode refuses them', () => {
  const f = fixture();
  delete f.manifest.integrity;
  assert.deepEqual(verifyBackupIntegrity(f.manifest, f.payloads),
    { verified: false, tableCount: 0, basis: 'legacy-manifest-without-digests' });
  assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads, { requireIntegrity: true }), /metadata is required/);
});

test('declared null, malformed, wrong-algorithm or wrong-encoding metadata never falls back', () => {
  for (const metadata of [null, [], {}, { algorithm: 'MD5', encoding: 'utf-8', tables: {} },
    { algorithm: 'SHA-256', encoding: 'utf-16', tables: {} }]) {
    const f = fixture(); f.manifest.integrity = metadata;
    assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /REFUSAL/);
  }
});

test('missing, additional or replaced table references refuse', () => {
  for (const mutate of [refs => { delete refs.empty; }, refs => { refs.extra = refs.empty; },
    refs => { refs.replaced = refs.empty; delete refs.empty; }]) {
    const f = fixture(); mutate(f.manifest.integrity.tables);
    assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /exactly the declared tables/);
  }
});

test('malformed byte-length or SHA-256 descriptors refuse', () => {
  for (const patch of [{ byte_length: -1 }, { byte_length: 1.5 }, { byte_length: '2' },
    { byte_length: Number.MAX_SAFE_INTEGER + 1 }, { sha256: 'not-a-digest' },
    { sha256: 'A'.repeat(64) }, { sha256: null }]) {
    const f = fixture(); Object.assign(f.manifest.integrity.tables.empty, patch);
    assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /REFUSAL/);
  }
});

test('wrong table filenames, unsafe paths and mixed object prefixes refuse', () => {
  for (const key of ['legacy-hub/2026-10-12/wrong.json', '../alpha.json',
    'legacy-hub/../alpha.json', 'legacy-hub//alpha.json', 'legacy-hub/other/alpha.json',
    'https://synthetic.invalid/alpha.json', 'legacy-hub/2026-10-12/alpha.json?token=synthetic']) {
    const f = fixture(); f.manifest.integrity.tables.alpha.key = key;
    assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /REFUSAL/);
  }
});

test('unsupported caller options and payload types refuse', () => {
  const f = fixture();
  for (const requireIntegrity of ['true', 1, null]) {
    assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads, { requireIntegrity }), /REFUSAL/);
  }
  f.payloads.set('alpha', f.payloads.get('alpha').toString('utf8'));
  assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /REFUSAL/);
});

test('matching attacker-recomputed digests still claim supplied-manifest equality, not authenticity', () => {
  const f = fixture();
  const changed = Buffer.from('[{"id":"synthetic-changed"}]');
  f.payloads.set('alpha', changed);
  Object.assign(f.manifest.integrity.tables.alpha, {
    byte_length: changed.byteLength, sha256: createHash('sha256').update(changed).digest('hex')
  });
  assert.equal(verifyBackupIntegrity(f.manifest, f.payloads).basis, 'sha256-matches-supplied-manifest');
});

test('consumer wiring verifies original bytes before target SQL/config files in both branches', () => {
  const source = readFileSync(new URL('../scripts/restore-from-backup.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export async function restoreDatabase(');
  const verify = source.indexOf('const integrityVerification = verifyBackupIntegrity(', start);
  assert.ok(verify > start);
  assert.ok(source.indexOf('const bytes = readFileSync(tableFile);', start) < verify);
  assert.ok(source.indexOf('tableRows.set(tableName, rows);', start) < verify);
  assert.ok(source.indexOf('db.prepare("SELECT name FROM sqlite_master', start) > verify);
  assert.ok(source.indexOf('tempConfig = createTempWranglerConfig(', start) > verify);
  assert.equal((source.slice(start).match(/      integrityVerification,/g) || []).length, 2);
  assert.ok(source.includes("args[i] === '--require-integrity'"));
});

test('malformed manifests refuse even when legacy digests are optional', () => {
  for (const manifest of [null, [], {}, { tables: {} }, { tables: [] }]) {
    assert.throws(() => verifyBackupIntegrity(manifest, new Map()), /REFUSAL/);
  }
});

test('invalid UTF-8 refuses even when recomputed digest and length match', () => {
  const f = fixture();
  const bytes = Buffer.from([0xff]);
  f.payloads.set('empty', bytes);
  Object.assign(f.manifest.integrity.tables.empty, {
    byte_length: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex')
  });
  assert.throws(() => verifyBackupIntegrity(f.manifest, f.payloads), /not valid UTF-8/);
});
