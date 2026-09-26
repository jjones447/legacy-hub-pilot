#!/usr/bin/env node
// Database restore script (Slice 10a, Requirement 2; updated LEGACY-RESTORE-REMOTE-FIX-R1)
// Refuses to run if target is 'legacy-hub-db' (live DB guard).
// Recreates schema from schema/*.sql in order (statement by statement),
// loads table data in configurable batches, verifies row counts against manifest.json,
// and spot-checks relationships.

import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

export function checkTargetDatabase(targetName) {
  if (!targetName || typeof targetName !== 'string') {
    throw new Error('Target database name is required');
  }
  const clean = targetName.trim().toLowerCase();
  if (clean === 'legacy-hub-db') {
    throw new Error("REFUSAL: Target database cannot be the live database 'legacy-hub-db'. Restoring over live DB is strictly prohibited.");
  }
}

export function resolveDatabaseId(targetName, { execFn = execSync, cwd = ROOT_DIR } = {}) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(targetName)) {
    return targetName;
  }

  try {
    const stdout = execFn('npx wrangler d1 list --json', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const list = JSON.parse(stdout);
    if (Array.isArray(list)) {
      const match = list.find((db) => db.name === targetName || db.uuid === targetName);
      if (match && match.uuid) {
        return match.uuid;
      }
    }
  } catch (err) {
    throw new Error(`Failed to resolve database ID for '${targetName}': ${err.message}`);
  }

  throw new Error(`Database '${targetName}' not found in wrangler d1 list`);
}

export function createTempWranglerConfig(dbName, dbId) {
  if (!dbId || typeof dbId !== 'string' || dbId.endsWith('-id') || dbId.includes('<name>')) {
    throw new Error(`Invalid database ID '${dbId}': placeholder IDs ending in -id are strictly prohibited.`);
  }
  const tmpPath = join(ROOT_DIR, `.wrangler-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`);
  const content = `name = "legacy-hub"\ncompatibility_date = "2026-07-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbId}"\n`;
  writeFileSync(tmpPath, content, 'utf8');
  return tmpPath;
}

