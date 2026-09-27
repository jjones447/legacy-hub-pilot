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

test('MEDIA is bound in both environments, to different buckets', () => {
  const prod = valuesUnder(TOML, 'r2_buckets', 'bucket_name');
  const preview = valuesUnder(TOML, 'env.preview.r2_buckets', 'bucket_name');
  assert.deepEqual(prod, ['legacy-hub-media']);
  assert.deepEqual(preview, ['legacy-hub-media-staging']);
});
