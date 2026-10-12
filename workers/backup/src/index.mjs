// Cloudflare Worker: Scheduled D1 database backup to private R2 bucket (Slice 10a)
// Nightly cron dumps all discovered tables to legacy-hub/YYYY-MM-DD/<table>.json + manifest.json
// Prunes backups older than 30 days. No public HTTP routes.

export async function pruneOldBackups(bucket, now = new Date(), retentionDays = 30) {
  const cutoffTime = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffStr = new Date(cutoffTime).toISOString().slice(0, 10); // YYYY-MM-DD

  let truncated = true;
  let cursor = undefined;
  let prunedCount = 0;

  while (truncated) {
    const listRes = await bucket.list({ prefix: "legacy-hub/", cursor });
    const objects = listRes.objects || [];
    for (const obj of objects) {
      // Key format: legacy-hub/YYYY-MM-DD/filename
      const match = obj.key.match(/^legacy-hub\/(\d{4}-\d{2}-\d{2})\//);
      if (match) {
        const itemDateStr = match[1];
        if (itemDateStr < cutoffStr) {
          await bucket.delete(obj.key);
          prunedCount++;
        }
      }
    }
    truncated = Boolean(listRes.truncated);
    cursor = listRes.cursor;
  }

  return prunedCount;
}

// Conservative legacy fallback when applied-migration history is unavailable.
// Do not advance this just because source adds a migration: its installation
// must be qualified separately. Observed applied migrations can report newer.
export const BAKED_IN_LATEST_MIGRATION = "0012_wellness_checkin.sql";

// One read-only D1 transaction captures every table before any R2 write.
// These conservative source limits refuse rather than emit a partial snapshot.
export const SNAPSHOT_LIMITS = Object.freeze({ tables: 32, rowsPerTable: 4096, bytes: 8 * 1024 * 1024 });
const CATALOG_SQL = "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name LIMIT 33";
function resultRows(result) {
  if (result?.success !== true || !Array.isArray(result.results)) throw new Error("Refusal: incomplete D1 snapshot result");
  return result.results;
}
function catalogRows(result) {
  const rows = resultRows(result);
  if (rows.length > SNAPSHOT_LIMITS.tables) throw new Error("Refusal: D1 snapshot table limit exceeded");
  const names = new Set();
  return rows.map(row => {
    if (!row || typeof row.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(row.name)
      || ['__proto__', 'constructor', 'prototype'].includes(row.name)
      || typeof row.sql !== 'string' || !row.sql || names.has(row.name)) throw new Error("Refusal: invalid D1 snapshot catalog");
    names.add(row.name);
    return { name: row.name, sql: row.sql };
  });
}
export async function readBackupSnapshot(db) {
  const catalog = catalogRows(await db.prepare(CATALOG_SQL).all());
  if (typeof db.batch !== 'function') throw new Error("Refusal: transactional D1 batch unavailable");
  const results = await db.batch([
    db.prepare(CATALOG_SQL),
    ...catalog.map(({ name }) => db.prepare(`SELECT * FROM "${name}" LIMIT ${SNAPSHOT_LIMITS.rowsPerTable + 1}`))
  ]);
  if (!Array.isArray(results) || results.length !== catalog.length + 1) throw new Error("Refusal: incomplete D1 snapshot batch");
  if (JSON.stringify(catalogRows(results[0])) !== JSON.stringify(catalog)) throw new Error("Refusal: D1 snapshot catalog changed");
  let byteLength = 0;
  const tables = catalog.map(({ name }, index) => {
    const rows = resultRows(results[index + 1]);
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error("Refusal: invalid D1 snapshot row");
    if (rows.length > SNAPSHOT_LIMITS.rowsPerTable) throw new Error("Refusal: D1 snapshot row limit exceeded");
    const payload = JSON.stringify(rows, null, 2);
    const bytes = new TextEncoder().encode(payload);
    byteLength += bytes.byteLength;
    if (byteLength > SNAPSHOT_LIMITS.bytes) throw new Error("Refusal: D1 snapshot byte limit exceeded");
    return { name, rows, payload, bytes };
  });
  const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog));
  return { tables, catalog_sha256: (await describeBackupBytes(catalogBytes)).sha256 };
}

