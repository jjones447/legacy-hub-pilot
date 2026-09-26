# Events — 1k road

[50k matrix](../overview.md) · Ground: [events page](../../../events.html), [events API](../../../functions/api/events.js), [event tests](../../../tests/events-d7-s2a.test.mjs).

- **Built:** Public events and registrations in [#3](https://github.com/jjones447/legacy-hub-pilot/pull/3); staff create/edit/publish/archive path in [#121](https://github.com/jjones447/legacy-hub-pilot/pull/121).
- **Activated evidence:** [#52](https://github.com/jjones447/legacy-hub-pilot/issues/52#issuecomment-5596447133) records production `/api/events` 200 and `/api/registrations` 403 anonymously. That proves the read route responds and registration guard fails closed, not that a staff event-write workflow is live.
- **Next:** Verify the staff flow with sample event data on staging, including archive's registration guard and public readback. Production remains a separate attended decision.
