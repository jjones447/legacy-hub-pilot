# Caregiver portal — 1k road

[50k matrix](../overview.md) · Ground: [portal page](../../../portal.html), [portal API](../../../functions/api/portal/), [acceptance target](../../caregiver-portal-acceptance.md).

- **Built:** Magic-link/login foundation in [#8](https://github.com/jjones447/legacy-hub-pilot/pull/8), session/domain hardening in [#11](https://github.com/jjones447/legacy-hub-pilot/pull/11), and API guard in [#50](https://github.com/jjones447/legacy-hub-pilot/pull/50).
- **Activated evidence:** [#52](https://github.com/jjones447/legacy-hub-pilot/issues/52#issuecomment-5596447133) records portal page `200` and protected-prefix `403` for an anonymous caller in production. A holding/login page and fail-closed guard do not prove caregiver enrolment or a usable portal.
- **Next:** Exercise the [acceptance target](../../caregiver-portal-acceptance.md) with approved test identities and staging bindings, then obtain owner review for any wider rollout. Keep identity/provider credentials and real caregiver data outside source and ad-hoc tests.
