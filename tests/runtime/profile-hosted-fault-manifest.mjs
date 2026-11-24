// INERT. A fresh exact review must pin origin/window, operation and full native
// witness hashes. No HTTP field or platform flag can activate this candidate.
import { HOSTED_PROFILE_MANIFEST } from './profile-hosted-manifest.mjs';
export const FAULT_MANIFEST = Object.freeze({
  origin: null, startsAt: null, expiresAt: null,
  owners: HOSTED_PROFILE_MANIFEST.owners,
});
export const FAULT_OPERATION = null;
