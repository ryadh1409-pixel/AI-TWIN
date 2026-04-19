const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { default: OpenAI, toFile } = require('openai');
const {
  getUserMemory,
  updateUserMemory,
  appendConversation,
  getRecentConversations,
  recordProactiveSent,
  recordCompanionSignals,
  getInteractionGapMs,
  markInteractionStart,
  getSuggestionSessionCount,
  recordSuggestionDelivered,
  getInitiativeSessionCount,
  recordInitiativeDelivered,
} = require('./memory');
const { fetchNearbyPlaces, formatDistance } = require('./places');
const { runPlanningAgent } = require('./agent/planAndRun');
const { suggestNextAction } = require('./suggestNextAction');
const { shouldSuggest, buildTimeOfDaySuggestHint } = require('./suggestTiming');
const {
  randomInitiativeDelayMs,
  fetchUserProfileDoc,
  summarizeProfileForPrompt,
} = require('./proactiveCompanion');
const { shouldInitiate } = require('./companionInitiative');
const { FieldValue } = require('firebase-admin/firestore');
const {
  COMPANION_SYSTEM_PROMPT,
  COMPANION_TRAITS,
  buildToneDirective,
  buildRichMemoryContext,
} = require('./companionPersona');
const { analyzeUserSignals } = require('./companionSignals');
const { runAgent } = require('./agent/autonomousAgent');
const { runDecisionJson, runStartupAdvisorMarkdown } = require('./decisionEngine');
const { updateUserProfile } = require('./userProfileLearn');
const { requireAuth, enforceUserId } = require('./middleware/requireAuth');
const { initFirebaseAdmin } = require('../../server/agent/firebase');

// Initialize firebase-admin eagerly so requireAuth can verify ID tokens.
initFirebaseAdmin();

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
/** Same as root `server.js` RAG /ask (Cloud Run often runs this file without server.js). */
const OPENAI_ASK_MODEL =
  process.env.OPENAI_ASK_MODEL ||
  process.env.OPENAI_AGENT_MODEL ||
  OPENAI_CHAT_MODEL;
const ASK_RAG_SYSTEM_PROMPT = `You are an incredibly genius and funny AI Twin.
You MUST remember everything the user tells you in this conversation.
If user tells you their name, age, job or any personal info - remember it and use it.
Current conversation history is included in the messages.
Be witty, brilliant and hilarious.
Default language: Arabic (natural, modern — Gulf/Levantine casual is fine). Use English only when the user clearly writes or speaks in English.`;
const askRagSessions = new Map();
const MAX_ASK_RAG_MESSAGES = 20;
function getAskRagSessionHistory(userId) {
  if (!askRagSessions.has(userId)) {
    askRagSessions.set(userId, []);
  }
  return askRagSessions.get(userId);
}
function trimAskRagSessionHistory(arr) {
  while (arr.length > MAX_ASK_RAG_MESSAGES) {
    arr.shift();
  }
}
const X_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/** ElevenLabs premade voices — map `person` from POST /tts and persona /chat. */
const PERSON_TO_VOICE_ID = {
  x: X_VOICE_ID,
  twin: X_VOICE_ID,
  mom: '21m00Tcm4TlvDq8ikWAM',
  mother: '21m00Tcm4TlvDq8ikWAM',
  dad: 'TxGEqnHWrfWFTfGW9XjX',
  father: 'TxGEqnHWrfWFTfGW9XjX',
  sister: 'MF3mGyEYCl7XYWbV9V6O',
  brother: 'JBFqnCBsd6RMkjVDRZFK',
  grandma: 'ThT5KcBeYPX3keUQqHPh',
  grandpa: 'onwK4e9ZLuTAKqWP03r9',
  friend: 'ErXwobaYiN019PkySvjV',
};

const PERSONA_SYSTEM_PROMPTS = {
  mom: `You are a warm, caring mother figure. Short replies (1–3 sentences). Supportive, gentle humor, no guilt-tripping. Default to natural Arabic; use English only if the user clearly uses English.`,
  dad: `You are a steady, wise father figure. Practical, calm, lightly humorous. Short (1–3 sentences). Encourage without lecturing. Default to natural Arabic; use English only if the user clearly uses English.`,
  sister: `You are a playful older sister: teasing but kind. Very short, energetic. Default to Arabic; English only if the user clearly uses English.`,
  brother: `You are a supportive brother: direct, casual, a little joking. Very short. Default to Arabic; English only if the user clearly uses English.`,
  grandma: `You are a kind grandmother: warm stories, soft advice. Short. Default to Arabic; English only if the user clearly uses English.`,
  grandpa: `You are a wise grandfather: calm perspective, dry wit. Short. Default to Arabic; English only if the user clearly uses English.`,
  friend: `You are the user's best friend: casual, loyal, fun. Short. Default to Arabic; English only if the user clearly uses English.`,
  twin: `You are the user's AI twin — brilliant, witty, concise (1–3 sentences). Default to natural Arabic (MSA or casual dialect). Use English only when the user clearly writes or speaks in English.`,
  x: `You are the user's AI twin — brilliant, witty, concise (1–3 sentences). Default to natural Arabic. Use English only when the user clearly writes or speaks in English.`,
};

function normalizePersonKey(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (PERSON_TO_VOICE_ID[k]) return k;
  return 'twin';
}

function voiceIdForPerson(person) {
  const k = normalizePersonKey(person);
  return PERSON_TO_VOICE_ID[k] || X_VOICE_ID;
}

const GET_NEWS_AGENT_URL_NODE =
  process.env.GET_NEWS_URL ||
  process.env.EXPO_PUBLIC_GET_NEWS_URL ||
  'https://getnews-gehsfp2zqa-uc.a.run.app';
const SLEEP_STORY_AGENT_URL_NODE =
  process.env.SLEEP_STORY_URL ||
  process.env.EXPO_PUBLIC_SLEEP_STORY_URL ||
  'https://sleepstory-gehsfp2zqa-uc.a.run.app';

/** AI Twin personality (matches root server.js RAG + vision). */
const AI_TWIN_SYSTEM_PROMPT = `You are an incredibly genius AI Twin - brilliant, witty, and hilarious.
You have the intelligence of Einstein, the humor of a stand-up comedian,
and the wisdom of a philosopher. You:
- Give genius-level insights but explain them in a fun, engaging way
- Add clever jokes, witty remarks, and funny observations naturally
- Use analogies that are both brilliant and amusing
- Occasionally roast the user in a friendly, playful way
- React with excitement when discussing interesting topics
- Keep responses concise but packed with value and humor
- Use emojis occasionally to express personality 🧠✨😄
Always be helpful, but make the conversation feel like talking to the
smartest and funniest friend you've ever had.

When retrieved context from the user's knowledge base is provided below, ground your answer in it; if it is insufficient, say so clearly—but stay in character.
When the user sends an image, describe and discuss it with the same witty, genius tone.
Keep answers to at most 3–4 sentences unless the question clearly needs more (e.g. step-by-step instructions).`;

const TORONTO_PLACES = ['High Park', 'Yorkdale Mall', 'Eaton Centre'];

/** Rough bounding box for Greater Toronto (for lat/lng hints). */
function isInTorontoArea(lat, lng) {
  return lat >= 43.55 && lat <= 43.9 && lng >= -79.7 && lng <= -79.1;
}

