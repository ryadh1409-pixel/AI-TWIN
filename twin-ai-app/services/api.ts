import * as FileSystem from 'expo-file-system/legacy';
import { getForegroundCoords } from '@/services/location';
import type { LatLng } from '@/services/location';
import type { Character } from '@/services/userFirestore';

/** Fallbacks if env vars are unset (see twin-ai-app/.env). */
const DEFAULT_API_BASE = 'https://chat-gehsfp2zqa-uc.a.run.app';
const DEFAULT_TTS_BASE = 'https://tts-gehsfp2zqa-uc.a.run.app';
/** Firebase HTTPS function — Whisper + OpenAI key stay server-side. */
const DEFAULT_TRANSCRIBE_URL = 'https://transcribe-gehsfp2zqa-uc.a.run.app';

function trimBase(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .replace(/\/$/, '');
}

/** Single API base from env — use everywhere (no hardcoded LAN URLs). */
const API_URL = trimBase(process.env.EXPO_PUBLIC_RAG_BASE_URL) || DEFAULT_API_BASE;
const API_URL_CLEAN = API_URL.replace(/:1$/, '');

export { API_URL };

/** @deprecated Use API_URL — kept for backward compatibility */
export const API_BASE_URL = API_URL_CLEAN;
export const RAG_BASE_URL = API_URL_CLEAN;
export const FUNCTIONS_BASE_URL = API_URL_CLEAN;

export const CHAT_URL = trimBase(process.env.EXPO_PUBLIC_CHAT_URL) || API_URL_CLEAN;
/** Dedicated TTS service (POST root; body `{ message }` unchanged). */
export const TTS_URL = trimBase(process.env.EXPO_PUBLIC_TTS_URL) || DEFAULT_TTS_BASE;
/** Transcribe (multipart `file` → `{ text }`); no API key in the app bundle. */
export const TRANSCRIBE_URL =
  trimBase(process.env.EXPO_PUBLIC_TRANSCRIBE_URL) || DEFAULT_TRANSCRIBE_URL;
export const PROACTIVE_URL = `${API_URL_CLEAN}/proactive`;
export const UPLOAD_URL = `${API_URL_CLEAN}/upload`;
export const UPLOAD_PDF_URL = `${API_URL_CLEAN}/upload-pdf`;
export const ASK_URL = API_URL_CLEAN;
export const ASK_VISION_URL = `${API_URL_CLEAN}/ask-vision`;
export const CHAT_AUDIO_URL = `${API_URL_CLEAN}/chat-audio`;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} as const;

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
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string };
    };
    const err = parsed.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof err.message === 'string') return err.message;
    return text;
  } catch {
    return text;
  }
}

/** Extract assistant text from various API response shapes */
function parseReplyText(data: Record<string, unknown>): string {
  const keys = ['reply', 'answer', 'message', 'response', 'content', 'text'] as const;
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  throw new Error('Invalid API response: expected a string field (reply, answer, message, …)');
}

/**
 * POST JSON body `{ message }` — primary chat contract for Cloud Run.
 */
export async function postJsonMessage(
  url: string,
  message: string,
): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ message }),
    });
    const raw = await res.text();
    console.log('[api] POST response', { url, status: res.status, raw });
    if (!res.ok) {
      console.error('[api] POST error', { url, status: res.status, raw });
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    console.error('[api] POST failed', { url, error });
    throw error;
  }
}

export type ChatLocation = LatLng;

