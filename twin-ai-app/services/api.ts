import { getForegroundCoords } from '@/services/location';
import type { LatLng } from '@/services/location';
import type { Character } from '@/services/userFirestore';

const DEFAULT_LOCAL_API = 'http://192.168.0.41:3000';

function trimBase(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .replace(/\/$/, '');
}

/**
 * Host-only base for default `/transcribe` when EXPO_PUBLIC_TRANSCRIBE_URL is unset.
 * Derived from EXPO_PUBLIC_CHAT_URL if it ends with `/chat`, else used as-is.
 */
export const FUNCTIONS_BASE_URL = (() => {
  const c = trimBase(process.env.EXPO_PUBLIC_CHAT_URL);
  if (!c) return DEFAULT_LOCAL_API;
  if (c.endsWith('/chat')) {
    return trimBase(c.replace(/\/chat$/, ''));
  }
  return c;
})();

/**
 * Local Express + RAG (`/ask`, `/upload`, `/ask-vision`, …). Set EXPO_PUBLIC_RAG_BASE_URL when
 * EXPO_PUBLIC_CHAT_URL points at Cloud Functions so RAG stays local.
 */
export const API_BASE_URL = (() => {
  const explicit = trimBase(process.env.EXPO_PUBLIC_RAG_BASE_URL);
  if (explicit) return explicit;
  const chat = trimBase(process.env.EXPO_PUBLIC_CHAT_URL);
  if (chat.includes('cloudfunctions.net')) {
    return DEFAULT_LOCAL_API;
  }
  return chat || DEFAULT_LOCAL_API;
})();
/** Explicit base used for RAG endpoints (/ask, /upload, /ask-vision, /upload-pdf). */
export const RAG_BASE_URL = API_BASE_URL;
/** Guard against accidental `:1` suffix in the base URL from env edits. */
const RAG_BASE_URL_CLEAN = RAG_BASE_URL.replace(/:1$/, '');

/** Full URL to POST /chat — env may be host only or …/chat */
export const CHAT_URL = (() => {
  const raw = trimBase(process.env.EXPO_PUBLIC_CHAT_URL);
  if (!raw) return `${DEFAULT_LOCAL_API}/chat`;
  if (raw.endsWith('/chat')) return raw;
  return `${raw}/chat`;
})();

/** Full URL to POST /tts */
export const TTS_URL = (() => {
  const raw = trimBase(process.env.EXPO_PUBLIC_TTS_URL);
  if (!raw) return `${DEFAULT_LOCAL_API}/tts`;
  if (raw.endsWith('/tts')) return raw;
  return `${raw}/tts`;
})();

export const TRANSCRIBE_URL =
  trimBase(process.env.EXPO_PUBLIC_TRANSCRIBE_URL) ||
  `${FUNCTIONS_BASE_URL}/transcribe`;
export const PROACTIVE_URL = `${API_BASE_URL}/proactive`;
export const UPLOAD_URL = `${RAG_BASE_URL_CLEAN}/upload`;
export const UPLOAD_PDF_URL = `${RAG_BASE_URL_CLEAN}/upload-pdf`;
export const ASK_URL = `${RAG_BASE_URL_CLEAN}/ask`;
export const ASK_VISION_URL = `${RAG_BASE_URL_CLEAN}/ask-vision`;
export const CHAT_AUDIO_URL = `${API_BASE_URL}/chat-audio`;

export type VoicePerson = 'X';

export type AudioPayload = {
  audioBase64: string;
  audioMimeType: string;
  mimeType?: string;
  voice: string;
  storagePath?: string;
  storageUrl?: string | null;
};

export type TranscribeResult = {
  text: string;
};

export type NearbyPlaceSuggestion = {
  name: string;
  rating: number | null;
  distanceM: number;
  category: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  mapsUrl?: string;
};

