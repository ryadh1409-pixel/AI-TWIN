import type { Character } from '@/services/userFirestore';

/** Full HTTPS URL of the deployed `transcribe` function (no trailing slash). */
export const TRANSCRIBE_URL = (process.env.EXPO_PUBLIC_TRANSCRIBE_URL ?? '')
  .trim()
  .replace(/\/$/, '');

/** Full HTTPS URL of the deployed `chat` function (no trailing slash). */
export const CHAT_URL = (process.env.EXPO_PUBLIC_CHAT_URL ?? '')
  .trim()
  .replace(/\/$/, '');

/** Full HTTPS URL of the deployed `tts` function (no trailing slash). */
export const TTS_URL = (process.env.EXPO_PUBLIC_TTS_URL ?? '')
  .trim()
  .replace(/\/$/, '');

export type AudioPayload = {
  audioBase64: string;
  audioMimeType: string;
  voice: string;
  storagePath?: string;
  storageUrl?: string | null;
};

export type TranscribeResult = {
  text: string;
};

export type ChatResultSingle = {
  reply: string;
  audio?: AudioPayload | null;
};

export type ChatResultFamily = {
  mom: string;
  dad: string;
  maher: string;
  mjeed: string;
};

export const transcribeAudio = async (
  uri: string,
): Promise<TranscribeResult> => {
  if (!uri) {
    throw new Error('Missing recording URI.');
  }
  if (!TRANSCRIBE_URL) {
    throw new Error(
      'Set EXPO_PUBLIC_TRANSCRIBE_URL in .env (Firebase function URL), then restart Expo: npx expo start -c',
    );
  }

  const formData = new FormData();
  formData.append('audio', {
    uri,
    name: 'audio.m4a',
    type: 'audio/m4a',
  } as any);

  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as { error?: string };
      detail = errJson?.error || '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 400);
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as TranscribeResult;
  if (typeof data?.text !== 'string') {
    throw new Error('Invalid response: expected JSON { text: string }.');
  }
  return data;
};

export async function sendChatMessage(
  idToken: string,
  character: Character,
  message: string,
): Promise<ChatResultSingle | ChatResultFamily> {
  if (!CHAT_URL) {
    throw new Error(
      'Set EXPO_PUBLIC_CHAT_URL in .env to your chat function URL, then restart Expo: npx expo start -c',
    );
  }

  const endpoint =
    character === 'family' ? `${CHAT_URL}/family-chat` : `${CHAT_URL}/chat`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ character, role: character, message }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as { error?: string };
      detail = errJson?.error || '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 400);
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (character === 'family') {
    if (
      typeof data.mom !== 'string' ||
      typeof data.dad !== 'string' ||
      typeof data.maher !== 'string' ||
      typeof data.mjeed !== 'string'
    ) {
      throw new Error('Invalid response: expected { mom, dad, maher, mjeed }.');
    }
    return {
      mom: data.mom,
      dad: data.dad,
      maher: data.maher,
      mjeed: data.mjeed,
    };
  }
  if (typeof data.reply !== 'string') {
    throw new Error('Invalid response: expected { reply }.');
  }
  const audio =
    data.audio &&
    typeof data.audio === 'object' &&
    typeof (data.audio as Record<string, unknown>).audioBase64 === 'string' &&
    typeof (data.audio as Record<string, unknown>).audioMimeType === 'string' &&
    typeof (data.audio as Record<string, unknown>).voice === 'string'
      ? {
          audioBase64: (data.audio as Record<string, string>).audioBase64,
          audioMimeType: (data.audio as Record<string, string>).audioMimeType,
          voice: (data.audio as Record<string, string>).voice,
          storagePath: (data.audio as Record<string, string>).storagePath,
          storageUrl: (data.audio as Record<string, string>).storageUrl,
        }
      : undefined;
  return { reply: data.reply, audio };
}

export async function synthesizeSpeech(
  idToken: string,
  character: Exclude<Character, 'family'>,
  text: string,
): Promise<AudioPayload> {
  if (!TTS_URL) {
    throw new Error(
      'Set EXPO_PUBLIC_TTS_URL in .env to your tts function URL, then restart Expo: npx expo start -c',
    );
  }
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ character, text }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as { error?: string };
      detail = errJson?.error || '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 400);
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as Partial<AudioPayload>;
  if (
    typeof data.audioBase64 !== 'string' ||
    typeof data.audioMimeType !== 'string' ||
    typeof data.voice !== 'string'
  ) {
    throw new Error('Invalid TTS response payload.');
  }
  return {
    audioBase64: data.audioBase64,
    audioMimeType: data.audioMimeType,
    voice: data.voice,
  };
}
