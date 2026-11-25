// Dedicated inert fault/race source candidate, never a product entrypoint.
import { onRequestGet, onRequestPost } from '../../functions/api/portal/[[path]].js';
import { createHostedProfileFixture } from './profile-hosted-boundary.mjs';
import { createProfileFaultDb } from './profile-hosted-faults.mjs';
import { FAULT_MANIFEST, FAULT_OPERATION } from './profile-hosted-fault-manifest.mjs';
export default createHostedProfileFixture({
  manifest: FAULT_MANIFEST,
  get: onRequestGet,
  post: context => onRequestPost({ ...context,
    env: { ...context.env, LEGACY_DB: createProfileFaultDb(context.env.LEGACY_DB, FAULT_OPERATION) },
  }),
});
