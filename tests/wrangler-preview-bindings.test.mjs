// Guards Wrangler's non-inheritable bindings: once env.preview declares any binding,
// preview deployments get only what env.preview restates. A binding added for production
// alone silently disappears from staging.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TOML = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

/** Map of section header (e.g. "[[r2_buckets]]") -> list of `binding` values declared under it. */
function bindingsBySection(toml) {
  const sections = new Map();
  let current = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#') || line === '') continue;
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      current = header[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    const binding = line.match(/^binding\s*=\s*"([^"]+)"/);
    if (binding && current) sections.get(current).push(binding[1]);
  }
  return sections;
}

function valuesUnder(toml, section, key) {
  const out = [];
  let inSection = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) { inSection = header[1] === section; continue; }
    const kv = line.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`));
    if (inSection && kv) out.push(kv[1]);
  }
  return out;
}

const sections = bindingsBySection(TOML);

test('every production binding is restated for preview', () => {
  const missing = [];
  for (const [section, bindings] of sections) {
    if (section.startsWith('env.')) continue;
    const preview = sections.get(`env.preview.${section}`) ?? [];
    for (const name of bindings) {
      if (!preview.includes(name)) missing.push(`${section}.${name}`);
    }
  }
  assert.deepEqual(missing, [], 'restate these under [env.preview.*] or preview loses them');
});

/** MEDIA parity rule: bound in both environments to different buckets, or in neither. */
function assertMediaParity(toml) {
  const prod = valuesUnder(toml, 'r2_buckets', 'bucket_name');
  const preview = valuesUnder(toml, 'env.preview.r2_buckets', 'bucket_name');
  if (prod.length === 0 && preview.length === 0) return; // commented out pending buckets
  assert.ok(
    prod.length > 0 && preview.length > 0,
    'MEDIA must be bound in both environments or in neither (one-sided binding fails preview or prod deploys)'
  );
  assert.notDeepEqual(prod, preview, 'MEDIA must point at different buckets per environment');
}

test('MEDIA: bound in both environments to different buckets, or in neither', () => {
  assertMediaParity(TOML);
});

test('MEDIA bound in production only is rejected', () => {
  const planted = [
    'name = "legacy-hub"',
    '[[r2_buckets]]',
    'binding = "MEDIA"',
    'bucket_name = "legacy-hub-media"',
    '',
    '[[env.preview.d1_databases]]',
    'binding = "LEGACY_DB"',
    'database_name = "legacy-hub-db-staging"',
    'database_id = "42be536c-e354-44c7-b246-2dcac18d8ac6"',
  ].join('\n');
  assert.throws(() => assertMediaParity(planted), /both environments/);
});

test('portal dev-link vars are set for preview only, never at top level', () => {
  // LEGACY-STAGING-PORTAL-DEVLINK-R1: POST /api/portal/login returns dev_link only when
  // BOTH PORTAL_DEV_RETURN_LINK and ENVIRONMENT are set — both must live under
  // [env.preview.vars] so production (top-level) can never carry them.
  const previewVars = valuesUnder(TOML, 'env.preview.vars', 'ENVIRONMENT');
  assert.deepEqual(previewVars, ['preview']);
  assert.deepEqual(valuesUnder(TOML, 'env.preview.vars', 'PORTAL_DEV_RETURN_LINK'), ['1']);
  assert.deepEqual(
    valuesUnder(TOML, 'vars', 'PORTAL_DEV_RETURN_LINK'),
    [],
    'PORTAL_DEV_RETURN_LINK must never be a top-level var — that would arm production'
  );
  assert.deepEqual(valuesUnder(TOML, 'vars', 'ENVIRONMENT'), []);
});

test('wrangler.toml has no account_id key (Pages rejects it at deploy)', () => {
  assert.ok(!/^\s*account_id\s*=/m.test(TOML), 'Pages config validation fails on account_id; select the account with CLOUDFLARE_ACCOUNT_ID');
});
