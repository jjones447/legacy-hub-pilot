// Round-trip test against the real workerd runtime per LEGACY-D7-RT-WORKERD-R1 (Issue #125)
// Asserts that with the real seed from content/page-sections.json applied,
// every page the edge rewriter serves on real workerd is byte-identical to the committed build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { buildSite } from '../scripts/build-site.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

async function getWrangler() {
  const packageDir = join(rootDir, 'node_modules', 'wrangler');
  const installed = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).devDependencies.wrangler;
  assert.match(expected, /^\d+\.\d+\.\d+$/, 'Wrangler must be exactly pinned');
  assert.equal(installed.version, expected, 'Installed Wrangler must match the approved source pin');
  const cli = join(packageDir, 'bin', 'wrangler.js');
  assert.ok(existsSync(cli), 'Required local Wrangler CLI is missing; no automatic installation');
  const api = await import(pathToFileURL(join(packageDir, 'wrangler-dist', 'cli.js')).href);
  assert.equal(typeof api.unstable_dev, 'function', 'Required local Wrangler API is unavailable');
  return { ...api, cli };
}

function runWrangler(cli, args, tempDir) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: tempDir, stdio: 'pipe', timeout: 60000, shell: false,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

function getPagesWithDataCs() {
  const htmlFiles = readdirSync(rootDir).filter((f) => f.endsWith('.html'));
  const pages = [];
  for (const file of htmlFiles) {
    const content = readFileSync(resolve(rootDir, file), 'utf-8');
    if (content.includes('data-cs=') || content.includes('data-cs-list=') || content.includes('data-cs-options=')) {
      pages.push(file);
    }
  }
  return pages.sort();
}

function setupDatabase(tempDir, cli, config) {
  const schemaFiles = readdirSync(resolve(rootDir, 'schema'))
    .filter((f) => /^0.*\.sql$/.test(f))
    .sort();

  let combinedSql = '';
  for (const file of schemaFiles) {
    const content = readFileSync(resolve(rootDir, 'schema', file), 'utf8');
    combinedSql += `-- File: ${file}\n${content}\n;\n`;
  }

  const seedJson = JSON.parse(readFileSync(resolve(rootDir, 'content', 'page-sections.json'), 'utf8'));
  const items = seedJson.items || {};
  for (const [sectionKey, sectionObj] of Object.entries(items)) {
    const id = `ps_${sectionKey}`;
    const dataStr = JSON.stringify(sectionObj).replaceAll("'", "''");
    combinedSql += `
      INSERT INTO content_item (id, type_id, data, status, updated_by, updated_at)
      VALUES ('${id}', 'page_section', '${dataStr}', 'published', 'seed', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        type_id = excluded.type_id,
        data = excluded.data,
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
      WHERE content_item.updated_by NOT LIKE 'staff_%' OR content_item.updated_by IS NULL;
    `;
  }

  const sqlPath = join(tempDir, 'setup.sql');
  writeFileSync(sqlPath, combinedSql, 'utf8');

  runWrangler(cli, ['d1', 'execute', 'legacy-runtime-fixture', '--local', '--config', config,
    '--persist-to', tempDir, '--file', sqlPath, '--yes'], tempDir);
}

function buildWorkerBundle(tempDir, cli) {
  const bundleDir = join(tempDir, 'bundle');
  runWrangler(cli, ['pages', 'functions', 'build', resolve(rootDir, 'functions'), '--outdir', bundleDir], tempDir);
  return join(bundleDir, 'index.js');
}

async function startDevWorker(unstable_dev, tempDir, workerScript, config) {
  return await unstable_dev(workerScript, {
    config,
    local: true,
    envFiles: [],
    persistTo: tempDir,
    ip: '127.0.0.1',
    logLevel: 'none',
    experimental: {
      watch: false,
      liveReload: false,
      showInteractiveDevSession: false,
      disableDevRegistry: true,
      disableExperimentalWarning: true,
      enablePagesAssetsServiceBinding: {
        directory: join(tempDir, 'assets')
      }
    }
  });
}