export type ProactiveContextPayload = {
  userId: string;
  location?: LatLng | null;
  time: string;
  timeOfDay: string;
  lastActivity: string | null;
  lastMemory?: string;
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
      headers: { ...JSON_HEADERS },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    console.log('[api] POST /proactive response', { status: res.status, raw });
    if (!res.ok) {
      console.error('[api] POST /proactive error', { status: res.status, raw });
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
  _person: VoicePerson = 'X',
  _location?: LatLng | null,
): Promise<ChatResultSingle> {
  try {
    console.log('[api] POST chat', { url: CHAT_URL });
    const data = await postJsonMessage(CHAT_URL, message.trim());
    const reply = parseReplyText(data);
    return {
      reply,
      memoryHint: typeof data.memoryHint === 'string' ? data.memoryHint : null,
      nearbySuggestions: Array.isArray(data.nearbySuggestions)
        ? (data.nearbySuggestions as NearbyPlaceSuggestion[])
        : undefined,
      nearbySource: typeof data.nearbySource === 'string' ? data.nearbySource : undefined,
    };
  } catch (error) {
    console.error('[api] sendChat error', error);
    throw error;
  }
}

/** Ingest text into per-user FAISS index — JSON `{ message }` as document text */
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
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ message: trimmed }),
    });
    const raw = await res.text();
    console.log('[api] POST /upload response', { status: res.status, raw });
    if (!res.ok) {
      console.error('[api] POST /upload error', { status: res.status, raw });
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    return JSON.parse(raw) as { ok?: boolean; userId?: string; chunks?: number };
  } catch (error) {
    console.error('[api] POST /upload error', error);
    throw error;
  }
}

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
    console.log('[api] POST /upload-pdf response', { status: res.status, raw });
    if (!res.ok) {
      console.error('[api] POST /upload-pdf error', { status: res.status, raw });
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

export async function askTwinRag(
  userId: string,
  question: string,
): Promise<{ answer: string }> {
  void userId;
  const q = question.trim();
  if (!q) {
    throw new Error('askTwinRag: empty question');
  }
  try {
    console.log('[api] POST ask', { url: ASK_URL });
    const data = await postJsonMessage(ASK_URL, q);
    const answer = parseReplyText(data);
    return { answer };
  } catch (error) {
    console.error('[api] askTwinRag error', error);
    throw error;
  }
}

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
    console.log('[api] POST /ask-vision response', { status: res.status, raw });
    if (!res.ok) {
      console.error('[api] POST /ask-vision error', { status: res.status, raw });
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

export async function textToSpeech(
  text: string,
  _person: VoicePerson = 'X',
): Promise<AudioPayload> {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    throw new Error('textToSpeech: empty text');
  }
  try {
    console.log('[api] POST /tts start', { url: TTS_URL });
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ message: trimmed }),
    });
    const raw = await res.text();
    console.log('[api] POST /tts response', { status: res.status, raw });
    if (!res.ok) {
      console.error('[api] POST /tts error', { status: res.status, raw });
      throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
    }
    const data = JSON.parse(raw) as Partial<AudioPayload> & {
      audioBase64?: string;
      audioMimeType?: string;
      mimeType?: string;
    };
    const b64 = data.audioBase64;
    const mime = data.audioMimeType ?? data.mimeType;
    const voice = data.voice ?? 'default';
    if (typeof b64 !== 'string' || typeof mime !== 'string') {
      throw new Error(
        'Invalid /tts response: expected { audioBase64, audioMimeType } (or mimeType)',
      );
    }
    return {
      audioBase64: b64,
      audioMimeType: mime,
      mimeType: data.mimeType,
      voice,
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
  _person: VoicePerson = 'X',
): Promise<TranscribeResult> => {
  void _person;
  if (!uri) throw new Error('Missing recording URI.');
  console.log('[transcribe] URI received:', uri);

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  console.log('[transcribe] base64 length:', base64.length);

  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      audioBase64: base64,
      mimeType: 'audio/m4a',
    }),
  });

  const raw = await res.text();
  console.log('[transcribe] response:', { status: res.status, raw });

  if (!res.ok) {
    console.error('[transcribe] error:', raw);
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }

  const data = JSON.parse(raw) as TranscribeResult;
  if (typeof data.text !== 'string') {
    throw new Error('Invalid transcribe response: expected { text: string }');
  }
  return data;
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