function parseLocation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lat =
    typeof raw.lat === 'number'
      ? raw.lat
      : typeof raw.latitude === 'number'
        ? raw.latitude
        : null;
  const lng =
    typeof raw.lng === 'number'
      ? raw.lng
      : typeof raw.longitude === 'number'
        ? raw.longitude
        : null;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseLocationFromRequest(value) {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return parseLocation(value);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseLocation(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeForSpeech(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\*/g, '')
    .trim();
}

function getUserId(value) {
  const userId = typeof value === 'string' ? value.trim() : '';
  return userId || 'local-user';
}

function getAdminFirestore() {
  try {
    const { getDb } = require(path.resolve(__dirname, '../../server/agent/firebase.js'));
    return getDb();
  } catch {
    return null;
  }
}

/** Merge interests into topic hints for local memory (server memory.json). */
function mergeTopicHintsForRecord(signals) {
  if (!signals) return [];
  const out = [...(signals.topicHints || [])];
  for (const x of (signals.interests || []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 2)) {
    if (!out.some((h) => String(h).toLowerCase() === x.toLowerCase())) {
      out.push(x);
    }
  }
  return out.slice(0, 6);
}

function extractMemoryData(text) {
  const cleaned = normalizeForSpeech(text);
  const update = {};

  const nameMatch =
    cleaned.match(/(?:اسمي|انا اسمي)\s+([^\s،,.!?]+)/i) ||
    cleaned.match(/(?:my name is|i am)\s+([A-Za-z]+)\b/i);
  if (nameMatch) {
    update.name = nameMatch[1];
  }

  const cityMatch =
    cleaned.match(/(?:انا من|ساكن في|عايش في)\s+([^\s،,.!?]+)/i) ||
    cleaned.match(/(?:i live in|i am in|from)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
  if (cityMatch) {
    update.city = cityMatch[1];
  }

  const likesMatch =
    cleaned.match(/(?:احب|أحب|بحب)\s+([^\n]+)/i) ||
    cleaned.match(/i like\s+([^\n]+)/i);
  if (likesMatch) {
    const candidate = likesMatch[1]
      .split(/،|,| و | and /i)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (candidate.length > 0) {
      update.preferences = candidate;
    }
  }

  return update;
}

function formatPlaceLine(p) {
  const stars = p.rating != null ? `${p.rating}★` : '';
  const dist = formatDistance(p.distanceM);
  const bits = [p.name, stars, dist].filter(Boolean);
  return bits.join(' — ');
}

function maybeGetPlaceSuggestion(text, memory, locationMeta, nearbyBundle) {
  const input = normalizeForSpeech(text).toLowerCase();
  const hasKeyword =
    /(طفشان|زهقان|مطفش|bored|where to go|what to do|walking|walk|وين اروح|وش اسوي|وين نروح)/i.test(
      input,
    );

  if (!hasKeyword) return null;

  const places = nearbyBundle?.places || [];
  if (places.length > 0) {
    const lines = places.slice(0, 3).map((p) => `- ${formatPlaceLine(p)}`);
    return `يا صاحبي، خلينا نكسر الملل شوي. هذي أماكن قريبة منك حسب موقعك:
${lines.join('\n')}
إذا ودك، أختار لك واحد حسب مزاجك اليوم.`;
  }

  const city = memory.city ? String(memory.city) : 'منطقتك';
  const torontoNote = locationMeta?.inToronto
    ? ' (قريب من تورنتو — جرب High Park أو Yorkdale أو Eaton Centre)'
    : '';
  return `يا صاحبي، خلينا نكسر الملل شوي. بما إنك غالبًا في ${city}${torontoNote}، جرب:
- ${TORONTO_PLACES[0]}
- ${TORONTO_PLACES[1]}
- ${TORONTO_PLACES[2]}
إذا ودك، أختار لك واحد حسب مزاجك اليوم.`;
}

function buildProactiveWithNearby(locationMeta, nearbyBundle) {
  const places = nearbyBundle?.places || [];
  if (places.length > 0) {
    const names = places
      .slice(0, 3)
      .map((p) => p.name)
      .join('، ');
    return `واضح إنك محتاج تغيير جو. شرايك نطلع مشوار خفيف؟ قريب منك: ${names}. تبغى أرتب لك فكرة أنسب؟`;
  }
  if (locationMeta?.inToronto) {
    return `واضح إنك محتاج تغيير جو. شرايك نطلع مشوار خفيف؟ عندك ${TORONTO_PLACES[0]} أو ${TORONTO_PLACES[1]} أو حتى لفة في ${TORONTO_PLACES[2]}.`;
  }
  return `واضح إنك محتاج تغيير جو. شرايك نطلع مشوار خفيف؟ دور على كوفي أو مطعم أو حديقة قريبة منك.`;
}

function isVagueInput(text) {
  const cleaned = normalizeForSpeech(text);
  if (!cleaned) return true;
  const tokens = cleaned.split(' ').filter(Boolean);
  const vagueWords = ['طفشان', 'زهقان', 'مدري', 'مو عارف', 'ماني عارف', 'bored'];
  return tokens.length <= 2 || vagueWords.some((word) => cleaned.toLowerCase().includes(word));
}

function buildMemoryHint(memory) {
  if (memory.preferences && memory.preferences.length > 0) {
    return `أذكر إنك ذكرت قبل إنك تحب ${memory.preferences[0]}`;
  }
  const top = Array.isArray(memory.frequentTopics) ? memory.frequentTopics[0] : null;
  if (top && (top.count || 0) >= 2 && top.label) {
    return `لاحظت إنك ترجع على موضوع ${top.label} — قدامنا نفهم أكثر لو حاب`;
  }
  if (memory.city) {
    return `أتذكر إنك في ${memory.city}`;
  }
  if (memory.name) {
    return `أهلاً يا ${memory.name}`;
  }
  return null;
}

const PROACTIVE_FALLBACK_LINES = [
  'وش خطتك اليوم؟',
  'تبغى أطلع لك مكان قريب؟',
  'كيفك؟ وش حاب تسوي اليوم؟',
  'صار لي فترة ما سمعت أخبارك، وش الجديد؟',
  'تبغى نفكر سوا بخطة خفيفة لليوم؟',
];

function hoursSinceIso(iso) {
  if (!iso || typeof iso !== 'string') return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3600000;
}

function timeOfDayBucket(d) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function resolveTimeOfDayFromRequest(body) {
  const t = typeof body?.timeOfDay === 'string' ? body.timeOfDay.trim().toLowerCase() : '';
  const allowed = new Set(['morning', 'afternoon', 'evening', 'night']);
  if (allowed.has(t)) return t;
  return timeOfDayBucket(new Date());
}

function buildServerMemorySummary(memory) {
  const parts = [];
  if (memory.name) parts.push(`الاسم: ${memory.name}`);
  if (memory.city) parts.push(`المدينة: ${memory.city}`);
  if (memory.preferences?.length) {
    parts.push(`يحب: ${memory.preferences.slice(0, 3).join('، ')}`);
  }
  if (memory.lastMood) {
    parts.push(`آخر مزاج: ${memory.lastMood}`);
  }
  const mc = memory.moodCounts;
  if (mc && typeof mc === 'object') {
    parts.push(
      `مزاج (عدد): تعبان=${mc.tired || 0}, متوتر=${mc.stressed || 0}, مبسوط=${mc.happy || 0}, عادي=${mc.neutral || 0}`,
    );
  }
  const topics = (memory.frequentTopics || [])
    .slice(0, 3)
    .map((t) => t.label)
    .filter(Boolean);
  if (topics.length) parts.push(`مواضيع متكررة: ${topics.join('، ')}`);
  return parts.join(' | ') || 'لا يوجد ملخص بعد';
}

async function generateProactiveLine({
  memorySummary,
  timeOfDay,
  locationMeta,
  inactive,
  vague,
}) {
  const locHint = locationMeta
    ? `المستخدم يشارك موقعه تقريبًا (${locationMeta.lat.toFixed(3)}, ${locationMeta.lng.toFixed(3)}).`
    : 'لا يوجد موقع حالي.';

  if (!openai) {
    const line =
      PROACTIVE_FALLBACK_LINES[
        Math.floor(Math.random() * PROACTIVE_FALLBACK_LINES.length)
      ];
    return normalizeForSpeech(line);
  }

  const completion = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.85,
    max_tokens: 48,
    messages: [
      {
        role: 'system',
        content: `${COMPANION_TRAITS} This is a proactive ping (user did not send a message). Reply with exactly one short line in Arabic (max 14 words). Calm, supportive, no emoji spam. No greeting wall — get to the point.`,
      },
      {
        role: 'user',
        content: `وقت اليوم: ${timeOfDay}. ${locHint}
ملخص ذاكرة: ${memorySummary}
إشارات: نشاط منخفض=${inactive ? 'نعم' : 'لا'}, استخدام خفيف أو غامض=${vague ? 'نعم' : 'لا'}
اقترح سطرًا واحدًا فقط (مثل: وش خطتك اليوم؟ أو تبغى أقترح مكان قريب؟)`,
      },
    ],
  });

  const line = normalizeForSpeech(completion.choices?.[0]?.message?.content);
  if (!line) {
    return PROACTIVE_FALLBACK_LINES[0];
  }
  return line;
}