export type ChatResultSingle = {
  reply: string;
  audio?: AudioPayload | null;
  memoryHint?: string | null;
  nearbySuggestions?: NearbyPlaceSuggestion[];
  nearbySource?: string;
};

function parseApiErrorBody(text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || text;
  } catch {
    return text;
  }
}

export type ChatLocation = LatLng;

export type ProactiveContextPayload = {
  userId: string;
  location?: LatLng | null;
  time: string;
  timeOfDay: string;
  lastActivity: string | null;
  /** Optional client-side memory hint (e.g. from profile). */
  lastMemory?: string;
  /** Alias for lastMemory — sent to POST /proactive as `memory`. */
  memory?: string;
};

export type ProactiveResult = {
  message: string | null;
  skip?: boolean;
  reason?: string;
  timeOfDay?: string;
};

export async function sendProactiveContextCheck(
  payload: ProactiveContextPayload,
): Promise<ProactiveResult> {
  try {
    const res = await fetch(PROACTIVE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    return JSON.parse(raw) as ProactiveResult;
  } catch (error) {
    console.error('[api] POST /proactive error', error);
    throw error;
  }
}

export async function sendChat(
  message: string,
  person: VoicePerson = 'X',
  location?: LatLng | null,
): Promise<ChatResultSingle> {
  try {
    console.log('[api] POST /chat start', { url: CHAT_URL, person, hasLocation: !!location });
    const body: Record<string, unknown> = { message, person };
    if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
      body.location = { lat: location.lat, lng: location.lng };
    }
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    console.log('[api] POST /chat response', { status: res.status, raw });
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as ChatResultSingle;
    if (typeof data.reply !== 'string') {
      throw new Error('Invalid /chat response: expected { reply: string }');
    }
    return data;
  } catch (error) {
    console.error('[api] POST /chat error', error);
    throw error;
  }
}

/** Ingest text into per-user FAISS index (RAG). */
export async function uploadTwinText(
  userId: string,
  text: string,
): Promise<{ ok?: boolean; userId?: string; chunks?: number }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('uploadTwinText: empty text');
  }
  const uid = userId.trim() || 'local-user';
  try {
    console.log('[api] POST /upload start', { url: UPLOAD_URL, userId: uid });
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text: trimmed, userId: uid }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    return JSON.parse(raw) as { ok?: boolean; userId?: string; chunks?: number };
  } catch (error) {
    console.error('[api] POST /upload error', error);
    throw error;
  }
}

/** Ingest a PDF into the per-user FAISS index (multipart: file + userId). */
export async function uploadTwinPdf(
  userId: string,
  file: { uri: string; name?: string; mimeType?: string },
): Promise<{ ok: true; chunks: number }> {
  const uid = userId.trim() || 'local-user';
  const formData = new FormData();
  formData.append('userId', uid);
  formData.append('file', {
    uri: file.uri,
    name: file.name ?? 'document.pdf',
    type: file.mimeType ?? 'application/pdf',
  } as any);
  try {
    console.log('[api] POST /upload-pdf start', { url: UPLOAD_PDF_URL, userId: uid });
    const res = await fetch(UPLOAD_PDF_URL, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json',
      },
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as { ok?: boolean; chunks?: number };
    if (data.ok !== true || typeof data.chunks !== 'number') {
      throw new Error('Invalid /upload-pdf response: expected { ok: true, chunks: number }');
    }
    return { ok: true, chunks: data.chunks };
  } catch (error) {
    console.error('[api] POST /upload-pdf error', error);
    throw error;
  }
}

/** RAG question against the user’s stored index. */
export async function askTwinRag(
  userId: string,
  question: string,
): Promise<{ answer: string }> {
  const q = question.trim();
  if (!q) {
    throw new Error('askTwinRag: empty question');
  }
  const uid = userId.trim() || 'local-user';
  try {
    console.log('[api] POST /ask start', { url: ASK_URL, userId: uid });
    const res = await fetch(ASK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ question: q, userId: uid }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as { answer?: string };
    if (typeof data.answer !== 'string') {
      throw new Error('Invalid /ask response: expected { answer: string }');
    }
    return { answer: data.answer };
  } catch (error) {
    console.error('[api] POST /ask error', error);
    throw error;
  }
}