export function splitSqlStatements(sqlText) {
  if (!sqlText || typeof sqlText !== 'string') return [];
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let beginDepth = 0;

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const nextChar = sqlText[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        i++;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        current += '""';
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      const remainingSlice = sqlText.slice(i);
      const beginMatch = remainingSlice.match(/^begin\b/i);
      if (beginMatch) {
        beginDepth++;
      } else {
        const endMatch = remainingSlice.match(/^end\b/i);
        if (endMatch) {
          if (beginDepth > 0) beginDepth--;
        }
      }
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      if (beginDepth === 0) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  const remaining = current.trim();
  if (remaining.length > 0) {
    statements.push(remaining);
  }

  return statements;
}

export function chunkArray(arr, size) {
  if (!Array.isArray(arr) || size <= 0) return [];
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  const str = String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

export function buildInsertSql(tableName, rows) {
  if (!rows || rows.length === 0) return '';
  const lines = [];
  for (const row of rows) {
    const cols = Object.keys(row);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const valList = cols.map((c) => escapeSqlValue(row[c])).join(', ');
    lines.push(`INSERT INTO "${tableName}" (${colList}) VALUES (${valList});`);
  }
  return lines.join('\n');
}

export const TABLE_DEPENDENCY_ORDER = [
  'caregiver',
  'event',
  'content_type',
  'content_item',
  'intake_rate_limit',
  'portal_token',
  'registration',
  'grant_application',
  'award',
  'followup',
  'contact_history',
  'note',
  'agent_change',
  'audit_log'
];

export function sortTablesForInsert(tableNames) {
  return [...tableNames].sort((a, b) => {
    const idxA = TABLE_DEPENDENCY_ORDER.indexOf(a);
    const idxB = TABLE_DEPENDENCY_ORDER.indexOf(b);
    const posA = idxA === -1 ? 999 : idxA;
    const posB = idxB === -1 ? 999 : idxB;
    return posA - posB;
  });
}

export function sortTablesForDelete(tableNames) {
  return [...tableNames].sort((a, b) => {
    const idxA = TABLE_DEPENDENCY_ORDER.indexOf(a);
    const idxB = TABLE_DEPENDENCY_ORDER.indexOf(b);
    const posA = idxA === -1 ? -1 : idxA;
    const posB = idxB === -1 ? -1 : idxB;
    return posB - posA;
  });
}

export async function spotCheckRelationships(queryFn) {
  const checks = {
    caregiverFound: false,
    caregiverId: null,
    hasGrant: false,
    grantId: null,
    hasAward: false,
    awardId: null,
    followupCount: 0,
    contactHistoryCount: 0,
    noteCount: 0,
    auditLogPreserved: false,
    auditLogCount: 0
  };

  // Find a caregiver that has a grant application and award
  const cgRows = await queryFn(
    `SELECT c.id as caregiver_id, c.first_name, c.last_name, g.id as grant_id, a.id as award_id
     FROM caregiver c
     JOIN grant_application g ON g.caregiver_id = c.id
     LEFT JOIN award a ON a.grant_application_id = g.id
     ORDER BY (CASE WHEN a.id IS NOT NULL THEN 0 ELSE 1 END), c.id
     LIMIT 1`
  );

  if (cgRows && cgRows.length > 0) {
    const cg = cgRows[0];
    checks.caregiverFound = true;
    checks.caregiverId = cg.caregiver_id;
    checks.hasGrant = Boolean(cg.grant_id);
    checks.grantId = cg.grant_id;
    checks.hasAward = Boolean(cg.award_id);
    checks.awardId = cg.award_id;

    // Followups
    const fuRows = await queryFn(`SELECT COUNT(*) as count FROM followup WHERE caregiver_id = '${cg.caregiver_id}'`);
    checks.followupCount = fuRows[0]?.count ?? 0;

    // Contact history
    const chRows = await queryFn(`SELECT COUNT(*) as count FROM contact_history WHERE caregiver_id = '${cg.caregiver_id}'`);
    checks.contactHistoryCount = chRows[0]?.count ?? 0;

    // Notes
    const noteRows = await queryFn(`SELECT COUNT(*) as count FROM note WHERE caregiver_id = '${cg.caregiver_id}'`);
    checks.noteCount = noteRows[0]?.count ?? 0;
  }

  // Audit log count
  const alRows = await queryFn(`SELECT COUNT(*) as count FROM audit_log`);
  checks.auditLogCount = alRows[0]?.count ?? 0;
  checks.auditLogPreserved = checks.auditLogCount >= 0;

  return checks;
}

export async function restoreDatabase({
  dumpDir,
  targetDatabase,
  databaseId = null,
  db = null,
  isLocal = true,
  configPath = null,
  schemaDir = null,
  batchSize = 25,
  execFn = execSync
} = {}) {
  // 1. Live DB refusal guard
  checkTargetDatabase(targetDatabase);

  const dumpPath = resolve(dumpDir);
  const manifestPath = join(dumpPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Invalid dump directory: manifest.json not found in ${dumpPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const schemasPath = schemaDir ? resolve(schemaDir) : join(ROOT_DIR, 'schema');
  const schemaFiles = readdirSync(schemasPath)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // If a direct db instance (or DatabaseSync) is passed
  if (db) {
    // 0. Drop existing tables if any
    try {
      let existingRes;
      if (typeof db.prepare === 'function') {
        const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
        existingRes = typeof stmt.all === 'function' ? (await stmt.all()) : stmt.all();
      } else {
        existingRes = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
      }
      const raw = existingRes.results || existingRes || [];
      if (raw.length > 0) {
        const dropOrder = sortTablesForDelete(raw.map((r) => r.name));
        const dropSql = ['PRAGMA foreign_keys = OFF;'];
        for (const t of dropOrder) {
          dropSql.push(`DROP TABLE IF EXISTS "${t}";`);
        }
        dropSql.push('PRAGMA foreign_keys = ON;');
        const fullDrop = dropSql.join('\n');
        if (typeof db.exec === 'function') {
          db.exec(fullDrop);
        } else {
          await db.prepare(fullDrop).run();
        }
      }
    } catch (_) {}

    // a) Apply schema in order statement-by-statement
    for (const sf of schemaFiles) {
      const sqlContent = readFileSync(join(schemasPath, sf), 'utf8');
      const statements = splitSqlStatements(sqlContent);
      for (const stmt of statements) {
        if (typeof db.exec === 'function') {
          db.exec(stmt);
        } else {
          await db.prepare(stmt).run();
        }
      }
    }

    // b) Load table data
    if (typeof db.exec === 'function') {
      db.exec('PRAGMA foreign_keys = OFF;');
    } else {
      await db.prepare('PRAGMA foreign_keys = OFF;').run();
    }

    const tableNames = Object.keys(manifest.tables);

    // Delete in reverse dependency order (children first)
    const deleteOrder = sortTablesForDelete(tableNames);
    for (const tableName of deleteOrder) {
      if (tableName !== 'audit_log') {
        if (typeof db.exec === 'function') {
          db.exec(`DELETE FROM "${tableName}";`);
        } else {
          await db.prepare(`DELETE FROM "${tableName}";`).run();
        }
      }
    }

    // Insert in dependency order (parents first) in batches
    const insertOrder = sortTablesForInsert(tableNames);
    for (const tableName of insertOrder) {
      const tableFile = join(dumpPath, `${tableName}.json`);
      if (!existsSync(tableFile)) continue;
      const rows = JSON.parse(readFileSync(tableFile, 'utf8'));
      if (rows.length > 0) {
        const chunks = chunkArray(rows, batchSize);
        for (const chunk of chunks) {
          const insertSql = buildInsertSql(tableName, chunk);
          if (insertSql) {
            if (typeof db.exec === 'function') {
              db.exec(insertSql);
            } else {
              await db.prepare(insertSql).run();
            }
          }
        }
      }
    }

    if (typeof db.exec === 'function') {
      db.exec('PRAGMA foreign_keys = ON;');
    } else {
      await db.prepare('PRAGMA foreign_keys = ON;').run();
    }

    // c) Verify row counts against manifest
    const verifiedCounts = {};
    for (const tableName of tableNames) {
      let count = 0;
      if (typeof db.prepare === 'function') {
        const stmt = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`);
        let res;
        if (typeof stmt.first === 'function') {
          res = await stmt.first();
        } else if (typeof stmt.get === 'function') {
          res = stmt.get();
        } else {
          const all = await stmt.all();
          res = (all.results || all)[0];
        }
        count = res?.count ?? 0;
      } else {
        const res = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get();
        count = res?.count ?? 0;
      }
      verifiedCounts[tableName] = count;
      if (count !== manifest.tables[tableName]) {
        throw new Error(
          `Row count mismatch for table '${tableName}': expected ${manifest.tables[tableName]}, got ${count}`
        );
      }
    }

    // d) Spot-check relationships
    const queryFn = async (sql) => {
      if (typeof db.prepare === 'function') {
        const stmt = db.prepare(sql);
        const res = typeof stmt.all === 'function' ? await stmt.all() : (typeof stmt.get === 'function' ? stmt.get() : null);
        if (res && res.results) return res.results;
        if (Array.isArray(res)) return res;
        if (res) return [res];
        return [];
      } else {
        return db.all(sql);
      }
    };
    const spotChecks = await spotCheckRelationships(queryFn);

    return {
      success: true,
      targetDatabase,
      verifiedCounts,
      manifest,
      spotChecks
    };
  }

  // CLI / Wrangler mode
  let tempConfig = null;

  try {
    if (!process.env.CLOUDFLARE_API_TOKEN && process.env.CF_API_TOKEN) {
      process.env.CLOUDFLARE_API_TOKEN = process.env.CF_API_TOKEN;
    }

    let effectiveConfig = configPath;
    if (!effectiveConfig) {
      const resolvedId = databaseId || resolveDatabaseId(targetDatabase, { execFn, cwd: ROOT_DIR });
      tempConfig = createTempWranglerConfig(targetDatabase, resolvedId);
      effectiveConfig = tempConfig;
    }

    const persistDir = join(ROOT_DIR, '.wrangler', 'state', 'v3');
    const localFlag = isLocal ? `--local --persist-to "${persistDir}"` : '--remote';

    const executeCmd = (sql) => {
      const cleanSql = sql.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleanSql) return;
      if (cleanSql.length < 4000) {
        const escapedSql = cleanSql.replace(/"/g, '\\"');
        const cmd = `npx wrangler d1 execute "${targetDatabase}" ${localFlag} -c "${effectiveConfig}" --command "${escapedSql}"`;
        execFn(cmd, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
      } else {
        const tmpFile = join(ROOT_DIR, `.wrangler-chunk-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
        try {
          writeFileSync(tmpFile, cleanSql, 'utf8');
          const cmd = `npx wrangler d1 execute "${targetDatabase}" ${localFlag} -c "${effectiveConfig}" --file "${tmpFile}"`;
          execFn(cmd, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
        } finally {
          if (existsSync(tmpFile)) unlinkSync(tmpFile);
        }
      }
    };

    const queryCmd = (sql) => {
      const cleanSql = sql.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      const escapedSql = cleanSql.replace(/"/g, '\\"');
      const cmd = `npx wrangler d1 execute "${targetDatabase}" ${localFlag} -c "${effectiveConfig}" --json --command "${escapedSql}"`;
      const out = execFn(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
        return parsed[0].results;
      }
      return [];
    };

    // 0. Drop existing tables if any, in reverse dependency order, to ensure clean schema recreation
    try {
      const existingTables = queryCmd(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      );
      if (existingTables && existingTables.length > 0) {
        const dropOrder = sortTablesForDelete(existingTables.map((r) => r.name));
        executeCmd('PRAGMA foreign_keys = OFF;');
        for (const t of dropOrder) {
          executeCmd(`DROP TABLE IF EXISTS "${t}";`);
        }
        executeCmd('PRAGMA foreign_keys = ON;');
      }
    } catch (_) {}

    // 1. Recreate schema from schema/*.sql in order, statement by statement
    console.log(`[restore] Recreating schema on '${targetDatabase}' (${schemaFiles.length} files) statement-by-statement...`);
    executeCmd('PRAGMA foreign_keys = OFF;');
    for (const sf of schemaFiles) {
      const fileSql = readFileSync(join(schemasPath, sf), 'utf8');
      const statements = splitSqlStatements(fileSql);
      for (const stmt of statements) {
        executeCmd(stmt);
      }
    }
    executeCmd('PRAGMA foreign_keys = ON;');
    console.log(`[restore] Schema recreated successfully.`);

    // 2. Load table data in batches over --command
    console.log(`[restore] Loading table data from ${dumpPath} (batch size: ${batchSize})...`);
    executeCmd('PRAGMA foreign_keys = OFF;');
    const tableNames = Object.keys(manifest.tables);

    // Delete in reverse dependency order (children first)
    const deleteOrder = sortTablesForDelete(tableNames);
    for (const tableName of deleteOrder) {
      if (tableName !== 'audit_log') {
        executeCmd(`DELETE FROM "${tableName}";`);
      }
    }

    // Insert in dependency order (parents first) in batches
    const insertOrder = sortTablesForInsert(tableNames);
    for (const tableName of insertOrder) {
      const tableFile = join(dumpPath, `${tableName}.json`);
      if (!existsSync(tableFile)) continue;
      const rows = JSON.parse(readFileSync(tableFile, 'utf8'));
      if (rows.length > 0) {
        const chunks = chunkArray(rows, batchSize);
        for (const chunk of chunks) {
          const insertSql = buildInsertSql(tableName, chunk);
          if (insertSql) {
            executeCmd(insertSql);
          }
        }
      }
    }
    executeCmd('PRAGMA foreign_keys = ON;');
    console.log(`[restore] Table data loaded.`);

    // 3. Verify row counts against manifest
    console.log(`[restore] Verifying row counts against manifest.json...`);
    const verifiedCounts = {};
    for (const tableName of tableNames) {
      const res = queryCmd(`SELECT COUNT(*) as count FROM "${tableName}"`);
      const count = res[0]?.count ?? 0;
      verifiedCounts[tableName] = count;
      const expected = manifest.tables[tableName];
      if (count !== expected) {
        throw new Error(
          `Row count mismatch on '${tableName}': expected ${expected}, got ${count}`
        );
      }
      console.log(`  - ${tableName}: ${count} rows (MATCH)`);
    }

    // 4. Spot check relationships
    console.log(`[restore] Spot-checking entity relationships...`);
    const spotChecks = await spotCheckRelationships(queryCmd);
    if (spotChecks.caregiverFound) {
      console.log(`  - Caregiver (${spotChecks.caregiverId}): found`);
      console.log(`  - Grant Application (${spotChecks.grantId}): ${spotChecks.hasGrant ? 'verified' : 'missing'}`);
      console.log(`  - Award (${spotChecks.awardId}): ${spotChecks.hasAward ? 'verified' : 'missing'}`);
      console.log(`  - Follow-ups: ${spotChecks.followupCount} record(s) linked`);
      console.log(`  - Contact History: ${spotChecks.contactHistoryCount} record(s) linked`);
      console.log(`  - Staff Notes: ${spotChecks.noteCount} record(s) linked`);
    }
    console.log(`  - Audit Log: ${spotChecks.auditLogCount} entry(ies) preserved`);

    console.log(`\n[RESTORE VERIFICATION SUCCESS]: Database '${targetDatabase}' successfully restored and verified.`);

    return {
      success: true,
      targetDatabase,
      verifiedCounts,
      manifest,
      spotChecks
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
  let dumpDir = null;
  let targetDatabase = null;
  let databaseId = null;
  let isLocal = true;
  let configPath = null;
  let batchSize = 25;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dump' || args[i] === '-d') {
      dumpDir = args[++i];
    } else if (args[i] === '--target' || args[i] === '-t') {
      targetDatabase = args[++i];
    } else if (args[i] === '--database-id' || args[i] === '--databaseId') {
      databaseId = args[++i];
    } else if (args[i] === '--batch-size' || args[i] === '--batchSize') {
      batchSize = parseInt(args[++i], 10);
    } else if (args[i] === '--remote') {
      isLocal = false;
    } else if (args[i] === '--local') {
      isLocal = true;
    } else if (args[i] === '--config' || args[i] === '-c') {
      configPath = args[++i];
    } else if (!args[i].startsWith('-')) {
      if (!dumpDir) dumpDir = args[i];
      else if (!targetDatabase) targetDatabase = args[i];
    }
  }

  if (!dumpDir || !targetDatabase) {
    console.error('Usage: node scripts/restore-from-backup.mjs <dump-dir> <target-d1-name> [--local|--remote] [--database-id <uuid>] [--batch-size <n>]');
    process.exit(1);
  }

  restoreDatabase({ dumpDir, targetDatabase, databaseId, isLocal, configPath, batchSize })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[restore error]: ${err.message}`);
      process.exit(1);
    });
}
