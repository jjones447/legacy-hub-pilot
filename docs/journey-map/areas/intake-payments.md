# Intake and payment webhooks — 1k road

[50k matrix](../overview.md) · Ground: [intake function](../../../functions/api/intake.js), [webhook functions](../../../functions/api/webhooks/), [forms](../../../content/).

- **Built:** Intake endpoint work in [#19](https://github.com/jjones447/legacy-hub-pilot/pull/19), Givebutter webhook in [#9](https://github.com/jjones447/legacy-hub-pilot/pull/9), and Square webhook in [#117](https://github.com/jjones447/legacy-hub-pilot/pull/117). They are separate status-bearing paths.
- **Activated evidence:** [#52](https://github.com/jjones447/legacy-hub-pilot/issues/52#issuecomment-5596447133) records an anonymous production `200` for intake. It does not prove a submitted request was stored, routed or acknowledged. No webhook secret/verification receipt is cited for staging or production.
- **Next:** Verify a synthetic, privacy-safe intake submission end to end in staging; confirm provider credentials and webhook signature/replay behavior through the approved secret path; then repeat the approved production checks. Do not use real client data for test submissions.
