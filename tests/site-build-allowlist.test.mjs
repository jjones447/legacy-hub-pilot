// Tests for LEGACY-DEPLOY-ALLOWLIST-R1: deploys serve dist/, built from an allowlist,
// instead of the repository root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, findForbidden, selectSiteFiles } from '../scripts/build-site.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-site-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('wrangler.toml deploys dist/, not the repository root', () => {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^pages_build_output_dir\s*=\s*"dist"\s*$/m);
});

test('the real site build contains the site and nothing forbidden', () => {
  withTempDir((out) => {
    const files = buildSite(ROOT, out);
    assert.deepEqual(findForbidden(files), []);
    for (const required of ['index.html', 'staff.html', 'styles.css', 'app.js', 'nav-v2.js', 'staff.js', '_redirects', 'media/hero.mp4']) {
      assert.ok(files.includes(required), `expected ${required} in the build`);
    }
    for (const excluded of ['docs', 'scripts', 'schema', 'tests', 'workers', 'functions', 'content', 'templates', 'wrangler.toml', 'package.json', 'build.py']) {
      assert.ok(!existsSync(join(out, excluded)), `${excluded} must not be in the build`);
    }
  });
});

test('every local link and asset referenced by a built page resolves inside the build', () => {
  withTempDir((out) => {
    const files = new Set(buildSite(ROOT, out));
    const missing = [];
    for (const page of [...files].filter((file) => file.endsWith('.html'))) {
      const html = readFileSync(join(out, page), 'utf8');
      for (const [, ref] of html.matchAll(/\b(?:src|href|poster)="([^"]+)"/g)) {
        if (/^(?:[a-z]+:|\/\/|#|\{)/i.test(ref)) continue; // external, mailto/tel, fragment, template
        const path = ref.split(/[?#]/)[0].replace(/^\//, '');
        if (path === '' || path.startsWith('api/')) continue; // site root; Functions routes
        if (!files.has(path) && !files.has(`${path}.html`)) missing.push(`${page} -> ${ref}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});

test('the forbidden-path check catches what it guards against', () => {
  assert.deepEqual(
    findForbidden(['index.html', 'docs/runbook.md', 'scripts/x.mjs', 'schema/0001.sql', 'wrangler.toml', 'package.json', 'README.md', 'media/a.jpg']),
    ['docs/runbook.md', 'scripts/x.mjs', 'schema/0001.sql', 'wrangler.toml', 'package.json', 'README.md'],
  );
});

test('files outside the allowlist are left out, and a refused build leaves nothing deployable', () => {
  withTempDir((root) => {
    writeFileSync(join(root, 'index.html'), '<p>ok</p>');
    writeFileSync(join(root, 'README.md'), 'internal');
    writeFileSync(join(root, 'wrangler.toml'), 'name = "x"');
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'runbook.md'), 'internal');
    mkdirSync(join(root, 'notes'));
    writeFileSync(join(root, 'notes', 'new-folder.html'), 'not opted in');
    mkdirSync(join(root, 'media'));
    writeFileSync(join(root, 'media', 'photo.jpg'), 'jpg');

    assert.deepEqual(selectSiteFiles(root), ['index.html', 'media/photo.jpg']);

    const out = join(root, 'dist');
    mkdirSync(join(out, 'media'), { recursive: true });
    writeFileSync(join(root, 'media', 'README.md'), 'planted inside a served folder');
    assert.throws(() => buildSite(root, out), /forbidden paths selected: media\/README\.md/);
    assert.ok(!existsSync(out), 'a refused build must not leave an older dist/ behind');
  });
});
