# Backup and infrastructure — 1k road

[50k matrix](../overview.md) · Ground: [backup Worker](../../../workers/backup/), [restore script](../../../scripts/restore-from-backup.mjs), [account bootstrap script](../../../scripts/cloudflare-account-bootstrap.mjs), [migration notes](../../account-migration.md).

- **Built:** Backup/restore implementation in [#109](https://github.com/jjones447/legacy-hub-pilot/pull/109), staging D1 separation in [#127](https://github.com/jjones447/legacy-hub-pilot/pull/127), account bootstrap in [#130](https://github.com/jjones447/legacy-hub-pilot/pull/130), and remote restore correction in [#131](https://github.com/jjones447/legacy-hub-pilot/pull/131).
- **Activated evidence:** [fleet-work #115](https://github.com/jjones447/fleet-work/issues/115) documents a scratch-database drill. It is not evidence of current scheduled backup, retention, or production recovery. No production migration is claimed here.
- **Next:** Read back actual bindings, schedule and retained artifacts without exposing secrets; run an attended, bounded restore drill on an approved non-production target; reconcile the [migration notes](../../account-migration.md) and owner approvals before any account move.
