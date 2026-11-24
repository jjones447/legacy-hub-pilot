# Named preview portal containment

Jacob's November 24 directive permits real caregiver portal login/email on both
`https://staging.legacy-hub-5qo.pages.dev` and
`https://customer-test.legacy-hub-5qo.pages.dev` while keeping ephemeral previews locked.

The dispatcher requires preview mail opt-in AND one of those exact HTTPS origins.
Development remains disabled. Production behavior is unchanged. Login, confirmation,
Continue, session reads and writes share this boundary; refused previews retain local
logout cookie clearing. The customer-test-only capture boundary remains unchanged.

Validation: 2,364 unit tests pass, including normal email transport on each named host,
wrong-host refusal without token creation, existing confirmation/session containment,
and capture one-use/expiry/admin checks. This is source evidence, not installation
or external-provider delivery proof. Both aliases need exact deployment/DB/flag
readbacks and operator verification before claiming the reported staging issue fixed.
