#!/usr/bin/env node
// Seed page sections into content_item table (Slice D7-S0a, Deliverable 3)
// Idempotent upsert of the 17 real page sections from content/page-sections.json.
// Never overwrites rows whose updated_by starts with 'staff_'.

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

export async function seedPageSections({
  db = null,
  contentPath = resolve(ROOT_DIR, 'content', 'page-sections.json'),
  databaseName = 'legacy-hub-db',
  isLocal = true,
  configPath = null
} = {}) {
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  const items = content.items || {};

  let inserted = 0;
  let unchanged = 0;
  let skipped = 0;

  if (db) {
    for (const [sectionKey, sectionObj] of Object.entries(items)) {
      const id = `ps_${sectionKey}`;
      const type_id = 'page_section';
      const dataStr = JSON.stringify(sectionObj);

      let existing = null;
      if (typeof db.prepare === 'function') {
        const stmt = db.prepare('SELECT id, type_id, data, status, updated_by FROM content_item WHERE id = ?');
        if (stmt.bind) {
          // D1 mock
          existing = await stmt.bind(id).first();
        } else {
          // DatabaseSync
          existing = stmt.get(id);
        }
      }

      if (existing) {
        if (existing.updated_by && existing.updated_by.startsWith('staff_')) {
          console.log(`[seed] Skipped ${id} (staff edit wins: updated_by=${existing.updated_by})`);
          skipped++;
          continue;
        }

        const isSame =
          existing.type_id === type_id &&
          existing.status === 'published' &&
          existing.data === dataStr;

        if (isSame) {
          unchanged++;
        } else {
          if (typeof db.prepare === 'function') {
            const updateStmt = db.prepare(`
              UPDATE content_item
              SET type_id = ?, data = ?, status = 'published', updated_by = 'seed', updated_at = datetime('now')
              WHERE id = ?
            `);
            if (updateStmt.bind) {
              await updateStmt.bind(type_id, dataStr, id).run();
            } else {
              updateStmt.run(type_id, dataStr, id);
            }
          }
          inserted++;
        }
      } else {
        if (typeof db.prepare === 'function') {
          const insertStmt = db.prepare(`
            INSERT INTO content_item (id, type_id, data, status, updated_by, updated_at)
            VALUES (?, ?, ?, 'published', 'seed', datetime('now'))
          `);
          if (insertStmt.bind) {
            await insertStmt.bind(id, type_id, dataStr).run();
          } else {
            insertStmt.run(id, type_id, dataStr);
          }
        }
        inserted++;
      }
    }

    console.log(`[seed] Page sections seeded: ${inserted} inserted/updated, ${unchanged} unchanged, ${skipped} skipped (total ${Object.keys(items).length})`);
    return {
      inserted,
      unchanged,
      skipped,
      total: Object.keys(items).length
    };
  }

  // CLI execution via Wrangler
  const statements = [];
  for (const [sectionKey, sectionObj] of Object.entries(items)) {
    const id = `ps_${sectionKey}`;
    const dataStr = JSON.stringify(sectionObj).replaceAll("'", "''");
    statements.push(`
      INSERT INTO content_item (id, type_id, data, status, updated_by, updated_at)
      VALUES ('${id}', 'page_section', '${dataStr}', 'published', 'seed', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        type_id = excluded.type_id,
        data = excluded.data,
        status = excluded.status,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
      WHERE content_item.updated_by NOT LIKE 'staff_%' OR content_item.updated_by IS NULL;
    `);
  }

  const tmpSqlPath = join(ROOT_DIR, `.wrangler-seed-${Date.now()}.sql`);
  writeFileSync(tmpSqlPath, statements.join('\n'), 'utf8');

  try {
    const persistDir = join(ROOT_DIR, '.wrangler', 'state', 'v3');
    const localFlag = isLocal ? `--local --persist-to "${persistDir}"` : '--remote';
    const configFlag = configPath ? `-c "${configPath}"` : '';
    const cmd = `npx wrangler d1 execute "${databaseName}" ${localFlag} ${configFlag} --file="${tmpSqlPath}"`;
    execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: 'inherit' });
    console.log(`[seed] Successfully executed seed via wrangler (${isLocal ? 'local' : 'remote'})`);
    return { success: true };
  } finally {
    if (existsSync(tmpSqlPath)) {
      unlinkSync(tmpSqlPath);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const args = process.argv.slice(2);
  let isLocal = true;
  let databaseName = 'legacy-hub-db';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remote') {
      isLocal = false;
    } else if (args[i] === '--local') {
      isLocal = true;
    } else if (args[i] === '--database' || args[i] === '--db') {
      databaseName = args[++i];
    }
  }

  seedPageSections({ isLocal, databaseName })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[seed error]: ${err.message}`);
      process.exit(1);
    });
}
