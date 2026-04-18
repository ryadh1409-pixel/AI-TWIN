import { getFirebaseAuth } from '@/lib/firebase';
import { getRecentMessages, saveMessage } from '@/services/conversationMemory';
import {
  loadUserProfileForPrompt,
  updateUserProfile as updateCompanionFirestoreProfile,
} from '@/services/companionUserProfile';
import { getForegroundCoords } from '@/services/location';
import type { LatLng } from '@/services/location';
import type { Character } from '@/services/userFirestore';

/** Firebase ID token for Cloud Run services that verify `Authorization: Bearer …`. */
export async function getFirebaseIdToken(): Promise<string | null> {
  try {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * Local dev: use your machine's LAN IP so a physical phone can reach Node
 * (replace 192.168.1.100 with your Wi‑Fi IP). Root `server.js` listens on :3000.
 */
const DEV_LAN_SERVER = 'http://192.168.1.100:3000';

/** Fallback when EXPO_PUBLIC_* is unset — LAN dev server (same host for /chat, /tts, /transcribe). */
const DEFAULT_API_BASE = DEV_LAN_SERVER;

function trimBase(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .replace(/\/$/, '');
}

/** Single API base from env — default is LAN dev server (:3000). */
const API_URL = trimBase(process.env.EXPO_PUBLIC_RAG_BASE_URL) || DEFAULT_API_BASE;
const API_URL_CLEAN = API_URL.replace(/:1$/, '');

export { API_URL };

/** @deprecated Use API_URL — kept for backward compatibility */
export const API_BASE_URL = API_URL_CLEAN;
export const RAG_BASE_URL = API_URL_CLEAN;
export const FUNCTIONS_BASE_URL = API_URL_CLEAN;

export const CHAT_URL = trimBase(process.env.EXPO_PUBLIC_CHAT_URL) || API_URL_CLEAN;

function companionChatPostUrl(): string {
  const b = CHAT_URL.replace(/\/$/, '');
  return b.endsWith('/chat') ? b : `${b}/chat`;
}

/** Split Cloud Run voice services (same GCP project as chat). Used when chat host is cloud but TTS/transcribe env vars are unset. */
const DEFAULT_CLOUD_TTS_URL = 'https://tts-720055631944.us-central1.run.app';
const DEFAULT_CLOUD_TRANSCRIBE_URL = 'https://transcribe-720055631944.us-central1.run.app';

function isLocalDevApiBase(base: string): boolean {
  return /localhost|127\.0\.0\.1|^http:\/\/192\.168\.\d+\.\d+|^http:\/\/10\.\d+\.\d+\.\d+/.test(
    base,
  );
}

/** POST /tts — JSON `{ text, person }` (legacy `{ message }` still accepted on server). */
export const TTS_URL =
  trimBase(process.env.EXPO_PUBLIC_TTS_URL) ||
  (isLocalDevApiBase(API_URL_CLEAN)
    ? `${API_URL_CLEAN.replace(/\/$/, '')}/tts`
    : DEFAULT_CLOUD_TTS_URL);
/** POST /transcribe — multipart field `file` → `{ text }`. */
export const TRANSCRIBE_URL =
  trimBase(process.env.EXPO_PUBLIC_TRANSCRIBE_URL) ||
  (isLocalDevApiBase(API_URL_CLEAN)
    ? `${API_URL_CLEAN.replace(/\/$/, '')}/transcribe`
    : DEFAULT_CLOUD_TRANSCRIBE_URL);

/** Firebase HTTPS: on-demand news (agent tool `getNews`). */
const DEFAULT_GET_NEWS_URL = 'https://getnews-gehsfp2zqa-uc.a.run.app';
export const GET_NEWS_AGENT_URL =
  trimBase(process.env.EXPO_PUBLIC_GET_NEWS_URL) || DEFAULT_GET_NEWS_URL;

/** Firebase HTTPS: sleep story (agent tool `sleepStory`). */
const DEFAULT_SLEEP_STORY_AGENT_URL = 'https://sleepstory-gehsfp2zqa-uc.a.run.app';
export const SLEEP_STORY_AGENT_URL =
  trimBase(process.env.EXPO_PUBLIC_SLEEP_STORY_URL) || DEFAULT_SLEEP_STORY_AGENT_URL;
export const PROACTIVE_URL = `${API_URL_CLEAN}/proactive`;
/** Proactive companion line (decide + generate + random delay hint). */
export const COMPANION_INITIATIVE_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/companion/initiative`;
export const UPLOAD_URL = `${API_URL_CLEAN}/upload`;
export const UPLOAD_PDF_URL = `${API_URL_CLEAN}/upload-pdf`;
/** @deprecated Base only — use ASK_RAG_URL for POST /ask */
export const ASK_URL = API_URL_CLEAN;
/** RAG-style ask: POST JSON `{ message, userId?, conversationHistory? }` → `{ answer }` (served by `twin-ai-app/server/index.js`). */
export const ASK_RAG_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/ask`;
export const ASK_VISION_URL = `${API_URL_CLEAN}/ask-vision`;
export const CHAT_AUDIO_URL = `${API_URL_CLEAN}/chat-audio`;
/** Planning agent: plan → execute steps (news / sleep / chat / tts) → combined reply */
export const PLAN_AND_RUN_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/agent/plan-and-run`;
/** Bounded autonomous loop: decide → act → reflect (max 2 loops per request). */
export const AUTONOMOUS_AGENT_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/agent/autonomous`;
/** Agent core: OpenAI respond / suggest (tone: natural, short, helpful). */
export const AGENT_CORE_GENERATE_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/agent/core/generate`;
/** Retention smart suggestion (topics + time + mood). */
export const COMPANION_SMART_SUGGEST_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/companion/smart-suggest`;
/** Extract topic keywords from a user line (OpenAI JSON). */
export const EXTRACT_TOPICS_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/agent/extract-topics`;
/** Weighted decision matrix → JSON + short explanation. */
export const DECISION_JSON_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/agent/decision-json`;
/** Startup advisor: full markdown decision report. */
export const DECISION_ADVISOR_URL = `${API_URL_CLEAN.replace(/\/$/, '')}/agent/decision-advisor`;

/** Firebase HTTPS: Decision Engine (OpenAI + Firestore `decisions`). */
export const DECIDE_URL = trimBase(process.env.EXPO_PUBLIC_DECIDE_URL || '');

/** Firebase HTTPS: Behavioral insights (`user_behavior` → `user_insights`). */
export const BEHAVIOR_INSIGHT_URL = trimBase(process.env.EXPO_PUBLIC_BEHAVIOR_INSIGHT_URL || '');

/** Firebase HTTPS: Predictive decision layer (`user_predictions`). */
export const PREDICTION_URL = trimBase(process.env.EXPO_PUBLIC_PREDICTION_URL || '');

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} as const;

export type DecisionJsonResult = {
  criteria?: { name: string; weight: number }[];
  options?: string[];
  scores?: Record<string, Record<string, number>>;
  totals?: Record<string, number>;
  recommendation?: string;
  explanation_ar?: string;
  short_explanation_en?: string;
  short_explanation?: string;
};

export async function analyzeDecisionJson(userInput: string): Promise<DecisionJsonResult> {
  const trimmed = String(userInput || '').trim();
  if (!trimmed) throw new Error('Empty user_input.');
  const res = await fetch(DECISION_JSON_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ user_input: trimmed }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  return JSON.parse(raw) as DecisionJsonResult;
}

export type DecideApiResult = {
  markdown: string;
  recommendation: string;
  confidence: number | null;
  actionPlan: string | null;
  decisionId: string | null;
};

export type DecisionFollowUpItem = {
  decisionId: string;
  userInput: string;
  recommendation: string;
  confidence: number | null;
  followUpSuggestion: string;
  actionPlanPreview?: string;
};

export async function postDecide(idToken: string, userInput: string): Promise<DecideApiResult> {
  const base = DECIDE_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_DECIDE_URL to your deployed Firebase `decide` function URL.');
  }
  const trimmed = String(userInput || '').trim();
  if (!trimmed) {
    throw new Error('Empty decision text.');
  }
  const url = `${base}/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ userInput: trimmed }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  const markdown = typeof data.markdown === 'string' ? data.markdown : '';
  if (!markdown.trim()) {
    throw new Error('Invalid decide response: missing markdown.');
  }
  const recommendation = typeof data.recommendation === 'string' ? data.recommendation : '';
  const confidence =
    typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : null;
  const decisionId = typeof data.decisionId === 'string' && data.decisionId ? data.decisionId : null;
  const actionPlan =
    typeof data.actionPlan === 'string' && data.actionPlan.trim() ? data.actionPlan.trim() : null;
  return { markdown, recommendation, confidence, actionPlan, decisionId };
}

export async function fetchDecisionFollowUps(
  idToken: string,
): Promise<{ items: DecisionFollowUpItem[]; defaultTemplate?: string }> {
  const base = DECIDE_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_DECIDE_URL to your deployed Firebase `decide` function URL.');
  }
  const url = `${base}/follow-ups`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as {
    items?: DecisionFollowUpItem[];
    defaultTemplate?: string;
  };
  return {
    items: Array.isArray(data.items) ? data.items : [],
    defaultTemplate: typeof data.defaultTemplate === 'string' ? data.defaultTemplate : undefined,
  };
}

export async function postDecisionOutcome(
  idToken: string,
  decisionId: string,
  executed: boolean,
  outcome?: string,
): Promise<void> {
  const base = DECIDE_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_DECIDE_URL.');
  }
  const id = String(decisionId || '').trim();
  if (!id) throw new Error('Missing decisionId.');
  const res = await fetch(`${base}/outcome`, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      decisionId: id,
      executed,
      outcome: outcome != null ? String(outcome).slice(0, 2000) : undefined,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
}

export async function postDecisionFeedback(
  idToken: string,
  decisionId: string,
  helpful: boolean,
): Promise<void> {
  const base = DECIDE_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_DECIDE_URL.');
  }
  const id = String(decisionId || '').trim();
  if (!id) throw new Error('Missing decisionId.');
  const feedbackUrl = `${base}/feedback`;
  const res = await fetch(feedbackUrl, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ decisionId: id, helpful }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
}

export type GenerateInsightResult =
  | { skipped: true; reason: string; patterns?: unknown }
  | { skipped: false; insightId: string; markdown: string; patternSummary: string };

export async function postGenerateBehaviorInsight(
  idToken: string,
  opts?: { force?: boolean },
): Promise<GenerateInsightResult> {
  const base = BEHAVIOR_INSIGHT_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_BEHAVIOR_INSIGHT_URL to your deployed `behaviorInsight` function URL.');
  }
  const res = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ force: opts?.force === true }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (data.skipped === true) {
    return {
      skipped: true,
      reason: String(data.reason || 'unknown'),
      patterns: data.patterns,
    };
  }
  return {
    skipped: false,
    insightId: String(data.insightId || ''),
    markdown: String(data.markdown || ''),
    patternSummary: String(data.patternSummary || ''),
  };
}

export async function postInsightHelpfulFeedback(
  idToken: string,
  insightId: string,
  helpful: boolean,
): Promise<void> {
  const base = BEHAVIOR_INSIGHT_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_BEHAVIOR_INSIGHT_URL.');
  }
  const id = String(insightId || '').trim();
  if (!id) throw new Error('Missing insightId.');
  const res = await fetch(`${base}/feedback`, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ insightId: id, helpful }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
}

export type GeneratePredictionResult =
  | { skipped: true; reason: string; predictionModel?: unknown }
  | { skipped: false; predictionId: string; markdown: string };

export async function postGeneratePrediction(
  idToken: string,
  body: {
    sessionId: string;
    afterDecision?: boolean;
    newDecisionHint?: string;
    force?: boolean;
  },
): Promise<GeneratePredictionResult> {
  const base = PREDICTION_URL.replace(/\/$/, '');
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_PREDICTION_URL to your deployed `prediction` function URL.');
  }
  const sid = String(body.sessionId || '').trim();
  if (!sid) throw new Error('Missing sessionId.');
  const res = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      sessionId: sid,
      afterDecision: body.afterDecision === true,
      newDecisionHint: body.newDecisionHint,
      force: body.force === true,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (data.skipped === true) {
    return {
      skipped: true,
      reason: String(data.reason || 'unknown'),
      predictionModel: data.predictionModel,
    };
  }
  return {
    skipped: false,
    predictionId: String(data.predictionId || ''),
    markdown: String(data.markdown || ''),
  };
}

export async function analyzeDecisionAdvisor(userInput: string): Promise<{ markdown: string }> {
  const trimmed = String(userInput || '').trim();
  if (!trimmed) throw new Error('Empty user_input.');
  const res = await fetch(DECISION_ADVISOR_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ user_input: trimmed }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  return JSON.parse(raw) as { markdown: string };
}

export async function extractTopicsFromUserMessage(message: string): Promise<string[]> {
  const trimmed = String(message || '').trim();
  if (!trimmed) return [];
  try {
    const res = await fetch(EXTRACT_TOPICS_URL, {
      method: 'POST',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ message: trimmed.slice(0, 4000) }),
    });
    const raw = await res.text();
    if (!res.ok) return [];
    const data = JSON.parse(raw) as { topics?: string[] };
    if (!Array.isArray(data.topics)) return [];
    return data.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  } catch {
    return [];
  }
}

/** One follow-up suggestion chip per app session (JS runtime); resets on reload. */
let suggestionSessionId: string | null = null;
function getSuggestionSessionId(): string {
  if (!suggestionSessionId) {
    suggestionSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }
  return suggestionSessionId;
}

export type VoicePerson =
  | 'twin'
  | 'x'
  | 'mom'
  | 'mother'
  | 'dad'
  | 'father'
  | 'sister'
  | 'brother'
  | 'grandma'
  | 'grandpa'
  | 'friend';

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
  /** At most one optional follow-up line from the server (proactive hint). */
  nextActionSuggestion?: string | null;
};

export type AutonomousChatResult = ChatResultSingle & {
  goal?: string;
  agentTrace?: unknown[];
  agentReflections?: unknown[];
  loopsUsed?: number;
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
function clientTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function parseReplyText(data: Record<string, unknown>): string {
  const keys = ['reply', 'answer', 'message', 'response', 'content', 'text'] as const;
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  throw new Error('Invalid API response: expected a string field (reply, answer, message, …)');
}

/**
 * POST JSON body `{ message, ...extras }` — chat / ask contract for Cloud Run.
 */
export async function postJsonMessage(
  url: string,
  message: string,
  extras?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const body = { message, ...extras };
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify(body),
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

export type CompanionInitiativePayload = {
  userId: string;
  time: string;
  timeOfDay: string;
  proactiveSessionId: string;
  lastMessageHint?: string;
  /** Recent topic hints from client retention (max ~8 strings). */
  lastTopics?: string[];
  /** Optional mood label from client heuristics (e.g. inferMood). */
  clientMood?: string;
};

export type CompanionInitiativeResult = {
  shouldInitiate: boolean;
  reason?: string;
  message?: string | null;
  /** Client should wait this many ms before showing the line (non-blocking). */
  delayMs?: number;
};

export async function fetchCompanionInitiative(
  payload: CompanionInitiativePayload,
): Promise<CompanionInitiativeResult> {
  const res = await fetch(COMPANION_INITIATIVE_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error('[api] /companion/initiative error', { status: res.status, raw });
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  return JSON.parse(raw) as CompanionInitiativeResult;
}

export async function fetchAgentNews(): Promise<string> {
  const base = GET_NEWS_AGENT_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/`, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: '{}',
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `getNews HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  const text =
    (typeof data.reply === 'string' && data.reply) ||
    (typeof data.content === 'string' && data.content) ||
    '';
  if (!text.trim()) throw new Error('getNews: empty response');
  return text.trim();
}

export async function fetchAgentSleepStory(): Promise<string> {
  const base = SLEEP_STORY_AGENT_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/`, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: '{}',
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `sleepStory HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as { story?: string };
  const story = String(data.story ?? '').trim();
  if (!story) throw new Error('sleepStory: empty response');
  return story;
}

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
  _person: VoicePerson = 'twin',
  _location?: LatLng | null,
  options?: {
    userId?: string;
    conversationHistory?: { message: string; response: string }[];
  },
): Promise<ChatResultSingle> {
  try {
    const url = companionChatPostUrl();
    const extras: Record<string, unknown> = {};
    if (options?.userId) extras.userId = options.userId;
    if (options?.conversationHistory?.length) {
      extras.conversationHistory = options.conversationHistory;
    }
    extras.timeOfDay = clientTimeOfDay();
    extras.suggestionSessionId = getSuggestionSessionId();
    if (_location != null) extras.location = _location;
    console.log('[api] POST chat', { url });
    const data = await postJsonMessage(url, message.trim(), extras);
    const reply = parseReplyText(data);
    const nas = data.nextActionSuggestion;
    return {
      reply,
      memoryHint: typeof data.memoryHint === 'string' ? data.memoryHint : null,
      nearbySuggestions: Array.isArray(data.nearbySuggestions)
        ? (data.nearbySuggestions as NearbyPlaceSuggestion[])
        : undefined,
      nearbySource: typeof data.nearbySource === 'string' ? data.nearbySource : undefined,
      nextActionSuggestion:
        typeof nas === 'string' && nas.trim() ? nas.trim() : nas === null ? null : undefined,
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
  const uid = userId.trim() || 'local-user';
  const q = question.trim();
  if (!q) {
    throw new Error('askTwinRag: empty question');
  }
  const recent = await getRecentMessages(uid, 5);
  try {
    console.log('[api] POST ask', { url: ASK_RAG_URL });
    const data = await postJsonMessage(ASK_RAG_URL, q, {
      userId: uid,
      conversationHistory: recent,
    });
    const answer = parseReplyText(data);
    await saveMessage(uid, q, answer);
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
  person: VoicePerson = 'twin',
): Promise<AudioPayload> {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    throw new Error('textToSpeech: empty text');
  }
  try {
    const idToken = await getFirebaseIdToken();
    const ttsNeedsAuth = /\.run\.app|720055631944/.test(TTS_URL);
    if (ttsNeedsAuth && !idToken) {
      throw new Error(
        'Voice output requires a signed-in user. Sign in with Firebase and try again.',
      );
    }
    const headers: Record<string, string> = {
      ...JSON_HEADERS,
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    };
    console.log('[api] POST /tts start', { url: TTS_URL, person, hasAuth: Boolean(idToken) });
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: trimmed, person }),
    });
    const raw = await res.text();
    console.log('[api] POST /tts response', { status: res.status, bytes: raw.length });
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
  _person: VoicePerson = 'twin',
): Promise<TranscribeResult> => {
  void _person;
  if (!uri) throw new Error('Missing recording URI.');
  console.log('[transcribe] multipart →', TRANSCRIBE_URL);

  const formData = new FormData();
  formData.append('file', {
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

  const raw = await res.text();
  console.log('[transcribe] response:', { status: res.status, raw: raw.slice(0, 200) });

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

/** Voice pipeline: POST /chat with `{ message, person }` → `{ reply }` (persona branch on server). */
export async function postVoicePersonChat(
  message: string,
  person: VoicePerson,
): Promise<{ reply: string }> {
  const trimmed = String(message || '').trim();
  if (!trimmed) throw new Error('postVoicePersonChat: empty message.');
  const url = companionChatPostUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({
      message: trimmed,
      person,
      /** Hint for persona /chat — server defaults to Arabic-first prompts. */
      language: 'ar',
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as { reply?: string };
  if (typeof data.reply !== 'string' || !data.reply.trim()) {
    throw new Error('Invalid /chat response: expected { reply: string }');
  }
  return { reply: data.reply.trim() };
}

export async function sendChatMessage(
  _idToken: string,
  character: Character,
  message: string,
  firebaseUserId: string | null = null,
): Promise<ChatResultSingle> {
  void character;
  void _idToken;
  const location = await getForegroundCoords();
  const uid = firebaseUserId?.trim() || null;
  const recent = uid ? await getRecentMessages(uid, 5) : [];
  const trimmed = message.trim();
  const retentionContext = uid ? await loadUserProfileForPrompt(uid) : null;

  const body: Record<string, unknown> = {
    message: trimmed,
    conversationHistory: recent,
    timeOfDay: clientTimeOfDay(),
    suggestionSessionId: getSuggestionSessionId(),
  };
  if (uid) body.userId = uid;
  if (location != null) body.location = location;
  if (retentionContext) body.retentionContext = retentionContext;

  console.log('[api] POST plan-and-run', { url: PLAN_AND_RUN_URL });
  const res = await fetch(PLAN_AND_RUN_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  console.log('[api] plan-and-run response', { status: res.status, raw: raw.slice(0, 500) });
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  const reply = parseReplyText(data);
  const mime = (data.audioMimeType ?? data.mimeType) as string | undefined;
  const audio =
    typeof data.audioBase64 === 'string' && typeof mime === 'string' && mime
      ? {
          audioBase64: data.audioBase64,
          audioMimeType: mime,
          mimeType: typeof data.mimeType === 'string' ? data.mimeType : undefined,
          voice: typeof data.voice === 'string' ? data.voice : 'default',
        }
      : null;

  const nas = data.nextActionSuggestion;
  const result: ChatResultSingle = {
    reply,
    audio,
    memoryHint: typeof data.memoryHint === 'string' ? data.memoryHint : null,
    nearbySuggestions: Array.isArray(data.nearbySuggestions)
      ? (data.nearbySuggestions as NearbyPlaceSuggestion[])
      : undefined,
    nearbySource: typeof data.nearbySource === 'string' ? data.nearbySource : undefined,
    nextActionSuggestion:
      typeof nas === 'string' && nas.trim() ? nas.trim() : nas === null ? null : undefined,
  };

  if (uid && result.reply) {
    await saveMessage(uid, trimmed, result.reply);
    const topics = await extractTopicsFromUserMessage(trimmed);
    void updateCompanionFirestoreProfile(uid, trimmed, topics);
  }
  return result;
}

/**
 * Autonomous agent: up to 2 think→act cycles per request with timeout safety.
 * Same persistence as {@link sendChatMessage} when `firebaseUserId` is set.
 */
export async function sendAutonomousAgentMessage(
  _idToken: string,
  character: Character,
  message: string,
  firebaseUserId: string | null = null,
): Promise<AutonomousChatResult> {
  void character;
  void _idToken;
  const location = await getForegroundCoords();
  const uid = firebaseUserId?.trim() || null;
  const recent = uid ? await getRecentMessages(uid, 5) : [];
  const trimmed = message.trim();

  const retentionContext = uid ? await loadUserProfileForPrompt(uid) : null;

  const body: Record<string, unknown> = {
    message: trimmed,
    conversationHistory: recent,
    suggestionSessionId: getSuggestionSessionId(),
  };
  if (uid) body.userId = uid;
  if (location != null) body.location = location;
  if (retentionContext) body.retentionContext = retentionContext;

  console.log('[api] POST agent/autonomous', { url: AUTONOMOUS_AGENT_URL });
  const res = await fetch(AUTONOMOUS_AGENT_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(parseApiErrorBody(raw) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  const reply = parseReplyText(data);
  const mime = (data.audioMimeType ?? data.mimeType) as string | undefined;
  const audio =
    typeof data.audioBase64 === 'string' && typeof mime === 'string' && mime
      ? {
          audioBase64: data.audioBase64,
          audioMimeType: mime,
          mimeType: typeof data.mimeType === 'string' ? data.mimeType : undefined,
          voice: typeof data.voice === 'string' ? data.voice : 'default',
        }
      : null;

  const nas = data.nextActionSuggestion;
  const result: AutonomousChatResult = {
    reply,
    audio,
    memoryHint: typeof data.memoryHint === 'string' ? data.memoryHint : null,
    nearbySuggestions: Array.isArray(data.nearbySuggestions)
      ? (data.nearbySuggestions as NearbyPlaceSuggestion[])
      : undefined,
    nearbySource: typeof data.nearbySource === 'string' ? data.nearbySource : undefined,
    nextActionSuggestion:
      typeof nas === 'string' && nas.trim() ? nas.trim() : nas === null ? null : undefined,
    goal: typeof data.goal === 'string' ? data.goal : undefined,
    agentTrace: Array.isArray(data.agentTrace) ? data.agentTrace : undefined,
    agentReflections: Array.isArray(data.agentReflections) ? data.agentReflections : undefined,
    loopsUsed: typeof data.loopsUsed === 'number' ? data.loopsUsed : undefined,
  };

  if (uid && result.reply) {
    await saveMessage(uid, trimmed, result.reply);
    const topics = await extractTopicsFromUserMessage(trimmed);
    void updateCompanionFirestoreProfile(uid, trimmed, topics);
  }
  return result;
}

export async function synthesizeSpeech(
  _idToken: string,
  _character: Character,
  text: string,
): Promise<AudioPayload> {
  void _character;
  return textToSpeech(text, 'twin');
}
