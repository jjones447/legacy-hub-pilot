# Bounded backup successor candidate — source only

**[pc2-codex-41]** The accepted205 reader checks row and serialized-byte caps after D1 has returned nested row objects. D1 permits unlimited row counts and individual rows up to2MB, so those checks do not enforce a finite aggregate result before Worker materialization. This candidate addresses that allocation path inside the existing backup lane. It does not replace `workers/backup/src/index.mjs`, change `wrangler.toml`, or install a Worker. Original205 remains exact; the candidate is the separate complete single-module entry point `workers/backup/candidates/pre-return-bounded.mjs`.

The entry point preserves the original R2 preflight, full-table backup JSON shape, table byte hashes, migration history selection, manifest ordering, pruning, scheduled handler and404 HTTP handler. The snapshot mechanism label is explicitly `d1-bounded-typed-read-batch-v2`. This is a proposed successor, not evidence that205 was installed or production accepted.

## D1-side enforcement

The reader performs at most three bounded read-only batches:

1. Catalog/schema discovery only. Catalog is limited to33 rows as a32-table overflow sentinel, and D1 CASE bounds each returned name to128 UTF8 bytes and DDL to4096 bytes; over-limit values become NULL and refuse. Schema uses supported `pragma_table_xinfo`, at most3201 rows as a3200-column sentinel, bounded names/types, and explicit ordinary/non-generated columns. No default-value or row-content projection occurs.
2. Scalar preflight only, one statement/table. It scans at most2049 rows as a2048-row rejection sentinel and returns COUNT, conservative encoded-byte upper bound, maximum row upper bound, and unsupported-cell count. JS assigns immutable per-table row/cell/byte budgets whose sums are at most2048 rows/65536 cells/1MiB encoded data. Bounds are allocated from actual preflight scalars; no row content has yet crossed the binding. Unsupported BLOBs, unsafe integers, nonfinite REALs, over-limit rows/widths or allocations refuse.
3. **One final consistent D1 batch** revalidates catalog and full column metadata, then reads every table. Each table statement independently recalculates its scalar bounds against CURRENT rows/types and applies them inside a lazy SQL CASE before any JSON encoder executes. Only a table fitting its immutable row/cell/byte budget and65536 row-upper cap gets a complete typed JSON array. Oversize returns a NULL refusal marker, never a truncated LIMIT result or an invented empty array. The successful content subquery has no LIMIT/filter. Sum of all successful content strings remains≤1MiB even when data grows, shrinks or changes after preflight. Metadata drift, missing columns or query errors refuse the whole snapshot before any R2 write.

There are at most `4+2*N` statements for N tables (68 at32), no more than34 statements in the final batch, at most100 columns/table and100KB SQL/statement, and no SQL function exceeds32 arguments. A Free plan's50-query invocation budget can refuse larger catalogs; this is not silently bypassed or retried. No new account resources or credentials are introduced.

For each row the conservative upper is `16 + sum(96 + 6*UTF8_text_bytes)` (96 for non-text); the table upper adds2 array bytes. The constants cover typed wrappers/commas and numeric decimal text. The preflight and final SQL use the same upper expression. Final statements compare CURRENT count, `count*column_count`, sum upper, max row upper and unsupported types with the immutable assigned budgets. SQL-side scalar limits cannot be substituted with a dated shape estimate.

The final binding receives at most32 one-row scalar envelopes with at most1MiB total typed data, plus separately bounded catalog/schema metadata. Catalog/schema return at most33/3201 fixed-shape rows; every returned text field has a D1-side byte cap. Their wire escaping and native/JS wrappers add fixed overhead;1MiB is a content bound, not a claim that total RPC bytes or heap equal1MiB. Server-side SQLite scanning/length calculation is not a streaming export or a universal memory certificate. D1's own query/time/resource failures remain explicit refusal.

## Fidelity or refusal

Internal cells carry type and an ASCII value representation. TEXT uses hex of original UTF8 bytes, decoded with fatal UTF8 validation and BOM preservation; malformed UTF8 refuses. NULL stays an explicit NULL. Safe integers use decimal strings. REALs use SQLite alternate-form26-digit decimal plus a SQL cast-back equality gate and finite checks, avoiding SQLite JSON's ordinary numeric rendering precision loss. JS decodes and checks each value before rebuilding the original column-keyed objects. BLOBs, unsafe integers and unsupported encodings are held rather than coerced or omitted. No raw row values appear in diagnostics or new logs; unexpected encoded JSON/UTF8 is converted to a fixed refusal.

Arrays are constructed in chunks: first≤32 cell arguments, then `json_insert` appends≤15 cells per call (31 arguments). This preserves trailing NULLs and100-column rows without `json_patch` NULL deletion. Original8MiB post-serialization check remains as defense in depth, after the pre-return DB-side guards. Migration history is reconstructed from the same final batch as every other table.

## Verification and remaining gates