/** GPT-4o vision: multipart image + optional question + userId. */
export async function askTwinVision(
  userId: string,
  image: { uri: string; name?: string; mimeType?: string },
  question?: string,
): Promise<{ answer: string }> {
  const uid = userId.trim() || 'local-user';
  const formData = new FormData();
  formData.append('userId', uid);
  formData.append('image', {
    uri: image.uri,
    name: image.name ?? 'photo.jpg',
    type: image.mimeType ?? 'image/jpeg',
  } as any);
  const q =
    question && question.trim()
      ? question.trim()
      : 'What do you see in this image?';
  formData.append('question', q);
  try {
    console.log('[api] POST /ask-vision start', { url: ASK_VISION_URL, userId: uid });
    const res = await fetch(ASK_VISION_URL, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json',
      },
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as { answer?: string };
    if (typeof data.answer !== 'string') {
      throw new Error('Invalid /ask-vision response: expected { answer: string }');
    }
    return { answer: data.answer };
  } catch (error) {
    console.error('[api] POST /ask-vision error', error);
    throw error;
  }
}

export async function sendAudio(
  formData: FormData,
  person: VoicePerson = 'X',
): Promise<TranscribeResult> {
  try {
    console.log('[api] POST /transcribe start', { url: TRANSCRIBE_URL, person });
    // Backend currently ignores person, but sending it keeps request shape future-proof.
    formData.append('person', person);
    const res = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json',
      },
    });
    const raw = await res.text();
    console.log('[api] POST /transcribe response', { status: res.status, raw });
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as TranscribeResult;
    if (typeof data.text !== 'string') {
      throw new Error('Invalid /transcribe response: expected { text: string }');
    }
    return data;
  } catch (error) {
    console.error('[api] POST /transcribe error', error);
    throw error;
  }
}

export async function textToSpeech(
  text: string,
  person: VoicePerson = 'X',
): Promise<AudioPayload> {
  try {
    console.log('[api] POST /tts start', { url: TTS_URL, person });
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text, person }),
    });
    const raw = await res.text();
    console.log('[api] POST /tts response', { status: res.status, raw });
    if (!res.ok) {
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as Partial<AudioPayload>;
    if (
      typeof data.audioBase64 !== 'string' ||
      typeof data.audioMimeType !== 'string' ||
      typeof data.voice !== 'string'
    ) {
      throw new Error(
        'Invalid /tts response: expected { audioBase64, audioMimeType, voice }',
      );
    }
    return {
      audioBase64: data.audioBase64,
      audioMimeType: data.audioMimeType,
      mimeType: data.mimeType,
      voice: data.voice,
      storagePath: data.storagePath,
      storageUrl: data.storageUrl ?? null,
    };
  } catch (error) {
    console.error('[api] POST /tts error', error);
    throw error;
  }
}

export const transcribeAudio = async (
  uri: string,
  person: VoicePerson = 'X',
): Promise<TranscribeResult> => {
  if (!uri) throw new Error('Missing recording URI.');
  const formData = new FormData();
  formData.append('file', {
    uri,
    name: 'audio.m4a',
    type: 'audio/m4a',
  } as any);
  return sendAudio(formData, person);
};

export async function sendChatMessage(
  _idToken: string,
  character: Character,
  message: string,
): Promise<ChatResultSingle> {
  void character;
  const location = await getForegroundCoords();
  return sendChat(message, 'X', location);
}

export async function synthesizeSpeech(
  _idToken: string,
  _character: Character,
  text: string,
): Promise<AudioPayload> {
  void _character;
  return textToSpeech(text, 'X');
}
