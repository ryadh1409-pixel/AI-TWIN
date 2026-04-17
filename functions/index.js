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
const Busboy = require("busboy");
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        if (!chunks.length) {
          resolve({});
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** Busboy parses multipart in a way that works with React Native FormData. */
function parseMultipartAudio(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: 25 * 1024 * 1024 },
    });
    let fileBuffer = null;
    let detectedMime = "audio/m4a";

    bb.on("file", (name, file, info) => {
      if (name !== "file" && name !== "audio") {
        file.resume();
        return;
      }
      detectedMime = info.mimeType || "audio/m4a";
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("limit", () =>
        reject(new Error("Audio file exceeds size limit")),
      );
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => {
      resolve({ buffer: fileBuffer, mimeType: detectedMime });
    });
    req.pipe(bb);
  });
}

async function transcribeHttp(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = openaiApiKey.value();
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OpenAI configuration." });
  }

  const contentType = req.headers["content-type"] || "";

  try {
    let audioBuffer;
    let mimeType = "audio/m4a";

    if (contentType.includes("application/json")) {
      const body = await readJsonBody(req);
      const { audioBase64, mimeType: mt } = body || {};
      if (!audioBase64 || typeof audioBase64 !== "string") {
        return res.status(400).json({ error: "Missing audioBase64" });
      }
      audioBuffer = Buffer.from(audioBase64, "base64");
      if (!audioBuffer.length) {
        return res.status(400).json({ error: "Decoded audio is empty." });
      }
      if (typeof mt === "string" && mt) {
        mimeType = mt;
      }
    } else if (contentType.includes("multipart/form-data")) {
      const { buffer, mimeType: m } = await parseMultipartAudio(req);
      audioBuffer = buffer;
      if (m) {
        mimeType = m;
      }
    } else {
      return res.status(415).json({
        error: "Expected application/json or multipart/form-data",
      });
    }

    if (!audioBuffer?.length) {
      return res.status(400).json({ error: "No audio data" });
    }

    const openai = new OpenAI({ apiKey });
    const file = await toFile(audioBuffer, "audio.m4a", { type: mimeType });
    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });

    return res.status(200).json({ text: String(result.text ?? "").trim() });
  } catch (err) {
    console.error("transcribe error:", err);
    const message = err?.message || "Transcription failed";
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    return res.status(500).json({ error: message });
  }
}

/** HTTPS (Gen 2): JSON `{ audioBase64 }` or Busboy multipart `file`/`audio` → Whisper */
exports.transcribe = onRequest(
  {
    secrets: [openaiApiKey],
    cors: true,
    timeoutSeconds: 120,
    memory: "1GiB",
    maxInstances: 20,
    invoker: "public",
  },
  transcribeHttp,
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
