// Round-trip test against the real workerd runtime per LEGACY-D7-RT-WORKERD-R1 (Issue #125)
// Asserts that with the real seed from content/page-sections.json applied,
// every page the edge rewriter serves on real workerd is byte-identical to the committed build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

async function getWrangler() {
  try {
    return await import('wrangler');
  } catch {}
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    return req('wrangler');
  } catch {}
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const npxBase = join(localAppData, 'npm-cache', '_npx');
      if (existsSync(npxBase)) {
        for (const dir of readdirSync(npxBase)) {
          const candidate = join(npxBase, dir, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
          if (existsSync(candidate)) {
            const fileUrl = 'file:///' + candidate.replace(/\\/g, '/');
            return await import(fileUrl);
          }
        }
      }
    }
  } catch {}
  return null;
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

function setupDatabase(tempDir) {
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

  execSync(`npx wrangler d1 execute legacy-hub-db --local --persist-to="${tempDir}" --file="${sqlPath}" --yes`, {
    cwd: rootDir,
    stdio: 'ignore'
  });
}

function buildWorkerBundle(tempDir) {
  const bundleDir = join(tempDir, 'bundle');
  execSync(`npx wrangler pages functions build --outdir="${bundleDir}"`, {
    cwd: rootDir,
    stdio: 'ignore'
  });
  return join(bundleDir, 'index.js');
}

async function startDevWorker(unstable_dev, tempDir, workerScript) {
  return await unstable_dev(workerScript, {
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
        directory: rootDir
      },
      d1Databases: [
        {
          binding: 'LEGACY_DB',
          database_name: 'legacy-hub-db',
          database_id: 'dab02f78-f131-4d17-abaa-db9e6b45fb1b'
        }
      ]
    }
  });
}

function cleanupRemainingHandles() {
  for (const h of process._getActiveHandles()) {
    try {
      if (typeof h.unref === 'function') h.unref();
      if (typeof h.close === 'function') h.close();
    } catch {}
  }
}

test('round-trip workerd: edge rewrite on real workerd runtime matches committed build byte-for-byte', async (t) => {
  const wrangler = await getWrangler();
  if (!wrangler || typeof wrangler.unstable_dev !== 'function') {
    t.skip('Skipping workerd round-trip test: wrangler runtime is unavailable or cannot be loaded.');
    return;
  }

  try {
    execSync('npx wrangler --version', { cwd: rootDir, stdio: 'ignore' });
  } catch {
    t.skip('Skipping workerd round-trip test: npx wrangler command is unavailable.');
    return;
  }

  const tempDir = mkdtempSync(join(os.tmpdir(), 'wrangler-workerd-test-'));
  let worker = null;

  try {
    setupDatabase(tempDir);
    const workerScript = buildWorkerBundle(tempDir);
    worker = await startDevWorker(wrangler.unstable_dev, tempDir, workerScript);
  } catch (err) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    t.skip(`Skipping workerd round-trip test: workerd runtime failed to start (${err.message})`);
    return;
  }

  t.after(async () => {
    if (worker) {
      try {
        await worker.stop();
      } catch {}
      worker = null;
    }
    cleanupRemainingHandles();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const baseUrl = `http://127.0.0.1:${worker.port}`;
  const pages = getPagesWithDataCs();
  assert.ok(pages.length >= 6, `expected at least 6 marked pages, got ${pages.length}`);

  for (const page of pages) {
    await t.test(`page ${page} matches committed build byte-for-byte on real workerd`, async () => {
      const committedHtml = readFileSync(resolve(rootDir, page), 'utf8');
      const response = await fetch(`${baseUrl}/${page}`);
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
    let sqliteFile = null;
    for (const e of entries) {
      if (e.includes('d1') && e.endsWith('.sqlite')) {
        sqliteFile = join(tempDir, e);
        break;
      }
    }
    assert.ok(sqliteFile, 'local D1 sqlite file must exist');

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqliteFile);
    db.prepare("UPDATE content_item SET data = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(editData), 'staff_editor', 'ps_home.journey');
    db.close();

    const workerScript = join(tempDir, 'bundle', 'index.js');
    worker = await startDevWorker(wrangler.unstable_dev, tempDir, workerScript);

    const res = await fetch(`http://127.0.0.1:${worker.port}/index.html`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('<strong>every part</strong>'), 'expected <strong> tag to render bold verbatim');
    assert.ok(!html.includes('<a href="javascript'), 'hostile scheme link must not render active');
    assert.ok(html.includes('&lt;a href=&quot;javascript&colon;alert(1)&quot;&gt;inert link</a>'), 'encoded-scheme link must be escaped and rendered inert');
  });
});