async function handleProactiveRequest(body) {
  const userId = getUserId(body?.userId);
  const location = parseLocationFromRequest(body?.location);
  const locationMeta = location
    ? { ...location, inToronto: isInTorontoArea(location.lat, location.lng) }
    : null;

  const clientTimeRaw = body?.time;
  const clientTime =
    typeof clientTimeRaw === 'string' && clientTimeRaw.trim()
      ? new Date(clientTimeRaw)
      : new Date();
  const timeOfDay =
    typeof body?.timeOfDay === 'string' && body.timeOfDay.trim()
      ? body.timeOfDay.trim()
      : timeOfDayBucket(Number.isNaN(clientTime.getTime()) ? new Date() : clientTime);

  const lastActivityIso =
    typeof body?.lastActivity === 'string' ? body.lastActivity.trim() : '';

  const clientMemory =
    typeof body?.memory === 'string'
      ? body.memory.trim()
      : typeof body?.lastMemory === 'string'
        ? body.lastMemory.trim()
        : '';

  const memory = getUserMemory(userId);
  const serverSummary = buildServerMemorySummary(memory);
  const memorySummary = [serverSummary, clientMemory].filter(Boolean).join(' | ');

  const lastProactiveAt = memory.lastProactiveAt;
  const minHoursBetweenServer = 8;
  if (lastProactiveAt && hoursSinceIso(lastProactiveAt) < minHoursBetweenServer) {
    return { message: null, skip: true, reason: 'server_rate_limit' };
  }

  const interactions = memory.pastInteractions || [];
  const lastUserMsg = [...interactions].reverse().find((m) => m.role === 'user');
  const hoursSinceLastAppActivity = hoursSinceIso(lastActivityIso);
  const hoursSinceLastChat = lastUserMsg?.at ? hoursSinceIso(lastUserMsg.at) : Infinity;

  const inactive = hoursSinceLastAppActivity > 14 || hoursSinceLastChat > 20;
  const vague =
    interactions.length < 4 ||
    (lastUserMsg && String(lastUserMsg.message).trim().length < 10);

  if (!inactive && !vague) {
    return { message: null, skip: true, reason: 'not_due' };
  }

  let probability = 0.28;
  if (inactive && vague) probability = 0.42;
  else if (inactive) probability = 0.38;
  else if (vague) probability = 0.32;

  if (Math.random() > probability) {
    return { message: null, skip: true, reason: 'occasional' };
  }

  let message;
  try {
    message = await generateProactiveLine({
      memorySummary,
      timeOfDay,
      locationMeta,
      inactive,
      vague,
    });
  } catch (e) {
    console.warn('[proactive] generate failed:', e?.message || e);
    message = normalizeForSpeech(
      PROACTIVE_FALLBACK_LINES[
        Math.floor(Math.random() * PROACTIVE_FALLBACK_LINES.length)
      ],
    );
  }

  recordProactiveSent(userId);

  return {
    message,
    skip: false,
    reason: 'ok',
    timeOfDay,
  };
}

async function transcribeWithOpenAI(file) {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is missing in .env');
  }

  const uploadFile = await toFile(
    file.buffer,
    file.originalname || 'recording.m4a',
    { type: file.mimetype || 'audio/m4a' },
  );

  const transcript = await openai.audio.transcriptions.create({
    model: OPENAI_TRANSCRIBE_MODEL,
    file: uploadFile,
  });

  const text = normalizeForSpeech(transcript?.text);
  if (!text) {
    throw new Error('Transcription returned empty text.');
  }
  return text;
}

function conversationHistoryToMessages(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  const out = [];
  for (const p of pairs.slice(-5)) {
    const u = String(p?.message ?? '').trim();
    const a = String(p?.response ?? '').trim();
    if (u) out.push({ role: 'user', content: u.slice(0, 8000) });
    if (a) out.push({ role: 'assistant', content: a.slice(0, 8000) });
  }
  return out;
}

async function replyWithOpenAI(
  text,
  memory,
  recentConversations,
  locationMeta,
  nearbyPromptBlock,
  conversationHistoryPairs,
  companionContext,
  retentionContextBlock = null,
) {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is missing in .env');
  }

  const messages = [
    { role: 'system', content: COMPANION_SYSTEM_PROMPT },
    { role: 'system', content: buildRichMemoryContext(memory, recentConversations) },
  ];

  const rb = retentionContextBlock && String(retentionContextBlock).trim();
  if (rb) {
    messages.push({
      role: 'system',
      content: `App retention (activity, streaks, topics — weave in only when natural; never lecture or quote JSON):\n${rb.slice(0, 2200)}`,
    });
  }

  if (companionContext?.toneDirective) {
    messages.push({ role: 'system', content: companionContext.toneDirective });
  }

  if (locationMeta) {
    messages.push({
      role: 'system',
      content: `User location:\nLatitude: ${locationMeta.lat}\nLongitude: ${locationMeta.lng}`,
    });
    if (nearbyPromptBlock) {
      messages.push({
        role: 'system',
        content: nearbyPromptBlock,
      });
    } else if (locationMeta.inToronto) {
      messages.push({
        role: 'system',
        content:
          'The user is in the Toronto area. When it fits the conversation, you may naturally suggest: High Park, Yorkdale Mall, or the Eaton Centre (e.g. proximity to downtown). Keep Arabic casual and natural.',
      });
    }
  }

  messages.push(...conversationHistoryToMessages(conversationHistoryPairs));

  messages.push({ role: 'user', content: normalizeForSpeech(text) });

  const completion = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.62,
    max_tokens: 400,
    messages,
  });

  const reply = normalizeForSpeech(completion.choices?.[0]?.message?.content);
  if (!reply) {
    throw new Error('OpenAI chat returned empty reply.');
  }
  return reply;
}

async function synthesizeWithElevenLabs(text, personOrVoiceKey = 'twin') {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('Missing ELEVENLABS_API_KEY in .env');
  }

  const voiceId = voiceIdForPerson(personOrVoiceKey);
  console.log('[tts] ElevenLabs voice:', voiceId, 'person:', personOrVoiceKey);

  const elevenRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: normalizeForSpeech(text),
        model_id: 'eleven_multilingual_v2',
      }),
    },
  );

  if (!elevenRes.ok) {
    const detail = await elevenRes.text();
    throw new Error(`ElevenLabs failed: ${detail || elevenRes.status}`);
  }

  const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());
  return {
    audioBase64: audioBuffer.toString('base64'),
    mimeType: 'audio/mpeg',
    voice: voiceId,
  };
}

/** Core companion reply without appending to conversation (for planning agent chat steps). */
async function runCompanionReplyCore({
  userId,
  text,
  location: rawLocation,
  conversationHistory,
  companionContext,
  retentionContextBlock = null,
}) {
  const memory = getUserMemory(userId);
  const recentConversations = getRecentConversations(userId, 3);

  const parsed = parseLocationFromRequest(rawLocation);
  const locationMeta = parsed
    ? { ...parsed, inToronto: isInTorontoArea(parsed.lat, parsed.lng) }
    : null;

  let nearbyBundle = { places: [], promptBlock: null, source: 'none' };
  if (locationMeta) {
    nearbyBundle = await fetchNearbyPlaces(locationMeta.lat, locationMeta.lng);
  }

  const toolReply = maybeGetPlaceSuggestion(
    text,
    memory,
    locationMeta,
    nearbyBundle,
  );
  const proactiveReply =
    !toolReply && isVagueInput(text)
      ? buildProactiveWithNearby(locationMeta, nearbyBundle)
      : null;

  const nearbyPromptBlock =
    locationMeta && nearbyBundle.promptBlock ? nearbyBundle.promptBlock : null;

  const reply = toolReply || proactiveReply
    ? normalizeForSpeech(toolReply || proactiveReply)
    : await replyWithOpenAI(
        text,
        memory,
        recentConversations,
        locationMeta,
        nearbyPromptBlock,
        conversationHistory,
        companionContext || null,
        retentionContextBlock || null,
      );

  return {
    reply,
    memoryHint: buildMemoryHint(getUserMemory(userId)),
    nearbySuggestions: nearbyBundle.places || [],
    nearbySource: nearbyBundle.source || 'none',
  };
}

