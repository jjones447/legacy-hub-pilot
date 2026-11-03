// No verified provider-side free-only invariant exists for the ASR route.
// Deny before reading audio, bindings or credentials; no retry/fallback/upload.
import { freeAiUnavailable } from '../../_lib/free-ai.mjs';

export async function onRequestPost() {
  return freeAiUnavailable();
}