// Hash the UTF-8 bytes of the R2 payload, not a separately serialized copy.
// This is an integrity reference, not a signature or a consistent D1 snapshot.
export async function describeBackupBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    byte_length: bytes.byteLength,
    sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  };
}

export async function runBackup(env, options = {}) {
  const startTime = Date.now();
  const db = env.DB || env.LEGACY_DB;
  const bucket = env.BACKUPS || env.BUCKET || env.R2;

  if (!db) {
    throw new Error("Missing D1 database binding (expected env.DB or env.LEGACY_DB)");
  }
  if (!bucket) {
    throw new Error("Missing R2 bucket binding (expected env.BACKUPS, env.BUCKET, or env.R2)");
  }

  const now = options.now ? new Date(options.now) : new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const prefix = options.prefix || `legacy-hub/${dateStr}`;
  const retentionDays = options.retentionDays !== undefined ? options.retentionDays : 30;

  // A completed prefix must never be overwritten by a later sequential run.
  // Lookup failure also refuses before database reads, uploads or pruning.
  // This preflight is not a lock against concurrent runs or a database snapshot.
  if (await bucket.head(`${prefix}/manifest.json`) !== null) {
    throw new Error(`Refusal: completed backup already exists at ${prefix}`);
  }

  // Discovery is outside the transaction; catalog revalidation inside the SAME
  // read-only batch refuses schema drift. No sequential-table fallback/retry.
  const snapshot = await readBackupSnapshot(db);
  const tables = snapshot.tables.map(table => table.name);

  // 2. Dump each table to R2 as JSON
  const tableCounts = {};
  const tableIntegrity = Object.create(null);
  let totalRows = 0;

  for (const { name: tableName, rows, payload, bytes } of snapshot.tables) {
    tableCounts[tableName] = rows.length;
    totalRows += rows.length;

    const tableKey = `${prefix}/${tableName}.json`;
    const integrity = await describeBackupBytes(bytes);
    await bucket.put(tableKey, payload, {
      httpMetadata: { contentType: "application/json" }
    });
    tableIntegrity[tableName] = { key: tableKey, ...integrity };
  }

  // 3. Resolve latest migration name
  let latestMigration = options.latestMigration || null;
  if (!latestMigration) {
    // Migration history, if present, was read in that same snapshot transaction.
    const history = snapshot.tables.find(table => table.name === 'd1_migrations');
    latestMigration = history?.rows.map(row => row.name).filter(name => typeof name === 'string').sort().at(-1) || null;
  }
  if (!latestMigration || latestMigration < BAKED_IN_LATEST_MIGRATION) {
    latestMigration = BAKED_IN_LATEST_MIGRATION;
  }

  // 4. Create and upload manifest.json
  const manifest = {
    version: 1,
    timestamp: now.toISOString(),
    latest_migration: latestMigration,
    tables: tableCounts,
    total_rows: totalRows,
    snapshot: { mechanism: "d1-read-batch-v1", catalog_sha256: snapshot.catalog_sha256 },
    // Additive version-1 metadata; existing restore readers still use tables.
    // Verify against a trusted manifest before restoring; old snapshots have no digests.
    integrity: { algorithm: "SHA-256", encoding: "utf-8", tables: tableIntegrity }
  };
  await bucket.put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });

  // 5. Prune backups older than retention cutoff
  const prunedCount = await pruneOldBackups(bucket, now, retentionDays);

  const durationMs = Date.now() - startTime;
  // One log line per run with counts and duration
  console.log(`[backup] Completed backup for ${dateStr}: ${tables.length} tables, ${totalRows} rows dumped, ${prunedCount} keys pruned in ${durationMs}ms`);

  return {
    success: true,
    date: dateStr,
    prefix,
    tables: tableCounts,
    tableCount: tables.length,
    totalRows,
    prunedCount,
    durationMs,
    manifest
  };
}

export default {
  async scheduled(event, env, ctx) {
    const p = runBackup(env);
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(p);
    } else {
      await p;
    }
  },

  async fetch(request, env, ctx) {
    // No HTTP route of any kind per spec and reveal-guard
    return new Response("Not Found", { status: 404 });
  }
};
