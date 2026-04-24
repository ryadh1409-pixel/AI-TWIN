'use strict';

/**
 * OpenAI Text-to-Speech (server-only). Keys must never appear in the Expo client.
 * Uses the official SDK (Bearer + JSON) — do not call api.openai.com from the app.
 */

const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';

const VOICE_BY_CHARACTER = {
  mom: 'shimmer',
  dad: 'onyx',
  maher: 'echo',
  mjeed: 'nova',
};

/**
 * Same rules as `normalizeTtsPerson` in the app + Firebase `tts`.
 * Accepts `character`, `person`, or `voice` on the JSON body.
 */
function resolveTtsCharacter(body) {
  const raw = body?.character ?? body?.person ?? body?.voice ?? '';
  const s = String(raw ?? '').trim();
  const k = s.toLowerCase().replace(/\s+/g, '_');
  if (k === 'mom' || k === 'mother' || s === 'أم' || s === 'ماما') return 'mom';
  if (k === 'dad' || k === 'father' || s === 'أب' || s === 'بابا') return 'dad';
  if (k === 'maher' || k === 'brother' || s === 'ماهر' || s === 'أخ') return 'maher';
  if (k === 'mjeed' || k === 'friend' || s === 'مجيد' || s === 'صديق') return 'mjeed';
  return 'mom';
}

function prepareTtsInput(text) {
  return String(text || '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 4000);
}

/**
 * @param {string} key
 * @returns {{ ok: true, key: string } | { ok: false, message: string }}
 */
function validateOpenAiApiKey(key) {
  const k = String(key || '').trim();
  if (!k) {
    return { ok: false, message: 'Missing OPENAI_API_KEY (server env).' };
  }
  if (!k.startsWith('sk-')) {
    return {
      ok: false,
      message:
        'OPENAI_API_KEY must be a secret key starting with sk- (never the publishable client key or Expo EXPO_PUBLIC_*).',
    };
  }
  return { ok: true, key: k };
}

/**
 * @param {import('openai').default} openai
 * @param {string} text
 * @param {'mom'|'dad'|'maher'|'mjeed'} character
 */
async function synthesizeOpenAiTts(openai, text, character) {
  const input = prepareTtsInput(text);
  if (!input) {
    const err = new Error('TTS input empty after normalization.');
    err.httpStatus = 400;
    err.code = 'TTS_EMPTY_INPUT';
    throw err;
  }
  const speech = await openai.audio.speech.create({
    model: OPENAI_TTS_MODEL,
    voice: VOICE_BY_CHARACTER[character],
    input,
    format: 'mp3',
  });
  const buffer = Buffer.from(await speech.arrayBuffer());
  return {
    audioBase64: buffer.toString('base64'),
    mimeType: 'audio/mpeg',
    audioMimeType: 'audio/mpeg',
    voice: VOICE_BY_CHARACTER[character],
  };
}

/**
 * Map OpenAI / network errors to HTTP status + client-safe message.
 * @param {unknown} err
 */
function mapOpenAiTtsHttpError(err) {
  const status =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.response?.status === 'number'
        ? err.response.status
        : 500;
  const rawMsg = err && typeof err.message === 'string' ? err.message : String(err || 'TTS failed');

  if (status === 401) {
    return {
      upstreamStatus: 401,
      httpStatus: 502,
      code: 'OPENAI_UNAUTHORIZED',
      message:
        'OpenAI rejected the API key (401). Set a valid server-side OPENAI_API_KEY (starts with sk-) in the backend .env or Secret Manager — never in the mobile app.',
    };
  }
  if (status === 429) {
    return {
      upstreamStatus: 429,
      httpStatus: 503,
      code: 'OPENAI_RATE_LIMIT',
      message: 'Text-to-speech is temporarily rate-limited. Try again shortly.',
    };
  }
  if (status >= 400 && status < 500) {
    return {
      upstreamStatus: status,
      httpStatus: 502,
      code: 'OPENAI_CLIENT_ERROR',
      message: `TTS request failed (${status}): ${rawMsg}`,
    };
  }
  return {
    upstreamStatus: status,
    httpStatus: 500,
    code: 'OPENAI_SERVER_ERROR',
    message: `TTS failed: ${rawMsg}`,
  };
}

module.exports = {
  OPENAI_TTS_MODEL,
  VOICE_BY_CHARACTER,
  resolveTtsCharacter,
  validateOpenAiApiKey,
  prepareTtsInput,
  synthesizeOpenAiTts,
  mapOpenAiTtsHttpError,
};
