# Backup read-batch candidate

[pc2-codex-13] New consistency source work, not a repeat of accepted digest
producer199 or integrity consumer200. The installed producer still performs
separate table reads interleaved with R2 writes. This candidate instead obtains
the catalog and all table rows in one read-only `D1Database.batch`, before any
upload. Cloudflare documents batches as SQL transactions, with ordered results
and whole-sequence rollback on statement failure:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

Initial discovery only selects candidate statements. The catalog (table names
and CREATE SQL) is checked again inside that same batch. Added/dropped/changed
schema, incomplete or failed results, unavailable batch and limit violations
refuse before table uploads, completion manifest or pruning. There is no
sequential-query fallback, retry, forced invocation or new SQL write.
Migration history, if present, is taken from the captured d1_migrations table.
The conservative0012 fallback and explicit operator migration label remain;
the latter is operator metadata, not observed applied-migration evidence.

The manifest keeps version1/counts/integrity fields and adds the mechanism label
`d1-read-batch-v1` plus a catalog digest. Neither label nor digest authenticates
the manifest, proves installed D1 isolation, guarantees global freshness, or
establishes independently trusted provenance. Old manifests are not upgraded.
Concurrent backup-prefix publication protection is a separate unresolved issue.

Conservative source limits:32 tables,4096 rows per table,8MiB serialized table
payload total. An extra row is requested to detect truncation. Exceeding limits
refuses instead of completing a partial backup. Platform response/memory limits
can still fail the batch before the application byte check; this is not a
guaranteed memory bound for arbitrary large rows. Qualify the exact target's
metadata/size and runtime before installation. No producer settings, bindings,
credentials, public routes, retention or existing03UTC schedule changed.

Pure fake-binding and in-memorySQLite tests qualify source construction only.
No production row read, backup/restore, telemetry403 retry, workerd/compiler,
provider API or customer effect occurs here. The installed199 version remains
current until separately qualified installation, natural artifact readback,
trusted provenance, isolated restore/audit equality and operational rollback.
