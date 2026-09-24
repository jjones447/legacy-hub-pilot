#!/usr/bin/env node
// On-demand database export script (Slice 10a, Requirement 3)
// Discovers every table from sqlite_master and dumps to local directory as JSON + manifest.json.
// No HTTP routes. Can be invoked directly or via Wrangler.

import { readdirSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

export function resolveLatestMigration(schemaDir = join(ROOT_DIR, 'schema')) {
  try {
    if (existsSync(schemaDir)) {
      const files = readdirSync(schemaDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      if (files.length > 0) {
        return files[files.length - 1];
      }
    }
  } catch (_) {}
  return '0008_agent_change.sql';
}

function createTempWranglerConfig(dbName) {
  const tmpPath = join(ROOT_DIR, `.wrangler-export-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`);
  const content = `name = "legacy-hub"\ncompatibility_date = "2026-07-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbName}-id"\n`;
  writeFileSync(tmpPath, content, 'utf8');
  return tmpPath;
}

export async function exportDatabase({
  db = null,
  databaseName = 'legacy-hub-db',
  outputDir = null,
  isLocal = true,
  configPath = null,
  schemaDir = null
} = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const targetDir = outputDir ? resolve(outputDir) : resolve(ROOT_DIR, 'backups', dateStr);
  mkdirSync(targetDir, { recursive: true });

  const latestMigration = resolveLatestMigration(schemaDir);

  // If a direct db instance (or D1 mock) is passed
  if (db) {
    let masterRes;
    if (typeof db.prepare === 'function') {
      masterRes = await db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      ).all();
    } else {
      masterRes = db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      );
    }
    const rawTables = masterRes.results || masterRes || [];
    const tables = rawTables.map((r) => r.name);

    const tableCounts = {};
    let totalRows = 0;

    for (const tableName of tables) {
      let rows;
      if (typeof db.prepare === 'function') {
        const rowRes = await db.prepare(`SELECT * FROM ${tableName}`).all();
        rows = rowRes.results || rowRes || [];
      } else {
        rows = db.all(`SELECT * FROM ${tableName}`);
      }
      tableCounts[tableName] = rows.length;
      totalRows += rows.length;

      writeFileSync(join(targetDir, `${tableName}.json`), JSON.stringify(rows, null, 2), 'utf8');
    }

    const manifest = {
      version: 1,
      timestamp: now.toISOString(),
      latest_migration: latestMigration,
      tables: tableCounts,
      total_rows: totalRows
    };

    writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      outputDir: targetDir,
      tables: tableCounts,
      tableCount: tables.length,
      totalRows,
      manifest
    };
  }

  // Otherwise, invoke via Wrangler CLI
  let tempConfig = null;
  try {
    let effectiveConfig = configPath;
    if (!effectiveConfig) {
      tempConfig = createTempWranglerConfig(databaseName);
      effectiveConfig = tempConfig;
    }

    const persistDir = join(ROOT_DIR, '.wrangler', 'state', 'v3');
    const localFlag = isLocal ? `--local --persist-to "${persistDir}"` : '--remote';
    const queryCmd = (sql) => {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      const escapedSql = cleanSql.replace(/"/g, '\\"');
      const cmd = `npx wrangler d1 execute "${databaseName}" ${localFlag} -c "${effectiveConfig}" --json --command "${escapedSql}"`;
      const out = execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
        return parsed[0].results;
      }
      return [];
    };

    const tablesRes = queryCmd(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    const tables = tablesRes.map((r) => r.name);

    const tableCounts = {};
    let totalRows = 0;

    for (const tableName of tables) {
      const rows = queryCmd(`SELECT * FROM ${tableName}`);
      tableCounts[tableName] = rows.length;
      totalRows += rows.length;
      writeFileSync(join(targetDir, `${tableName}.json`), JSON.stringify(rows, null, 2), 'utf8');
    }

    const manifest = {
      version: 1,
      timestamp: now.toISOString(),
      latest_migration: latestMigration,
      tables: tableCounts,
      total_rows: totalRows
    };

    writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`[export] Exported ${tables.length} tables (${totalRows} total rows) to ${targetDir}`);
    return {
      outputDir: targetDir,
      tables: tableCounts,
      tableCount: tables.length,
      totalRows,
      manifest
    };
  } finally {
    if (tempConfig && existsSync(tempConfig)) {
      unlinkSync(tempConfig);
    }
  }
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  let outputDir = null;
  let databaseName = 'legacy-hub-db';
  let isLocal = true;
  let configPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputDir = args[++i];
    } else if (args[i] === '--database' || args[i] === '--db') {
      databaseName = args[++i];
    } else if (args[i] === '--remote') {
      isLocal = false;
    } else if (args[i] === '--local') {
      isLocal = true;
    } else if (args[i] === '--config' || args[i] === '-c') {
      configPath = args[++i];
    } else if (!args[i].startsWith('-') && !outputDir) {
      outputDir = args[i];
    }
  }

  exportDatabase({ outputDir, databaseName, isLocal, configPath })
    .then((res) => {
      console.log(`[export] Successfully dumped database to: ${res.outputDir}`);
    })
    .catch((err) => {
      console.error(`[export error]: ${err.message}`);
      process.exit(1);
    });
}
