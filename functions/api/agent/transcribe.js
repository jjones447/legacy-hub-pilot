// POST /api/agent/transcribe — transcribe audio via Workers AI Whisper
import { internalError } from '../../_lib/errors.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    // Check Content-Length header fast path if present
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_AUDIO_BYTES) {
      return json({ ok: false, error: 'audio_too_large' }, 413);
    }

    let buffer;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const audioEntry = formData.get('audio') || formData.get('file');
      if (!audioEntry || typeof audioEntry === 'string') {
        return json({ ok: false, error: 'no_audio' }, 400);
      }
      buffer = await audioEntry.arrayBuffer();
    } else {
      buffer = await request.arrayBuffer();
    }

    if (!buffer || buffer.byteLength === 0) {
      return json({ ok: false, error: 'no_audio' }, 400);
    }

    if (buffer.byteLength > MAX_AUDIO_BYTES) {
      return json({ ok: false, error: 'audio_too_large' }, 413);
    }

    if (!env || !env.AI) {
      return internalError('/api/agent/transcribe', new Error('Missing Workers AI binding'));
    }

    const aiRes = await env.AI.run(WHISPER_MODEL, {
      audio: new Uint8Array(buffer),
    });

    const text = (aiRes && typeof aiRes === 'object')
      ? (aiRes.text || aiRes.result?.text || '')
      : String(aiRes || '');

    return json({ ok: true, text });
  } catch (err) {
    return internalError('/api/agent/transcribe', err);
  }
}
