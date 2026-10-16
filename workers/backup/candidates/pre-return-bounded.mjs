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
// [pc2-codex-41] Explicit successor: D1-side bounds apply BEFORE binding materialization.
export const PRE_RETURN_LIMITS = Object.freeze({ rows: 2048, cells: 65536, encodedBytes: 1048576, rowUpper: 65536, columns: 100, identifierBytes: 128, ddlBytes: 4096, sqlBytes: 100000 });
const FILTER = "m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'";
const CATALOG_SQL = `SELECT CASE WHEN length(CAST(m.name AS BLOB))<=128 THEN m.name ELSE NULL END AS name,CASE WHEN length(CAST(m.sql AS BLOB))<=4096 THEN m.sql ELSE NULL END AS sql FROM sqlite_master m WHERE ${FILTER} ORDER BY m.name LIMIT 33`;
const SCHEMA_SQL = `SELECT CASE WHEN length(CAST(m.name AS BLOB))<=128 THEN m.name ELSE NULL END AS table_name,p.cid,CASE WHEN length(CAST(p.name AS BLOB))<=128 THEN p.name ELSE NULL END AS column_name,CASE WHEN length(CAST(p.type AS BLOB))<=128 THEN p.type ELSE NULL END AS type,p.pk,p.hidden FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE ${FILTER} ORDER BY m.name,p.cid LIMIT 3201`;
const utf8 = text => new TextEncoder().encode(text).byteLength;
function refusal(condition, reason) { if (!condition) throw new Error(`Refusal: bounded snapshot ${reason}`); }
function quoted(name) {
  refusal(typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && utf8(name)<=128 && !['__proto__','constructor','prototype'].includes(name), 'identifier');
  return `"${name}"`;
}
function boundedSql(sql) { refusal(utf8(sql)<=PRE_RETURN_LIMITS.sqlBytes,'SQL size'); return sql; }
export function snapshotStatsSql(table) {
  refusal(Array.isArray(table.columns)&&table.columns.length>=1&&table.columns.length<=100&&new Set(table.columns).size===table.columns.length,'columns');
  const columns=table.columns.map(quoted); quoted(table.name);
  const row=`(16+${columns.map(c=>`(CASE WHEN typeof(${c})='text' THEN 6*length(CAST(${c} AS BLOB))+96 ELSE 96 END)`).join('+')})`;
  const bad=columns.map(c=>`(CASE typeof(${c}) WHEN 'null' THEN 0 WHEN 'text' THEN 0 WHEN 'integer' THEN CASE WHEN ${c} BETWEEN -9007199254740991 AND 9007199254740991 THEN 0 ELSE 1 END WHEN 'real' THEN CASE WHEN ${c} BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 THEN CASE WHEN CAST(printf('%!.26g',${c}) AS REAL)=${c} THEN 0 ELSE 1 END ELSE 1 END ELSE 1 END)`).join('+');
  return boundedSql(`SELECT COUNT(*) AS row_count,2+COALESCE(SUM(${row}),0) AS upper_bytes,COALESCE(MAX(${row}),0) AS max_row_upper,COALESCE(SUM(${bad}),0) AS bad_cells FROM (SELECT ${columns.join(',')} FROM ${quoted(table.name)} LIMIT 2049)`);
}
function typedRowSql(columns) {
  const values=columns.map(name=>{const c=quoted(name);return `json_array(typeof(${c}),CASE typeof(${c}) WHEN 'text' THEN hex(CAST(${c} AS BLOB)) WHEN 'integer' THEN CAST(${c} AS TEXT) WHEN 'real' THEN printf('%!.26g',${c}) ELSE NULL END)`;});
  let row=`json_array(${values.slice(0,32).join(',')})`;
  for(let i=32;i<values.length;i+=15)row=`json_insert(${row},${values.slice(i,i+15).map(v=>`'$[#]',${v}`).join(',')})`;
  return row;
}
export function boundedTableSql(table,budget) {
  refusal(Number.isSafeInteger(budget.rows)&&budget.rows>=0&&budget.rows<=2048&&Number.isSafeInteger(budget.cells)&&budget.cells===budget.rows*table.columns.length&&budget.cells<=65536&&Number.isSafeInteger(budget.bytes)&&budget.bytes>=2&&budget.bytes<=1048576,'budget');
  // CASE is lazy: rejected rows are never JSON encoded or projected to the binding.
  // The LIMIT is a rejection sentinel in scalar statistics, NEVER a successful data truncation.
  return boundedSql(`WITH s AS MATERIALIZED (${snapshotStatsSql(table)}) SELECT CASE WHEN row_count<=${budget.rows} AND row_count*${table.columns.length}<=${budget.cells} AND upper_bytes<=${budget.bytes} AND max_row_upper<=65536 AND bad_cells=0 THEN (SELECT json_group_array(${typedRowSql(table.columns)}) FROM ${quoted(table.name)}) ELSE NULL END AS envelope FROM s`);
}
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
  if (typeof db.batch !== 'function') throw new Error("Refusal: transactional D1 batch unavailable");
  // Discovery and allocation return bounded schema/scalars only. All row content
  // and schema revalidation are captured in ONE final read-only transaction.
  const metadata=await db.batch([db.prepare(CATALOG_SQL),db.prepare(SCHEMA_SQL)]);
  refusal(Array.isArray(metadata)&&metadata.length===2,'metadata batch');
  const catalog=catalogRows(metadata[0]),schema=resultRows(metadata[1]);
  refusal(schema.length<=3200,'schema count');
  const descriptors=catalog.map(({name,sql})=>{
    quoted(name);refusal(typeof sql==='string'&&utf8(sql)<=4096&&/^CREATE TABLE\b/i.test(sql.trim()),'ordinary table schema');
    const fields=schema.filter(c=>c.table_name===name);refusal(fields.length>=1&&fields.length<=100,'column count');
    for(const [i,c]of fields.entries()){quoted(c.column_name);refusal(c.cid===i&&c.hidden===0&&typeof c.type==='string'&&utf8(c.type)<=128&&Number.isSafeInteger(c.pk)&&c.pk>=0&&c.pk<=100,'column metadata');}
    refusal(new Set(fields.map(c=>c.column_name)).size===fields.length,'duplicate column');return {name,columns:fields.map(c=>c.column_name)};
  });
  refusal(schema.length===descriptors.reduce((n,t)=>n+t.columns.length,0),'schema coverage');
  const preflight=descriptors.length?await db.batch(descriptors.map(t=>db.prepare(snapshotStatsSql(t)))):[];
  refusal(Array.isArray(preflight)&&preflight.length===descriptors.length,'scalar preflight');
  let totalRows=0,totalCells=0,totalUpper=0;
  const budgets=descriptors.map((t,i)=>{
    const values=resultRows(preflight[i]);refusal(values.length===1&&values[0]&&typeof values[0]==='object'&&!Array.isArray(values[0]),'scalar result');const r=values[0];
    refusal(Object.keys(r).sort().join(',')==='bad_cells,max_row_upper,row_count,upper_bytes'&&Object.values(r).every(v=>Number.isSafeInteger(v)&&v>=0)&&r.bad_cells===0&&r.row_count<=2048&&r.max_row_upper<=65536,'scalar limits');
    totalRows+=r.row_count;totalCells+=r.row_count*t.columns.length;totalUpper+=r.upper_bytes;return {rows:r.row_count,cells:r.row_count*t.columns.length,bytes:r.upper_bytes};
  });
  refusal(totalRows<=2048&&totalCells<=65536&&totalUpper<=1048576,'total allocation');
  const results=await db.batch([db.prepare(CATALOG_SQL),db.prepare(SCHEMA_SQL),...descriptors.map((t,i)=>db.prepare(boundedTableSql(t,budgets[i])))]);
  refusal(Array.isArray(results)&&results.length===catalog.length+2,'snapshot batch');
  refusal(JSON.stringify(catalogRows(results[0]))===JSON.stringify(catalog)&&JSON.stringify(resultRows(results[1]))===JSON.stringify(schema),'catalog/schema changed');
  let byteLength = 0;
  const tables = catalog.map(({ name }, index) => {
    const values=resultRows(results[index+2]);refusal(values.length===1&&values[0]&&typeof values[0]==='object'&&!Array.isArray(values[0])&&Object.keys(values[0]).join(',')==='envelope','envelope result');
    const encoded=values[0].envelope;refusal(typeof encoded==='string'&&utf8(encoded)<=budgets[index].bytes,'D1-side gate/encoded bytes');
    let decoded;try{decoded=JSON.parse(encoded);}catch{refusal(false,'encoded JSON');}const columns=descriptors[index].columns;refusal(Array.isArray(decoded)&&decoded.length<=budgets[index].rows,'decoded row count');
    const rows=decoded.map(cells=>{
      refusal(Array.isArray(cells)&&cells.length===columns.length,'cell count');
      return Object.fromEntries(cells.map((cell,i)=>{
        refusal(Array.isArray(cell)&&cell.length===2,'typed cell');const [type,value]=cell;let result;
        if(type==='null'){refusal(value===null,'null cell');result=null;}
        else if(type==='text'){
          refusal(typeof value==='string'&&/^(?:[0-9A-F]{2})*$/.test(value),'text bytes');const bytes=new Uint8Array(value.length/2);for(let n=0;n<bytes.length;n++)bytes[n]=parseInt(value.slice(n*2,n*2+2),16);
          try{result=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{refusal(false,'UTF8 text');}
        }
        else if(type==='integer'){refusal(typeof value==='string'&&/^-?(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value)),'integer fidelity');result=Number(value);}
        else if(type==='real'){refusal(typeof value==='string'&&value.length<=64&&/^-?[0-9]+(?:\.[0-9]*)?(?:e[+-]?[0-9]+)?$/.test(value)&&Number.isFinite(Number(value)),'real fidelity');result=Number(value);}
        else refusal(false,'unsupported cell');return [columns[i],result];
      }));
    });
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
    snapshot: { mechanism: "d1-bounded-typed-read-batch-v2", catalog_sha256: snapshot.catalog_sha256 },
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