test('round-trip workerd: edge rewrite on real workerd runtime matches committed build byte-for-byte', async (t) => {
  // This opt-in separates test modes; it NEVER grants clearance for an operational hold.
  assert.equal(process.env.LEGACY_RUN_WORKERD, '1', 'Runtime NOT RUN: use the explicit runtime command only after hold disposition');
  const wrangler = await getWrangler();

  const tempDir = mkdtempSync(join(os.tmpdir(), 'wrangler-workerd-test-'));
  let worker = null;

  // Register before startup. On unknown startup/stop outcome retain the exact scratch
  // directory for diagnosis; never enumerate/close unrelated process handles or delete it.
  t.diagnostic(`Owned synthetic runtime scratch retained: ${tempDir}`);
  t.after(async () => {
    if (worker) await worker.stop();
  });

  const config = join(tempDir, 'wrangler.json');
  writeFileSync(config, JSON.stringify({
    name: 'legacy-runtime-fixture', compatibility_date: '2026-07-01',
    d1_databases: [{ binding: 'LEGACY_DB', database_name: 'legacy-runtime-fixture',
      database_id: '00000000-0000-4000-8000-000000000001' }],
  }), 'utf8');
  buildSite(rootDir, join(tempDir, 'assets'));
  setupDatabase(tempDir, wrangler.cli, config);
  const workerScript = buildWorkerBundle(tempDir, wrangler.cli);
  worker = await startDevWorker(wrangler.unstable_dev, tempDir, workerScript, config);

  const baseUrl = `http://127.0.0.1:${worker.port}`;
  const pages = getPagesWithDataCs();
  assert.ok(pages.length >= 6, `expected at least 6 marked pages, got ${pages.length}`);

  for (const page of pages) {
    await t.test(`page ${page} matches committed build byte-for-byte on real workerd`, async () => {
      const committedHtml = readFileSync(resolve(rootDir, page), 'utf8');
      const response = await fetch(`${baseUrl}/${page}`, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, `Expected 200 OK for ${page}, got ${response.status}`);
      const rewrittenHtml = await response.text();

      if (rewrittenHtml !== committedHtml) {
        const origLines = committedHtml.split('\n');
        const rewLines = rewrittenHtml.split('\n');
        let diffDetail = '';
        for (let i = 0; i < Math.max(origLines.length, rewLines.length); i++) {
          if (origLines[i] !== rewLines[i]) {
            diffDetail = `First diff at line ${i + 1}:\n  EXPECTED: ${origLines[i]}\n  ACTUAL:   ${rewLines[i]}`;
            break;
          }
        }
        assert.equal(rewrittenHtml, committedHtml, `Round-trip mismatch for ${page} on real workerd!\n${diffDetail}`);
      }
      assert.equal(rewrittenHtml, committedHtml);
    });
  }

  await t.test('row edit: <strong> renders as bold and encoded-scheme link renders inert', async () => {
    await worker.stop();
    worker = null;

    const seedJson = JSON.parse(readFileSync(resolve(rootDir, 'content', 'page-sections.json'), 'utf8'));
    const editData = {
      ...seedJson.items['home.journey'],
      heading: "Caregiving can change <strong>every part</strong> of life.<br>You shouldn't have to navigate it alone. <a href=\"javascript&colon;alert(1)\">inert link</a>"
    };

    // Locate local D1 SQLite file
    const entries = readdirSync(tempDir, { recursive: true });
    const sqliteFiles = entries.filter((e) => e.includes('d1') && e.endsWith('.sqlite'));
    assert.equal(sqliteFiles.length, 1, 'exactly one owned synthetic D1 sqlite file must exist');
    const sqliteFile = join(tempDir, sqliteFiles[0]);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqliteFile);
    try {
      const result = db.prepare("UPDATE content_item SET data = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(editData), 'staff_editor', 'ps_home.journey');
      assert.equal(Number(result.changes), 1, 'exactly one synthetic row must be edited');
    } finally {
      db.close();
    }

    const workerScript = join(tempDir, 'bundle', 'index.js');
    worker = await startDevWorker(wrangler.unstable_dev, tempDir, workerScript, config);

    const res = await fetch(`http://127.0.0.1:${worker.port}/index.html`, { signal: AbortSignal.timeout(15000) });
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('<strong>every part</strong>'), 'expected <strong> tag to render bold verbatim');
    assert.ok(!html.includes('<a href="javascript'), 'hostile scheme link must not render active');
    assert.ok(html.includes('&lt;a href=&quot;javascript&colon;alert(1)&quot;&gt;inert link</a>'), 'encoded-scheme link must be escaped and rendered inert');
  });
});