Only six NEW tests run using the repository's existing `node:sqlite` in-memory mechanism: difficult numeric/Unicode/NUL/BOM fidelity and invalid UTF8 refusal; CURRENT growth/type/byte rejection before mock R2; scalar/global limits and unsafe types;100 columns/trailing NULL; schema/generated/DDL/identifier rejection; unchanged successful R2/manifest/history order. A deliberately throwing JSON encoder verifies rejected payloads are not encoded. An initial fixture used the SQLite keyword `nothing` as an unquoted column; it was corrected to `nullvalue` before the passing run. No old205/199/14/78 suite or prior native consistency run was repeated.

This is SOURCE validation, not Cloudflare D1/native qualification, production observation, an installer all-true receipt, or permission to deploy. Existing accepted205 inputs and installation gates are untouched. Root must review the exact candidate, qualify supported-runtime behavior and finite risk, and issue separate effect authority before adoption. Residual heap overhead, bounded metadata wrappers, SQLite engine allocation, concurrent invocation overlap, runtime versions, operational backup/restore/pruning/alerts/rollback gates remain for that qualification. Handoff remains disabled and customer production held; no human action is needed for this source work.

Primary references consulted: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [supported table_xinfo](https://developers.cloudflare.com/d1/sql-api/sql-statements/#pragma-table_xinfotable_name), [D1 JSON](https://developers.cloudflare.com/d1/sql-api/query-json/), [SQLite lazy CASE](https://www.sqlite.org/lang_expr.html#the_case_expression), [SQLite JSON functions](https://www.sqlite.org/json1.html), [SQLite alternate-form floating-point formatting](https://www.sqlite.org/printf.html).

## v3 (`d1-bounded-typed-read-batch-v3`): chunked envelopes, production-scale budget

**[pc2-claude-ct-2], Nov 28 2026.** The installed v2 module refused every night from 2026-11-12 to 2026-11-27 (16 runs, `scriptThrewException`; last backup 2026-11-11; legacy-caregiver-hub#54 c7232367142). Production's pessimistic total upper was 1,683,234 bytes, over v2's 1 MiB total, and one `content_type` row was at 56,872 of the 65,536 row cap. The data itself is about 397 KB. v2 was correct to refuse, but its budget was sized below the live database.

What changes:

- **Same estimator and fidelity.** Row upper is still `16 + Σ(96 + 6·UTF8 text bytes)`. The typed hex/decimal/alternate-form encoding, the lazy `CASE` refusal (rejected rows are never JSON-encoded), fatal UTF-8 decoding and the BLOB/unsafe-integer/non-finite refusals are unchanged.
- **Chunks.** Each table is read in rowid order and split by the running upper of earlier rows: chunk `k` holds rows whose earlier-row upper is in `[k·786432, (k+1)·786432)`. One row's upper is capped at 262,144 bytes, so chunk indexes are contiguous and one chunk's upper is below 1 MiB. That is about half of D1's 2,000,000-byte value limit, and each envelope's actual encoded size is also checked against 1 MiB in the Worker.
- **Still one transaction.** Preflight returns per-table count, upper, max row upper, unsupported cells and chunk count. Every chunk of every table is then read in ONE final read-only batch. Each chunk statement recomputes the whole-table statistics, including the chunk count, on CURRENT rows and returns `NULL` (refusal) on any drift. The Worker then requires the decoded row count to equal the preflight count exactly, so a row can't be gained, lost or duplicated across chunks.
- **Budget.** Total rows 32,768 (per-table sentinel 32,769), cells 1,048,576, total upper 8 MiB (equal to the existing 8 MiB post-serialization cap, which stays as defense in depth), row upper 262,144, total chunks 64. The query cap is 1,000. On a Free plan, D1's own 50-query limit still applies and fails closed. Today's database needs about 2 + 16 + 2 + 18 = 38 queries.
- **New refusals.** `WITHOUT ROWID` tables, and columns named `rowid`/`_rowid_`/`oid` or the internal `__legacy_backup_*` names, are refused rather than mis-ordered. No current table uses them.

Headroom: the 8 MiB budget is about 5× the current upper of 1.68 MB, and the 1 MiB-per-envelope chunking removes the single-table ceiling entirely. Restore readers are unchanged: the table JSON, the manifest fields and the integrity digests keep the v2 shape, and only the mechanism label changes. The tests (`tests/backup-pre-return-bounds.test.mjs`) cover:

- a production-scale fixture above 1.68 MB across several chunks, with exact equality to `SELECT * ORDER BY rowid`;
- a content row above v2's row cap;
- envelope size;
- drift, oversize row, reserved-name and `WITHOUT ROWID` refusals.

This is SOURCE validation in node:sqlite. Installation, the native D1 run and the first natural nightly artifact readback still belong to the existing publisher route. Installing it doesn't change `wrangler.toml`, the cron, bindings or R2 layout.
