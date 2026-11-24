// Public, non-secret active candidate. NOT deployed until exact review and preflight.
// Activation requires a reviewed successor using a provider-observed fixture alias,
// a bounded window, collision receipts and exact deployed TEST binding readback.
export const HOSTED_PROFILE_MANIFEST = Object.freeze({
  origin: 'https://profile-fixture-381.legacy-hub-5qo.pages.dev',
  startsAt: 1795262400000, // Nov21 12:00 UTC
  expiresAt: 1795266000000, // Nov21 13:00 UTC
  owners: Object.freeze([
    'profile_ct13_20261121_a_571d390c',
    'profile_ct13_20261121_b_82e4a90f',
    'profile_ct13_20261121_archived_614ab108',
  ]),
});