async function generateCompanionReply({
  userId,
  text,
  location: rawLocation,
  conversationHistory,
}) {
  const interactionGapMs = getInteractionGapMs(userId);
  markInteractionStart(userId);

  const memoryUpdate = extractMemoryData(text);
  if (Object.keys(memoryUpdate).length > 0) {
    updateUserMemory(userId, memoryUpdate);
  }

  let companionContext = null;
  let profileSignals = null;
  if (openai) {
    try {
      profileSignals = await analyzeUserSignals(openai, OPENAI_CHAT_MODEL, text);
      recordCompanionSignals(userId, {
        mood: profileSignals.mood,
        topicHints: mergeTopicHintsForRecord(profileSignals),
      });
      companionContext = {
        mood: profileSignals.mood,
        toneDirective: buildToneDirective(profileSignals.mood),
      };
    } catch (e) {
      console.warn('[companion] signals:', e?.message || e);
    }
  }

  appendConversation(userId, {
    role: 'user',
    message: text,
  });

  const out = await runCompanionReplyCore({
    userId,
    text,
    location: rawLocation,
    conversationHistory,
    companionContext,
    retentionContextBlock: null,
  });

  appendConversation(userId, {
    role: 'assistant',
    message: out.reply,
  });

  if (profileSignals && userId !== 'local-user') {
    void updateUserProfile({ userId, signals: profileSignals }).catch((e) =>
      console.warn('[user_profile]', e?.message || e),
    );
  }

  return { ...out, profileSignals, interactionGapMs };
}

// --- CORS: strict allowlist from env (CORS_ORIGINS=comma,separated,origins) ---
const CORS_ALLOWLIST = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // Same-origin / native apps / curl send no Origin header — allow them.
    if (!origin) return cb(null, true);
    if (CORS_ALLOWLIST.includes('*')) return cb(null, true);
    if (CORS_ALLOWLIST.includes(origin)) return cb(null, true);
    console.warn(`[cors] blocked origin: ${origin}`);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const t = new Date().toISOString();
  const ct = req.headers['content-type'] || '';
  console.log(`[http] ${t} ${req.method} ${req.originalUrl} ct=${String(ct).slice(0, 72)}`);
  res.on('finish', () => {
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

app.get('/', (_req, res) => {
  res.status(200).send('Server is running');
});

/**
 * RAG-style text ask (same JSON contract as root `server.js` POST /ask).
 * Cloud Run deploys this Express app without `server.js`, so this route must exist here.
 * Note: FAISS uploads live on root server when using `node server.js`; this handler answers
 * with OpenAI + in-memory session + client conversationHistory (no server-side FAISS here).
 */
app.post('/ask', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }

    const question = String(
      req.body?.message || req.body?.question || '',
    ).trim();
    const userId = getUserId(req.body?.userId);

    if (!question) {
      return res.status(400).json({ error: 'Missing question.' });
    }

    const history = getAskRagSessionHistory(userId);
    const clientPairs = Array.isArray(req.body?.conversationHistory)
      ? req.body.conversationHistory
      : [];
    const clientMsgs = [];
    for (const p of clientPairs.slice(-5)) {
      const u = String(p?.message ?? '').trim();
      const a = String(p?.response ?? '').trim();
      if (u) clientMsgs.push({ role: 'user', content: u.slice(0, 8000) });
      if (a) clientMsgs.push({ role: 'assistant', content: a.slice(0, 8000) });
    }

    const messages = [
      { role: 'system', content: ASK_RAG_SYSTEM_PROMPT },
      ...clientMsgs,
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: question },
    ];

    console.log('[ask] RAG-lite', { userId, questionLen: question.length });

    const completion = await openai.chat.completions.create({
      model: OPENAI_ASK_MODEL,
      messages,
      temperature: 0.75,
      max_tokens: 1024,
    });

    const raw = completion.choices[0]?.message?.content;
    const answer = String(raw ?? '').trim();
    if (!answer) {
      return res.status(500).json({ error: 'Empty model response.' });
    }

    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: answer });
    trimAskRagSessionHistory(history);

    return res.status(200).json({ answer });
  } catch (error) {
    console.error('[ask] error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Ask failed.',
    });
  }
});

app.post('/agent/decide', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const conversationHistory = Array.isArray(req.body?.conversationHistory)
      ? req.body.conversationHistory
      : [];
    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }
    const histBlock =
      conversationHistory.length === 0
        ? '(no prior exchanges)'
        : conversationHistory
            .slice(-5)
            .map(
              (h, i) =>
                `[${i + 1}] user: ${String(h.message || '').slice(0, 600)}\nassistant: ${String(h.response || '').slice(0, 600)}`,
            )
            .join('\n---\n');
    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      temperature: 0,
      max_tokens: 64,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You route the user's latest message to exactly one tool.
Reply ONLY with JSON: {"tool":"getNews"|"sleepStory"|"tts"|"chat"}

Definitions:
- getNews: user wants news, headlines, Saudi/Gulf news, digest, أخبار, what's happening
- sleepStory: bedtime story, sleep, قصة نوم, story before bed, يريد قصة
- tts: user wants this text read aloud / voice output only (not a full conversation)
- chat: default conversation, questions, advice, anything else

