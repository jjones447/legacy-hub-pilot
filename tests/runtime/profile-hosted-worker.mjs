// Dedicated Pages advanced-mode entry, excluded from the product site build.
import { onRequestGet, onRequestPost } from '../../functions/api/portal/[[path]].js';
import { HOSTED_PROFILE_MANIFEST } from './profile-hosted-manifest.mjs';
import { createHostedProfileFixture } from './profile-hosted-boundary.mjs';
export default createHostedProfileFixture({ manifest: HOSTED_PROFILE_MANIFEST, get: onRequestGet, post: onRequestPost });
