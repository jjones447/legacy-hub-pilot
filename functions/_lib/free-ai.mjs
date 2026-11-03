// Legacy-only zero-provider-call boundary. See docs/free-only-ai.md.
// There is currently NO verified provider hard stop maintained through a call.
// A Free-plan receipt/flag/timer cannot establish that invariant. Consequently
// no environment, gateway, model, subscription, or receipt can opt into inference
// in this revision. A separately reviewed admission mechanism is required.
export const FREE_AI_UNAVAILABLE = 'AI is temporarily unavailable. Please use the manual controls while free-only usage is verified.';

export function freeAiUnavailable() {
  return Response.json({ ok: false, error: FREE_AI_UNAVAILABLE, code: 'free_ai_unavailable' }, {
    status: 503, headers: { 'cache-control': 'no-store' },
  });
}