Recent exchanges (oldest first in list):
${histBlock}`,
        },
        { role: 'user', content: message },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '{"tool":"chat"}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { tool: 'chat' };
    }
    const t = String(parsed.tool || 'chat').trim();
    const allowed = new Set(['getNews', 'sleepStory', 'tts', 'chat']);
    const tool = allowed.has(t) ? t : 'chat';
    console.log('[agent/decide]', { tool, messagePreview: message.slice(0, 100) });
    return res.status(200).json({ tool });
  } catch (err) {
    console.error('/agent/decide error:', err);
    return res.status(500).json({ error: err?.message || 'decide failed' });
  }
});

function stringifyRetentionContext(raw) {
  if (raw == null || raw === '') return '';
  try {
    return typeof raw === 'string'
      ? raw.slice(0, 3200)
      : JSON.stringify(raw).slice(0, 12000);
  } catch {
    return '';
  }
}

async function buildPlanRetentionContext(userId, clientPayload) {
  const base =
    clientPayload && typeof clientPayload === 'object' && !Array.isArray(clientPayload)
      ? { ...clientPayload }
      : {};
  const db = getAdminFirestore();
  if (!db || !userId || userId === 'local-user') {
    return stringifyRetentionContext(base);
  }
  try {
    const snap = await db.collection('user_profile').doc(userId).get();
    if (snap.exists) {
      const d = snap.data() || {};
      const uwp = {
        streakDays: d.streakDays,
        topics: d.topics,
        lastActiveAt: d.lastActiveAt,
        lastSuggestionText: d.lastSuggestionText,
        ignoredLastSuggestion: d.ignoredLastSuggestion,
        preferences: d.preferences,
        common_topics: d.common_topics,
        last_intent: d.last_intent,
      };
      const dl = d.decisionLearning;
      if (dl && typeof dl === 'object') {
        uwp.decisionLearningSummary = {
          riskTolerance: String(dl.riskTolerance || ''),
          executionRate: dl.executionRate,
          followedCount: dl.followedCount,
          skippedCount: dl.skippedCount,
        };
      }
      base.userProfileFirestore = uwp;
    }
  } catch (e) {
    console.warn('[plan] user_profile load:', e?.message || e);
  }
  try {
    const decSnap = await db
      .collection('decisions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    if (!decSnap.empty) {
      const lines = [];
      decSnap.forEach((doc) => {
        const x = doc.data() || {};
        const q = String(x.userInput || '')
          .replace(/\s+/g, ' ')
          .slice(0, 280);
        const rec = String(x.recommendation || '')
          .replace(/\s+/g, ' ')
          .slice(0, 220);
        const c = x.confidence;
        lines.push(
          `- "${q}" → ${rec}${typeof c === 'number' ? ` (${c}% confidence)` : ''}`,
        );
      });
      if (lines.length) {
        base.pastDecisionsForCompanion = lines.join('\n');
      }
    }
  } catch (e) {
    console.warn('[plan] decisions load:', e?.message || e);
  }
  try {
    const insSnap = await db
      .collection('user_insights')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (!insSnap.empty) {
      const x = insSnap.docs[0].data() || {};
      const md = String(x.markdown || '').trim();
      if (md) {
        base.latestBehaviorInsightForCompanion = md.slice(0, 900);
      }
    }
  } catch (e) {
    console.warn('[plan] user_insights load:', e?.message || e);
  }
  try {
    const predSnap = await db
      .collection('user_predictions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (!predSnap.empty) {
      const x = predSnap.docs[0].data() || {};
      const md = String(x.markdown || '').trim();
      if (md) {
        base.latestPredictionForCompanion = md.slice(0, 700);
      }
    }
  } catch (e) {
    console.warn('[plan] user_predictions load:', e?.message || e);
  }
  return stringifyRetentionContext(base);
}

/** Pull long companion prefixes out of JSON retention so they are not truncated with the rest. */
function mergeRetentionPrefixes(retentionBlock) {
  const raw = retentionBlock && String(retentionBlock).trim();
  if (!raw) return '';
  try {
    const o = JSON.parse(raw);
    const pd =
      typeof o.pastDecisionsForCompanion === 'string' ? o.pastDecisionsForCompanion.trim() : '';
    const bi =
      typeof o.latestBehaviorInsightForCompanion === 'string'
        ? o.latestBehaviorInsightForCompanion.trim()
        : '';
    const pr =
      typeof o.latestPredictionForCompanion === 'string'
        ? o.latestPredictionForCompanion.trim()
        : '';
    delete o.pastDecisionsForCompanion;
    delete o.latestBehaviorInsightForCompanion;
    delete o.latestPredictionForCompanion;
    const rest = JSON.stringify(o);
    const parts = [];
    if (pr) {
      parts.push(
        `Latest predictive hint (non-binding — do not present as fact; one subtle tie-in max):\n${pr.slice(0, 700)}`,
      );
    }
    if (bi) {
      parts.push(
        `Latest behavioral insight (use lightly to personalize tone — do not quote verbatim; stay grounded in the current user message):\n${bi.slice(0, 900)}`,
      );
    }
    if (pd) {
      parts.push(
        `Past structured decisions (reference only when clearly relevant; do not invent links):\n${pd.slice(0, 1600)}`,
      );
    }
    if (parts.length) {
      return `${parts.join('\n\n---\n\n')}\n\n---\n\n${rest}`;
    }
    return rest;
  } catch {
    /* keep as plain text */
  }
  return raw;
}

app.post('/agent/plan-and-run', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const userId = getUserId(req.body?.userId);
    const location = parseLocationFromRequest(req.body?.location);
    const conversationHistory = Array.isArray(req.body?.conversationHistory)
      ? req.body.conversationHistory
      : [];
    const retentionBlock = mergeRetentionPrefixes(
      await buildPlanRetentionContext(userId, req.body?.retentionContext),
    );
    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }

    const interactionGapMs = getInteractionGapMs(userId);
    markInteractionStart(userId);

    const memoryUpdate = extractMemoryData(message);
    if (Object.keys(memoryUpdate).length > 0) {
      updateUserMemory(userId, memoryUpdate);
    }

    let companionContext = null;
    let detectedMood = 'neutral';
    let profileSignals = null;
    try {
      profileSignals = await analyzeUserSignals(openai, OPENAI_CHAT_MODEL, message);
      recordCompanionSignals(userId, {
        mood: profileSignals.mood,
        topicHints: mergeTopicHintsForRecord(profileSignals),
      });
      detectedMood = profileSignals.mood;
      companionContext = {
        mood: profileSignals.mood,
        toneDirective: buildToneDirective(profileSignals.mood),
      };
    } catch (e) {
      console.warn('[companion] signals plan-and-run:', e?.message || e);
    }

    appendConversation(userId, { role: 'user', message });

    const fetchNews = async () => {
      const base = String(GET_NEWS_AGENT_URL_NODE).replace(/\/$/, '');
      const r = await fetch(`${base}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const raw = await r.text();
      if (!r.ok) {
        throw new Error(parseApiErrorBodyForAgent(raw) || `getNews HTTP ${r.status}`);
      }
      const data = JSON.parse(raw);
      const textOut =
        (typeof data.reply === 'string' && data.reply) ||
        (typeof data.content === 'string' && data.content) ||
        '';
      if (!String(textOut).trim()) {
        throw new Error('getNews: empty response');
      }
      return String(textOut).trim();
    };

    const fetchSleepStory = async () => {
      const base = String(SLEEP_STORY_AGENT_URL_NODE).replace(/\/$/, '');
      const r = await fetch(`${base}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const raw = await r.text();
      if (!r.ok) {
        throw new Error(parseApiErrorBodyForAgent(raw) || `sleepStory HTTP ${r.status}`);
      }
      const data = JSON.parse(raw);
      const story = typeof data.story === 'string' ? data.story : '';
      if (!String(story).trim()) {
        throw new Error('sleepStory: empty response');
      }
      return String(story).trim();
    };

    const result = await runPlanningAgent({
      openai,
      model: OPENAI_CHAT_MODEL,
      message,
      conversationHistory,
      userId,
      rawLocation: location,
      fetchNews,
      fetchSleepStory,
      synthesizeWithElevenLabs,
      runCompanionReplyCore,
      companionContext,
      detectedMood,
      retentionBlock,
    });

    appendConversation(userId, { role: 'assistant', message: result.reply });

    if (profileSignals && userId !== 'local-user') {
      void updateUserProfile({ userId, signals: profileSignals }).catch((e) =>
        console.warn('[user_profile]', e?.message || e),
      );
    }

    const payload = {
      reply: result.reply,
      memoryHint: result.memoryHint,
      nearbySuggestions: result.nearbySuggestions,
      nearbySource: result.nearbySource,
    };
    if (result.audio?.audioBase64) {
      payload.audioBase64 = result.audio.audioBase64;
      payload.mimeType = result.audio.mimeType;
      payload.audioMimeType = result.audio.mimeType;
      payload.voice = result.audio.voice;
    }

    const timeOfDay = resolveTimeOfDayFromRequest(req.body);
    const suggestionSessionId =
      typeof req.body?.suggestionSessionId === 'string' ? req.body.suggestionSessionId.trim().slice(0, 128) : '';
    const mem = getUserMemory(userId);
    const timing = shouldSuggest({
      gapMsSincePreviousUserMessage: interactionGapMs,
      lastSuggestionAtISO: mem.lastSuggestionAt,
      suggestionSessionId,
      sessionSuggestionCount: getSuggestionSessionCount(userId, suggestionSessionId),
      message,
      mood: profileSignals?.mood || mem.lastMood || 'neutral',
    });

    let nextActionSuggestion = null;
    if (openai && result.reply && timing.allow) {
      try {
        nextActionSuggestion = await suggestNextAction(openai, OPENAI_CHAT_MODEL, {
          lastUserMessage: message,
          assistantReply: result.reply,
          memorySummary: buildServerMemorySummary(mem),
          timeOfDay,
          timeOfDayHint: buildTimeOfDaySuggestHint(timeOfDay),
          conversationHistory,
        });
        if (nextActionSuggestion) {
          recordSuggestionDelivered(userId, suggestionSessionId);
        }
      } catch (e) {
        console.warn('[suggest] plan-and-run:', e?.message || e);
      }
    } else if (!timing.allow) {
      console.log('[suggest] skipped (timing):', timing.reason);
    }
    if (nextActionSuggestion) {
      payload.nextActionSuggestion = nextActionSuggestion;
    }

    console.log('[agent/plan-and-run] ok', {
      goal: result.plan?.goal,
      steps: result.plan?.steps?.length,
      suggest: Boolean(nextActionSuggestion),
      suggestGate: timing.reason,
    });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('/agent/plan-and-run error:', err);
    try {
      const userId = getUserId(req.body?.userId);
      const msg = err instanceof Error ? err.message : String(err);
      appendConversation(userId, {
        role: 'assistant',
        message: `عذرًا، صار خطأ أثناء التخطيط: ${msg}`,
      });
    } catch {
      /* ignore */
    }
    return res.status(500).json({ error: err?.message || 'plan-and-run failed' });
  }
});

app.post('/agent/autonomous', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const userId = getUserId(req.body?.userId);
    const location = parseLocationFromRequest(req.body?.location);
    const conversationHistory = Array.isArray(req.body?.conversationHistory)
      ? req.body.conversationHistory
      : [];
    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }

    markInteractionStart(userId);

    const memoryUpdate = extractMemoryData(message);
    if (Object.keys(memoryUpdate).length > 0) {
      updateUserMemory(userId, memoryUpdate);
    }

    appendConversation(userId, { role: 'user', message });

    const fetchNewsAuto = async () => {
      const base = String(GET_NEWS_AGENT_URL_NODE).replace(/\/$/, '');
      const r = await fetch(`${base}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const raw = await r.text();
      if (!r.ok) {
        throw new Error(parseApiErrorBodyForAgent(raw) || `getNews HTTP ${r.status}`);
      }
      const data = JSON.parse(raw);
      const textOut =
        (typeof data.reply === 'string' && data.reply) ||
        (typeof data.content === 'string' && data.content) ||
        '';
      if (!String(textOut).trim()) {
        throw new Error('getNews: empty response');
      }
      return String(textOut).trim();
    };

    const fetchSleepStoryAuto = async () => {
      const base = String(SLEEP_STORY_AGENT_URL_NODE).replace(/\/$/, '');
      const r = await fetch(`${base}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const raw = await r.text();
      if (!r.ok) {
        throw new Error(parseApiErrorBodyForAgent(raw) || `sleepStory HTTP ${r.status}`);
      }
      const data = JSON.parse(raw);
      const story = typeof data.story === 'string' ? data.story : '';
      if (!String(story).trim()) {
        throw new Error('sleepStory: empty response');
      }
      return String(story).trim();
    };

    const timeoutMsRaw = Number(req.body?.timeoutMs);
    const timeoutMs =
      Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.min(timeoutMsRaw, 90000) : 52000;

    const result = await runAgent({
      openai,
      model: OPENAI_CHAT_MODEL,
      userId,
      message,
      conversationHistory,
      rawLocation: location,
      fetchNews: fetchNewsAuto,
      fetchSleepStory: fetchSleepStoryAuto,
      synthesizeWithElevenLabs,
      runCompanionReplyCore,
      updateUserMemory,
      extractMemoryData,
      getUserMemory,
      buildServerMemorySummary,
      analyzeUserSignals,
      recordCompanionSignals,
      mergeTopicHintsForRecord,
      buildToneDirective,
      timeoutMs,
      maxLoops: 2,
    });

    appendConversation(userId, { role: 'assistant', message: result.reply });

    if (result.profileSignals && userId !== 'local-user') {
      void updateUserProfile({ userId, signals: result.profileSignals }).catch((e) =>
        console.warn('[user_profile]', e?.message || e),
      );
    }

    const payload = {
      reply: result.reply,
      memoryHint: result.memoryHint,
      nearbySuggestions: result.nearbySuggestions,
      nearbySource: result.nearbySource,
      goal: result.goal,
      agentTrace: result.trace,
      agentReflections: result.reflections,
      loopsUsed: result.loopsUsed,
    };
    if (result.audio?.audioBase64) {
      payload.audioBase64 = result.audio.audioBase64;
      payload.mimeType = result.audio.mimeType;
      payload.audioMimeType = result.audio.mimeType;
      payload.voice = result.audio.voice;
    }
    if (result.nextActionSuggestion) {
      payload.nextActionSuggestion = result.nextActionSuggestion;
    }

    console.log('[agent/autonomous] ok', { userId, loops: result.loopsUsed });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('/agent/autonomous error:', err);
    return res.status(500).json({ error: err?.message || 'autonomous failed' });
  }
});

/** Agent core (Expo `runAgent`): short OpenAI replies using client-loaded memory. */
app.post('/agent/core/generate', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const kind = req.body?.kind === 'suggest' ? 'suggest' : 'respond';
    const memory = req.body?.memory;
    const personality = req.body?.personality && typeof req.body.personality === 'object'
      ? req.body.personality
      : {};
    const ctx = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
    const userMessage =
      typeof req.body?.userMessage === 'string' ? req.body.userMessage.trim() : '';

    if (kind === 'respond' && !userMessage) {
      return res.status(400).json({ error: 'Missing userMessage for respond.' });
    }

    const memoryStr = JSON.stringify(memory ?? {}).slice(0, 7000);
    const personalityStr = JSON.stringify(personality).slice(0, 2000);
    const mood = typeof ctx.mood === 'string' ? ctx.mood : 'neutral';
    const timeOfDay = typeof ctx.timeOfDay === 'string' ? ctx.timeOfDay : '';
    const lastTopics = Array.isArray(ctx.lastTopics) ? ctx.lastTopics.map(String).slice(0, 12) : [];

    const companionInstruction =
      'Respond like a human companion, short and natural.';

    const systemPrompt =
      kind === 'respond'
        ? `You are a human companion, not a generic chatbot.

${companionInstruction}

Personality (follow closely, JSON):
${personalityStr}

Current context:
- mood: ${mood}
- time of day: ${timeOfDay || 'unknown'}
- recent topics: ${lastTopics.length ? lastTopics.join(', ') : '(none)'}

Saved memory (use when relevant; never quote labels like "memory" to the user):
${memoryStr}`
        : `You are a caring companion. Tone: natural, short, helpful.
Write ONE brief proactive check-in (at most two short sentences). No interrogation list; warm and human.

Personality (JSON):
${personalityStr}

Context: mood=${mood}, time=${timeOfDay || 'unknown'}, topics=${lastTopics.join(', ') || '(none)'}

Memory (JSON):
${memoryStr}`;

    const userPrompt =
      kind === 'respond'
        ? userMessage.slice(0, 4000)
        : 'Generate one gentle check-in line the user might appreciate right now.';

    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      temperature: kind === 'respond' ? 0.55 : 0.65,
      max_tokens: kind === 'respond' ? 500 : 120,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!reply) {
      return res.status(500).json({ error: 'Empty model reply.' });
    }
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('/agent/core/generate error:', err);
    return res.status(500).json({ error: err?.message || 'agent core generate failed' });
  }
});

/** Weighted decision matrix → JSON + Arabic explanation (see `decisionEnginePrompts.js`). */
app.post('/agent/decision-json', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const user_input =
      typeof req.body?.user_input === 'string'
        ? req.body.user_input
        : typeof req.body?.message === 'string'
          ? req.body.message
          : '';
    const trimmed = String(user_input || '').trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing user_input or message.' });
    }
    const { json } = await runDecisionJson(openai, OPENAI_CHAT_MODEL, trimmed);
    const short =
      typeof json.short_explanation_en === 'string' && json.short_explanation_en.trim()
        ? json.short_explanation_en.trim()
        : typeof json.explanation_ar === 'string'
          ? String(json.explanation_ar).slice(0, 280)
          : '';
    return res.status(200).json({
      ...json,
      short_explanation: short,
    });
  } catch (err) {
    console.error('/agent/decision-json error:', err);
    return res.status(500).json({ error: err?.message || 'decision-json failed' });
  }
});

/** Full startup-advisor markdown report (see `decisionEnginePrompts.js`). */
app.post('/agent/decision-advisor', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const user_input =
      typeof req.body?.user_input === 'string'
        ? req.body.user_input
        : typeof req.body?.message === 'string'
          ? req.body.message
          : '';
    const trimmed = String(user_input || '').trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing user_input or message.' });
    }
    const { markdown } = await runStartupAdvisorMarkdown(openai, OPENAI_CHAT_MODEL, trimmed);
    if (!markdown) {
      return res.status(500).json({ error: 'Empty report.' });
    }
    return res.status(200).json({ markdown });
  } catch (err) {
    console.error('/agent/decision-advisor error:', err);
    return res.status(500).json({ error: err?.message || 'decision-advisor failed' });
  }
});

function parseApiErrorBodyForAgent(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message;
  } catch {
    /* ignore */
  }
  return text && String(text).slice(0, 200);
}

async function generatePersonalityReply(message, personKey, options = {}) {
  const roleKey =
    personKey === 'mother' ? 'mom' : personKey === 'father' ? 'dad' : personKey;
  let system =
    PERSONA_SYSTEM_PROMPTS[roleKey] || PERSONA_SYSTEM_PROMPTS.twin;
  const pref = options.preferredLanguage;
  if (pref === 'en') {
    system += `\nThe user prefers English for this turn: reply in English.`;
  }
  if (!openai) {
    const fallback =
      pref === 'en'
        ? `I heard you — ${normalizeForSpeech(message).slice(0, 200)}`
        : `سمعتك — ${normalizeForSpeech(message).slice(0, 200)}`;
    return fallback;
  }
  const completion = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.62,
    max_tokens: 240,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: normalizeForSpeech(message) },
    ],
  });
  const reply = normalizeForSpeech(completion.choices?.[0]?.message?.content);
  if (!reply) {
    throw new Error('Empty persona reply.');
  }
  return reply;
}

async function handleCompanionChat(req, res) {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const userId = getUserId(req.body?.userId);
    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }

    const personRaw = typeof req.body?.person === 'string' ? req.body.person.trim() : '';
    if (personRaw) {
      const pKey = normalizePersonKey(personRaw);
      const langRaw =
        typeof req.body?.language === 'string' ? req.body.language.trim().toLowerCase() : '';
      const preferredLanguage = langRaw === 'en' ? 'en' : 'ar';
      console.log('[chat] persona branch', {
        person: pKey,
        messageLen: message.length,
        preferredLanguage,
      });
      const reply = await generatePersonalityReply(message, pKey, { preferredLanguage });
      return res.status(200).json({ reply });
    }

    const location = parseLocationFromRequest(req.body?.location);
    const conversationHistory = Array.isArray(req.body?.conversationHistory)
      ? req.body.conversationHistory
      : [];
    console.log('[chat] userId:', userId, 'message:', message, 'location:', location);
    const result = await generateCompanionReply({
      userId,
      text: message,
      location,
      conversationHistory,
    });

    const { profileSignals, interactionGapMs, ...restResult } = result;

    const timeOfDay = resolveTimeOfDayFromRequest(req.body);
    const suggestionSessionId =
      typeof req.body?.suggestionSessionId === 'string' ? req.body.suggestionSessionId.trim().slice(0, 128) : '';
    const mem = getUserMemory(userId);
    const timing = shouldSuggest({
      gapMsSincePreviousUserMessage: interactionGapMs ?? Infinity,
      lastSuggestionAtISO: mem.lastSuggestionAt,
      suggestionSessionId,
      sessionSuggestionCount: getSuggestionSessionCount(userId, suggestionSessionId),
      message,
      mood: profileSignals?.mood || mem.lastMood || 'neutral',
    });

    let nextActionSuggestion = null;
    if (openai && restResult.reply && timing.allow) {
      try {
        nextActionSuggestion = await suggestNextAction(openai, OPENAI_CHAT_MODEL, {
          lastUserMessage: message,
          assistantReply: restResult.reply,
          memorySummary: buildServerMemorySummary(mem),
          timeOfDay,
          timeOfDayHint: buildTimeOfDaySuggestHint(timeOfDay),
          conversationHistory,
        });
        if (nextActionSuggestion) {
          recordSuggestionDelivered(userId, suggestionSessionId);
        }
      } catch (e) {
        console.warn('[suggest] /chat:', e?.message || e);
      }
    } else if (!timing.allow) {
      console.log('[suggest] skipped (timing):', timing.reason);
    }

    return res.status(200).json({
      ...restResult,
      ...(nextActionSuggestion ? { nextActionSuggestion } : {}),
    });
  } catch (error) {
    console.error('/chat error:', error);
    const message = error instanceof Error ? error.message : 'Chat failed.';
    return res.status(500).json({ error: message });
  }
}

app.post('/chat', requireAuth, enforceUserId, handleCompanionChat);
app.post('/', requireAuth, enforceUserId, handleCompanionChat);

app.post('/transcribe', requireAuth, upload.single('file'), enforceUserId, async (req, res) => {
  try {
    console.log('[transcribe] called', {
      hasFile: Boolean(req.file),
      mime: req.file?.mimetype,
      size: req.file?.size,
      name: req.file?.originalname,
    });
    if (!req.file) {
      return res.status(400).json({ error: 'Missing file in field "file".' });
    }
    // Mock path for local voice pipeline (swap for transcribeWithOpenAI when ready).
    return res.status(200).json({ text: 'Hello, I heard you' });
  } catch (error) {
    console.error('[transcribe] error:', error);
    const message = error instanceof Error ? error.message : 'Transcription failed.';
    return res.status(500).json({ error: message });
  }
});

// Public local TTS endpoint: no Firebase auth token/middleware required.
app.post('/tts', requireAuth, enforceUserId, async (req, res) => {
  try {
    const rawText =
      typeof req.body?.text === 'string'
        ? req.body.text
        : typeof req.body?.message === 'string'
          ? req.body.message
          : '';
    const text = String(rawText || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Missing text (or legacy message).' });
    }
    const personRaw = typeof req.body?.person === 'string' ? req.body.person.trim() : 'twin';
    const personKey = normalizePersonKey(personRaw);
    console.log('[tts] request', { textLen: text.length, person: personKey });
    const tts = await synthesizeWithElevenLabs(text, personKey);
    return res.status(200).json({
      audioBase64: tts.audioBase64,
      mimeType: tts.mimeType,
      audioMimeType: tts.mimeType,
      voice: tts.voice,
    });
  } catch (error) {
    console.error('[tts] error:', error);
    const message = error instanceof Error ? error.message : 'TTS failed.';
    return res.status(500).json({ error: message });
  }
});

app.post('/proactive', requireAuth, enforceUserId, async (req, res) => {
  try {
    const result = await handleProactiveRequest(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    console.error('/proactive error:', error);
    const message = error instanceof Error ? error.message : 'proactive failed.';
    return res.status(500).json({ error: message });
  }
});

async function persistCompanionSuggestionShown(userId, line) {
  const db = getAdminFirestore();
  if (!db || !userId || userId === 'local-user') return;
  const text = String(line || '').trim().slice(0, 400);
  if (!text) return;
  try {
    await db
      .collection('user_profile')
      .doc(userId)
      .set(
        {
          userId,
          lastSuggestionShown: FieldValue.serverTimestamp(),
          lastSuggestionText: text,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (e) {
    console.warn('[companion-retention] persist suggestion meta:', e?.message || e);
  }
}

async function generateSmartCompanionLine(openai, model, opts) {
  const {
    topics = [],
    timeOfDay = 'day',
    mood = 'neutral',
    avoidRepeat = '',
    lastMessageSlice = '',
    userProfileBlock = '',
  } = opts;
  const topicStr = topics.length ? topics.map(String).join(', ') : '(none)';
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.48,
    max_tokens: 72,
    messages: [
      {
        role: 'system',
        content: `You write ONE short proactive companion line (max 18 words). Warm, not pushy, not robotic, no guilt.
If avoid_repeat is similar to your line, choose a clearly different angle.
Examples of tone (do not copy verbatim): "You were looking into sleep yesterday… want to continue?" / "You usually check updates around now… want news?"`,
      },
      {
        role: 'user',
        content: `time_of_day: ${timeOfDay}
mood: ${mood}
topics: ${topicStr}
avoid_repeat: ${String(avoidRepeat).slice(0, 280)}
last_user_message: ${String(lastMessageSlice).slice(0, 500)}
profile:
${String(userProfileBlock).slice(0, 1200)}
Reply with the line only — no quotes.`,
      },
    ],
  });
  let line = String(completion.choices?.[0]?.message?.content || '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const av = String(avoidRepeat).toLowerCase().trim();
  const low = line.toLowerCase();
  if (av && low && (low === av || (av.length > 24 && low.includes(av.slice(0, 24))))) {
    line = '';
  }
  if (!line || line.length > 220) return null;
  return line;
}

app.post('/agent/extract-topics', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }
    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.12,
      max_tokens: 120,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Extract 0 to 6 short topic keywords from the user message. JSON only: {"topics":["..."]}. Each keyword 1-4 words, Arabic or English.',
        },
        { role: 'user', content: message.slice(0, 3500) },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
    let topics = [];
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p.topics)) topics = p.topics;
    } catch {
      topics = [];
    }
    topics = topics.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8);
    return res.status(200).json({ topics });
  } catch (err) {
    console.error('/agent/extract-topics error:', err);
    return res.status(500).json({ error: err?.message || 'extract-topics failed' });
  }
});

app.post('/companion/smart-suggest', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'OpenAI not configured.' });
    }
    const userId = getUserId(req.body?.userId);
    const topics = Array.isArray(req.body?.topics) ? req.body.topics : [];
    const timeOfDay = typeof req.body?.timeOfDay === 'string' ? req.body.timeOfDay.trim() : 'day';
    const mood = typeof req.body?.mood === 'string' ? req.body.mood.trim().slice(0, 48) : 'neutral';
    let avoid = '';
    const db = getAdminFirestore();
    if (db && userId && userId !== 'local-user') {
      try {
        const s = await db.collection('user_profile').doc(userId).get();
        if (s.exists) avoid = String(s.data()?.lastSuggestionText || '').slice(0, 400);
      } catch {
        /* ignore */
      }
    }
    const mem = getUserMemory(userId);
    const interactions = mem.pastInteractions || [];
    const lastUserMsg = [...interactions].reverse().find((m) => m.role === 'user');
    const lastMessageSlice = lastUserMsg?.message || '';
    const userProf = await fetchUserProfileDoc(userId);
    const userProfileBlock = summarizeProfileForPrompt(userProf, buildServerMemorySummary(mem));

    const line = await generateSmartCompanionLine(openai, OPENAI_CHAT_MODEL, {
      topics: topics.map(String),
      timeOfDay,
      mood,
      avoidRepeat: avoid,
      lastMessageSlice,
      userProfileBlock,
    });
    if (!line) {
      return res.status(500).json({ error: 'empty_line' });
    }
    return res.status(200).json({ line });
  } catch (err) {
    console.error('/companion/smart-suggest error:', err);
    return res.status(500).json({ error: err?.message || 'smart-suggest failed' });
  }
});

app.post('/companion/initiative', requireAuth, enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(200).json({ shouldInitiate: false, reason: 'no_openai' });
    }
    const userId = getUserId(req.body?.userId);
    const timeOfDay = resolveTimeOfDayFromRequest(req.body);
    const proactiveSessionId =
      typeof req.body?.proactiveSessionId === 'string' ? req.body.proactiveSessionId.trim().slice(0, 128) : '';

    const sessionCount = getInitiativeSessionCount(userId, proactiveSessionId);
    if (proactiveSessionId && sessionCount >= 1) {
      return res.status(200).json({
        shouldInitiate: false,
        reason: 'session_cap',
      });
    }

    const fp = await fetchUserProfileDoc(userId);
    const gate = shouldInitiate(fp, Date.now());
    if (!gate.ok) {
      console.log('[initiative]', userId, gate.reason);
      return res.status(200).json({
        shouldInitiate: false,
        reason: gate.reason,
      });
    }

    if (Math.random() < 0.1) {
      return res.status(200).json({ shouldInitiate: false, reason: 'occasional_skip' });
    }

    const mem = getUserMemory(userId);
    const recentMood = mem.lastMood || 'neutral';
    const clientMood =
      typeof req.body?.clientMood === 'string' ? req.body.clientMood.trim().slice(0, 32) : '';
    const moodForLine = clientMood || recentMood;

    const interactions = mem.pastInteractions || [];
    const lastUserMsg = [...interactions].reverse().find((m) => m.role === 'user');
    const lastMessage =
      lastUserMsg?.message ||
      (typeof req.body?.lastMessageHint === 'string' ? req.body.lastMessageHint.trim() : '') ||
      '(no prior user line)';

    const userProfileBlock = summarizeProfileForPrompt(fp, buildServerMemorySummary(mem));
    const lastTopicsFromProfile = Array.isArray(fp?.topics)
      ? fp.topics.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8)
      : [];
    const lastTopicsFromBody = Array.isArray(req.body?.lastTopics)
      ? req.body.lastTopics.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8)
      : [];
    const topicList = lastTopicsFromProfile.length ? lastTopicsFromProfile : lastTopicsFromBody;

    const avoid = String(fp?.lastSuggestionText || '').slice(0, 400);
    const line = await generateSmartCompanionLine(openai, OPENAI_CHAT_MODEL, {
      topics: topicList,
      timeOfDay,
      mood: moodForLine,
      avoidRepeat: avoid,
      lastMessageSlice: String(lastMessage).slice(0, 500),
      userProfileBlock,
    });

    if (!line) {
      return res.status(200).json({ shouldInitiate: false, reason: 'generation_empty' });
    }

    await persistCompanionSuggestionShown(userId, line);
    recordInitiativeDelivered(userId, proactiveSessionId);
    const delayMs = randomInitiativeDelayMs();

    console.log('[companion-retention] suggestion_shown', userId, { delayMs });
    return res.status(200).json({
      shouldInitiate: true,
      reason: 'due',
      message: line,
      delayMs,
    });
  } catch (error) {
    console.error('/companion/initiative error:', error);
    const message = error instanceof Error ? error.message : 'initiative failed.';
    return res.status(500).json({ error: message });
  }
});

app.post('/chat-audio', requireAuth, upload.single('file'), enforceUserId, async (req, res) => {
  try {
    const userId = getUserId(req.body?.userId);
    if (!req.file) {
      return res.status(400).json({ error: 'Missing audio file in field "file".' });
    }

    const personRaw = typeof req.body?.person === 'string' ? req.body.person.trim() : '';
    const personKey = personRaw ? normalizePersonKey(personRaw) : 'twin';

    console.log(
      '[chat-audio] upload:',
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      'person:',
      personKey,
    );
    const transcript = await transcribeWithOpenAI(req.file);
    console.log('[chat-audio] transcript:', transcript);

    const location = parseLocationFromRequest(req.body?.location);
    const result = await generateCompanionReply({
      userId,
      text: transcript,
      location,
    });
    const tts = await synthesizeWithElevenLabs(result.reply, personKey);

    return res.status(200).json({
      transcript,
      reply: result.reply,
      memoryHint: result.memoryHint,
      nearbySuggestions: result.nearbySuggestions,
      nearbySource: result.nearbySource,
      audioBase64: tts.audioBase64,
      mimeType: tts.mimeType,
      voice: tts.voice,
    });
  } catch (error) {
    console.error('/chat-audio error:', error);
    const message = error instanceof Error ? error.message : 'chat-audio failed.';
    return res.status(500).json({ error: message });
  }
});

/**
 * GPT-4o vision (multipart: image + question + userId).
 * Registered here so this file works when run directly (`node twin-ai-app/server/index.js`);
 * root `server.js` uses the same `app` instance and does not register this again.
 */
app.post('/ask-vision', requireAuth, upload.single('image'), enforceUserId, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY.' });
    }

    const userId = getUserId(req.body?.userId);
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId.' });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Missing image file (field: image).' });
    }

    const questionRaw = String(req.body?.question ?? '').trim();
    const question = questionRaw || 'What do you see in this image?';

    const mimeRaw = String(req.file.mimetype || 'image/jpeg').split(';')[0];
    const mime = mimeRaw.startsWith('image/') ? mimeRaw : 'image/jpeg';
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: AI_TWIN_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
            { type: 'text', text: question },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.75,
    });

    const rawContent = completion.choices[0]?.message?.content;
    const answer = Array.isArray(rawContent)
      ? rawContent
          .map((p) => (typeof p === 'string' ? p : p?.text || ''))
          .join('')
      : String(rawContent ?? '').trim();

    if (!answer) {
      return res.status(500).json({ error: 'Empty model response.' });
    }

    console.log(`[ask-vision] ok userId=${userId} bytes=${req.file.size}`);
    return res.status(200).json({ answer });
  } catch (error) {
    console.error('[ask-vision] error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Vision ask failed.',
    });
  }
});

module.exports = app;

// When started via root `server.js`, that file adds RAG routes (/upload, /ask, …) and calls listen().
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
    console.log('Routes include POST /ask-vision, /transcribe, /chat, …');
  });
}
