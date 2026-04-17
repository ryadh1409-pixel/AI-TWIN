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
} = require('./memory');
const { fetchNearbyPlaces, formatDistance } = require('./places');

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
const PERSONA_PROMPT =
  'You are X, a friendly AI companion. You speak Arabic naturally like a close friend. You are slightly funny, casual, and proactive. You remember the user and help them in daily life.';
const X_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

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

function buildMemoryContext(memory, recentConversations) {
  const summary = [
    `name: ${memory.name || 'unknown'}`,
    `city: ${memory.city || 'unknown'}`,
    `preferences: ${
      memory.preferences && memory.preferences.length > 0
        ? memory.preferences.join(', ')
        : 'none'
    }`,
  ].join('\n');

  const recent = recentConversations.length
    ? recentConversations
        .map((entry) => `${entry.role}: ${entry.message}`)
        .join('\n')
    : 'none';

  return `User info:\n${summary}\n\nRecent conversation:\n${recent}`;
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
    return `أنت قلت قبل إنك تحب ${memory.preferences[0]}`;
  }
  if (memory.city) {
    return `أتذكر إنك في ${memory.city}`;
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

function buildServerMemorySummary(memory) {
  const parts = [];
  if (memory.name) parts.push(`الاسم: ${memory.name}`);
  if (memory.city) parts.push(`المدينة: ${memory.city}`);
  if (memory.preferences?.length) {
    parts.push(`يحب: ${memory.preferences.slice(0, 3).join('، ')}`);
  }
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
        content: `${PERSONA_PROMPT} This is a proactive ping (user did not send a message). Reply with exactly one short line in Arabic (max 14 words). Friendly, casual, no emoji spam. No greeting wall — get to the point.`,
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

async function replyWithOpenAI(
  text,
  memory,
  recentConversations,
  locationMeta,
  nearbyPromptBlock,
) {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is missing in .env');
  }

  const messages = [
    { role: 'system', content: PERSONA_PROMPT },
    { role: 'system', content: buildMemoryContext(memory, recentConversations) },
  ];

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

  messages.push({ role: 'user', content: normalizeForSpeech(text) });

  const completion = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature: 0.8,
    messages,
  });

  const reply = normalizeForSpeech(completion.choices?.[0]?.message?.content);
  if (!reply) {
    throw new Error('OpenAI chat returned empty reply.');
  }
  return reply;
}

async function synthesizeWithElevenLabs(text) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('Missing ELEVENLABS_API_KEY in .env');
  }

  const voiceId = X_VOICE_ID;
  if (!voiceId) {
    throw new Error('Missing ElevenLabs voice for X');
  }
  console.log('Using voice:', voiceId);

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

async function generateCompanionReply({ userId, text, location: rawLocation }) {
  const memoryUpdate = extractMemoryData(text);
  if (Object.keys(memoryUpdate).length > 0) {
    updateUserMemory(userId, memoryUpdate);
  }

  appendConversation(userId, {
    role: 'user',
    message: text,
  });

  const memory = getUserMemory(userId);
  const recentConversations = getRecentConversations(userId, 3);

  const parsed = parseLocationFromRequest(rawLocation);
  const locationMeta = parsed
    ? { ...parsed, inToronto: isInTorontoArea(parsed.lat, parsed.lng) }
    : null;

  let nearbyBundle = { places: [], promptBlock: null, source: 'none' };
  if (locationMeta) {
    // Google Places: getNearbyPlaces() in places.js shares the same fetch path as this bundle.
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
      );

  appendConversation(userId, {
    role: 'assistant',
    message: reply,
  });

  return {
    reply,
    memoryHint: buildMemoryHint(getUserMemory(userId)),
    nearbySuggestions: nearbyBundle.places || [],
    nearbySource: nearbyBundle.source || 'none',
  };
}

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/', (_req, res) => {
  res.status(200).send('Server is running');
});

app.post('/chat', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const userId = getUserId(req.body?.userId);
    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }

    const location = parseLocationFromRequest(req.body?.location);
    console.log('[chat] userId:', userId, 'message:', message, 'location:', location);
    const result = await generateCompanionReply({ userId, text: message, location });
    return res.status(200).json(result);
  } catch (error) {
    console.error('/chat error:', error);
    const message = error instanceof Error ? error.message : 'Chat failed.';
    return res.status(500).json({ error: message });
  }
});

app.post('/transcribe', upload.single('file'), async (req, res) => {
  try {
    console.log('[transcribe] called');
    if (!req.file) {
      return res.status(400).json({ error: 'Missing file in field "file".' });
    }
    const text = await transcribeWithOpenAI(req.file);
    return res.status(200).json({ text });
  } catch (error) {
    console.error('/transcribe error:', error);
    const message = error instanceof Error ? error.message : 'Transcription failed.';
    return res.status(500).json({ error: message });
  }
});

app.post('/tts', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'Missing text.' });
    }
    const tts = await synthesizeWithElevenLabs(text);
    return res.status(200).json({
      audioBase64: tts.audioBase64,
      mimeType: tts.mimeType,
      audioMimeType: tts.mimeType,
      voice: tts.voice,
    });
  } catch (error) {
    console.error('/tts error:', error);
    const message = error instanceof Error ? error.message : 'TTS failed.';
    return res.status(500).json({ error: message });
  }
});

app.post('/proactive', async (req, res) => {
  try {
    const result = await handleProactiveRequest(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    console.error('/proactive error:', error);
    const message = error instanceof Error ? error.message : 'proactive failed.';
    return res.status(500).json({ error: message });
  }
});

app.post('/chat-audio', upload.single('file'), async (req, res) => {
  try {
    const userId = getUserId(req.body?.userId);
    if (!req.file) {
      return res.status(400).json({ error: 'Missing audio file in field "file".' });
    }

    console.log(
      '[chat-audio] upload:',
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
    );
    const transcript = await transcribeWithOpenAI(req.file);
    console.log('[chat-audio] transcript:', transcript);

    const location = parseLocationFromRequest(req.body?.location);
    const result = await generateCompanionReply({
      userId,
      text: transcript,
      location,
    });
    const tts = await synthesizeWithElevenLabs(result.reply);

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
app.post('/ask-vision', upload.single('image'), async (req, res) => {
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
