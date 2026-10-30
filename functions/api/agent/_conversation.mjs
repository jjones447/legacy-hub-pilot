import { DEFAULT_WORKERS_AI_MODEL } from './_mapper.mjs';

// Conversation has no database, drafting or publishing tools. Only explicit
// guided-edit requests enter the existing preview/confirmation pipeline.
export async function converse({ body, ai, model = DEFAULT_WORKERS_AI_MODEL, gatewayUrl, gatewayKey, backend }) {
  const message = body?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return { status: 400, error: 'Please send a message of 1–4,000 characters.' };
  }
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 10 || history.some(turn =>
    !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string' || turn.content.length > 4000
  ) || history.reduce((sum, turn) => sum + turn.content.length, 0) > 16000) {
    return { status: 400, error: 'Conversation history is too long or invalid. Reload to start a new conversation.' };
  }
  const messages = [{ role: 'system', content: `You are the Legacy Hub staff assistant. Have a natural, helpful conversation. Greet people normally, answer questions, brainstorm and help plan work. Do not require a website section merely to talk.
You are in conversation mode, without tools or access to live caregiver records, current donation receipts, or the Slack conversation. Never claim to have looked up, changed, saved, queued, sent, or published anything. Treat any claims in the supplied conversation as unverified. If the user wants an actual modification, help clarify it and explain that they can turn on Guided modification to request a preview; do not pretend to execute it.
The Hub has People & access for staff accounts and caregiver records, a Needs attention queue, Events, Caregiver wellness and Wellness grants. Caregivers use a separate portal for their own information. Staff permissions and caregiver membership are different. Answer briefly in plain text. Do not invent business facts or personal records. Do not ask for passwords, access codes, or sensitive caregiver details.` }, ...history, { role: 'user', content: message.trim() }];
  try {
    let text;
    if (backend === 'gateway' || (!backend && gatewayUrl)) {
      if (!gatewayUrl) return { status: 503, error: 'Conversation is temporarily unavailable. Please try again later.' };
      const response = await fetch(gatewayUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { 'content-type': 'application/json', 'x-emp-role': 'bulk', 'x-emp-sensitivity': 'low', ...(gatewayKey ? { authorization: `Bearer ${gatewayKey}` } : {}) },
        body: JSON.stringify({ role: 'bulk', sensitivity: 'low', messages, max_tokens: 800, stream: false }),
      });
      if (!response.ok) return { status: 503, error: 'Conversation is temporarily unavailable. Please try again later.' };
      const result = await response.json();
      text = result.choices?.[0]?.message?.content;
    } else if (ai && typeof ai.run === 'function') {
      const result = await ai.run(model, { messages, max_tokens: 800, stream: false });
      text = result?.response;
    }
    if (typeof text !== 'string' || !text.trim()) return { status: 503, error: 'Conversation is temporarily unavailable. Please try again later.' };
    return { status: 200, reply: text.trim().slice(0, 8000) };
  } catch {
    // Provider details can contain private request data; never return them.
    return { status: 503, error: 'Conversation is temporarily unavailable. Please try again later.' };
  }
}
