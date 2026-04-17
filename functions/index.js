const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { summarizeSaudiNewsArabic, generateAbbasidSleepStory } = require("./services/openaiService");
const { fetchSaudiGoogleNewsText } = require("./services/newsService");
const { notifyDailyReportPlaceholder } = require("./services/pushService");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { default: OpenAI, toFile } = require("openai");
const { createChatHandler } = require("./chatHandlers");

if (!admin.apps.length) {
  admin.initializeApp();
}

const openaiApiKey = defineSecret("OPENAI_API_KEY");

async function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing Authorization header (Bearer Firebase ID token).",
    });
  }
  try {
    const token = h.slice(7);
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.warn("verifyIdToken:", err?.message || err);
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

const ALLOWED_EXT = new Set([
  ".m4a",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".wav",
  ".webm",
  ".caf",
  ".aac",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || "audio.m4a").toLowerCase();
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (!ext || ALLOWED_EXT.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported audio type (${ext || "unknown"}).`));
  },
});

const transcribeHandler = async (req, res) => {
  try {
    const f = req.file;
    if (!f || !f.buffer) {
      return res.status(400).json({
        error: "Missing audio file. Send multipart/form-data with field name `audio`.",
      });
    }

    const apiKey = openaiApiKey.value();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI configuration." });
    }

    const model =
      process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
    const openai = new OpenAI({ apiKey });
    const uploadable = await toFile(
      f.buffer,
      f.originalname || "audio.m4a",
    );

    let transcription;
    try {
      transcription = await openai.audio.transcriptions.create({
        file: uploadable,
        model,
      });
    } catch (primaryErr) {
      if (model !== "whisper-1") {
        console.warn(
          "Transcribe model fallback:",
          primaryErr?.message || primaryErr,
        );
        transcription = await openai.audio.transcriptions.create({
          file: await toFile(f.buffer, f.originalname || "audio.m4a"),
          model: "whisper-1",
        });
      } else {
        throw primaryErr;
      }
    }

    const text = (transcription.text || "").trim();
    return res.status(200).json({ text });
  } catch (err) {
    console.error("transcribe error:", err);
    const message = err?.message || "Transcription failed";
    return res.status(500).json({ error: message });
  }
};

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true }));
app.options("*", cors({ origin: true }));

const audioUpload = upload.single("audio");

app.post("/", (req, res, next) => {
  audioUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    next();
  });
}, transcribeHandler);

app.post("/transcribe", (req, res, next) => {
  audioUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    next();
  });
}, transcribeHandler);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

exports.transcribe = onRequest(
  {
    secrets: [openaiApiKey],
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 20,
    invoker: "public",
  },
  app,
);

const chatApp = express();
chatApp.disable("x-powered-by");
chatApp.use(cors({ origin: true }));
chatApp.options("*", cors({ origin: true }));
chatApp.use(express.json({ limit: "1mb" }));
chatApp.post("/", requireAuth, createChatHandler(OpenAI, openaiApiKey));
chatApp.post("/chat", requireAuth, createChatHandler(OpenAI, openaiApiKey));
chatApp.post("/family-chat", requireAuth, (req, _res, next) => {
  req.body = {
    ...(req.body || {}),
    character: "family",
  };
  next();
}, createChatHandler(OpenAI, openaiApiKey));
chatApp.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

exports.chat = onRequest(
  {
    secrets: [openaiApiKey],
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 20,
    invoker: "public",
  },
  chatApp,
);

const VOICE_BY_CHARACTER = {
  mom: "shimmer",
  dad: "onyx",
  maher: "echo",
  mjeed: "nova",
};

function normalizeForSpeech(text) {
  return String(text || "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 4000);
}

const ttsApp = express();
ttsApp.disable("x-powered-by");
ttsApp.use(cors({ origin: true }));
ttsApp.options("*", cors({ origin: true }));
ttsApp.use(express.json({ limit: "1mb" }));

ttsApp.post("/", requireAuth, async (req, res) => {
  try {
    const text =
      typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const character = req.body?.character;
    if (!text) {
      return res.status(400).json({ error: "Missing text." });
    }
    if (!VOICE_BY_CHARACTER[character]) {
      return res.status(400).json({
        error: "Invalid character. Use mom, dad, maher, or mjeed.",
      });
    }
    const apiKey = openaiApiKey.value();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI configuration." });
    }
    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    const speechText = normalizeForSpeech(text);
    const speech = await openai.audio.speech.create({
      model,
      voice: VOICE_BY_CHARACTER[character],
      input: speechText,
      format: "mp3",
    });
    const buffer = Buffer.from(await speech.arrayBuffer());
    const path = `users/${req.uid}/tts/${character}-${Date.now()}.mp3`;
    let signedUrl = null;
    try {
      const file = admin.storage().bucket().file(path);
      await file.save(buffer, {
        metadata: { contentType: "audio/mpeg" },
      });
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      signedUrl = url;
    } catch (storageErr) {
      console.warn("tts storage skipped:", storageErr?.message || storageErr);
    }
    return res.json({
      audioBase64: buffer.toString("base64"),
      audioMimeType: "audio/mpeg",
      voice: VOICE_BY_CHARACTER[character],
      storagePath: path,
      storageUrl: signedUrl,
    });
  } catch (err) {
    console.error("tts error:", err);
    return res.status(500).json({ error: err?.message || "TTS failed." });
  }
});

ttsApp.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

exports.tts = onRequest(
  {
    secrets: [openaiApiKey],
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 20,
    invoker: "public",
  },
  ttsApp,
);

/** X7 AI Twin — daily Saudi news digest → Firestore `daily_reports` (21:00 America/Toronto) */
exports.dailyNewsDigest = onSchedule(
  {
    schedule: "0 21 * * *",
    timeZone: "America/Toronto",
    secrets: [openaiApiKey],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const apiKey = openaiApiKey.value();
    if (!apiKey) {
      console.error("[dailyNewsDigest] OPENAI_API_KEY missing");
      return;
    }
    try {
      const raw = await fetchSaudiGoogleNewsText();
      const content = await summarizeSaudiNewsArabic(apiKey, raw);
      const ref = await admin.firestore().collection("daily_reports").add({
        type: "news",
        content,
        createdAt: FieldValue.serverTimestamp(),
      });
      await notifyDailyReportPlaceholder({ reportId: ref.id, type: "news" });
      console.log("[dailyNewsDigest] saved", ref.id);
    } catch (err) {
      console.error("[dailyNewsDigest]", err?.message || err);
      throw err;
    }
  },
);

const sleepStoryApp = express();
sleepStoryApp.disable("x-powered-by");
sleepStoryApp.use(cors({ origin: true }));
sleepStoryApp.options("*", cors({ origin: true }));
sleepStoryApp.use(express.json({ limit: "256kb" }));

async function sleepStoryHandler(req, res) {
  try {
    const apiKey = openaiApiKey.value();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI configuration." });
    }
    const story = await generateAbbasidSleepStory(apiKey);
    return res.status(200).json({
      story,
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    });
  } catch (err) {
    console.error("sleep-story:", err);
    return res.status(500).json({ error: err?.message || "sleep-story failed" });
  }
}

sleepStoryApp.post("/sleep-story", sleepStoryHandler);
sleepStoryApp.post("/", sleepStoryHandler);
sleepStoryApp.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

/** POST /sleep-story — Abbasid-era bedtime story in Arabic (X7 tone) */
exports.sleepStory = onRequest(
  {
    secrets: [openaiApiKey],
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 15,
    invoker: "public",
  },
  sleepStoryApp,
);
