# Wellness grants — 1k road

[50k matrix](../overview.md) · Ground: [grants API](../../../functions/api/grants/), [domain](../../../functions/_lib/domain/grants.js), [tests](../../../tests/grants-course-complete.test.mjs).

- **Built:** Grant workflow foundation in [#4](https://github.com/jjones447/legacy-hub-pilot/pull/4) and course-complete transition in [#97](https://github.com/jjones447/legacy-hub-pilot/pull/97); later staff UI is code, not activation proof.
- **Activated evidence:** [#52](https://github.com/jjones447/legacy-hub-pilot/issues/52#issuecomment-5596447133) records anonymous `/api/grants` 403 in production. This proves only a guard.
- **Next:** Stage the application/award/status workflow using sample records and authorized staff access, check audit/rollback behavior, and obtain client disposition for grant content in [#83](https://github.com/jjones447/legacy-hub-pilot/issues/83) before publication.
