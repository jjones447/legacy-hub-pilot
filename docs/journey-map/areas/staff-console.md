# Caregiver records and staff console — 1k road

[50k matrix](../overview.md) · Ground: [staff page](../../../staff.html), [staff script](../../../staff.js), [staff API](../../../functions/api/staff/), [record tests](../../../tests/caregiver-record-d2.test.mjs).

- **Built:** Access/JWT guard in [#12](https://github.com/jjones447/legacy-hub-pilot/pull/12), caregiver records in [#98](https://github.com/jjones447/legacy-hub-pilot/pull/98), and staff UI in [#100](https://github.com/jjones447/legacy-hub-pilot/pull/100).
- **Activated evidence:** Existing production checks in [#52](https://github.com/jjones447/legacy-hub-pilot/issues/52#issuecomment-5596447133) show protected prefixes fail closed anonymously. They do not show authenticated staff can complete a record change. Access setup remains an owner-gated item in [caregiver-hub #13](https://github.com/jjones447/legacy-caregiver-hub/issues/13).
- **Next:** Verify current Access configuration and a sample-data staff journey on staging. Distinguish the live guard from usable records and grant operations; require separate attended production verification.
