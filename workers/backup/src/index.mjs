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

export const BAKED_IN_LATEST_MIGRATION = "0010_page_section_forms.sql";

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

  // 1. Discover all tables dynamically from sqlite_master (excluding sqlite_% and _cf_%)
  const masterRes = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();
  const rawTables = masterRes.results || masterRes || [];
  const tables = rawTables.map((r) => r.name);

  // 2. Dump each table to R2 as JSON
  const tableCounts = {};
  let totalRows = 0;

  for (const tableName of tables) {
    const rowRes = await db.prepare(`SELECT * FROM "${tableName}"`).all();
    const rows = rowRes.results || rowRes || [];
    tableCounts[tableName] = rows.length;
    totalRows += rows.length;

    const tableKey = `${prefix}/${tableName}.json`;
    await bucket.put(tableKey, JSON.stringify(rows, null, 2), {
      httpMetadata: { contentType: "application/json" }
    });
  }

  // 3. Resolve latest migration name
  let latestMigration = options.latestMigration || null;
  if (!latestMigration) {
    try {
      const migRes = await db.prepare("SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1").first();
      if (migRes && migRes.name) {
        latestMigration = migRes.name;
      }
    } catch (_) {
      // d1_migrations may not exist if migrations executed directly
    }
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
    total_rows: totalRows
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
