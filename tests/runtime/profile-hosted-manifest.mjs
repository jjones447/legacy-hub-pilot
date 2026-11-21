// Public, non-secret source manifest. This head is intentionally INERT.
// Activation requires a reviewed successor using a provider-observed fixture alias,
// a bounded window, collision receipts and exact deployed TEST binding readback.
export const HOSTED_PROFILE_MANIFEST = Object.freeze({
  origin: null,
  startsAt: null,
  expiresAt: null,
  owners: Object.freeze([
    'profile_ct13_20261121_a_571d390c',
    'profile_ct13_20261121_b_82e4a90f',
    'profile_ct13_20261121_archived_614ab108',
  ]),
});
