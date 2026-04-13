require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai").default;
const multer = require("multer");
const { createReadStream } = require("fs");
const { mkdir, unlink, writeFile } = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const { promisify } = require("util");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_MEMORY_MESSAGES = 10;
const memoryStore = {};
const UPLOADS_DIR = path.join(__dirname, "uploads");
const OUTPUT_AUDIO_PATH = path.join(__dirname, "output.mp3");
const ALLOWED_AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".caf", ".aac"]);
const execAsync = promisify(exec);

const generateUniqueFilename = (originalName) => {
  const ext = path.extname(originalName || "").toLowerCase();
  const safeExtension = ALLOWED_AUDIO_EXTENSIONS.has(ext) ? ext : ".bin";
  return `${Date.now()}-${crypto.randomUUID()}${safeExtension}`;
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, generateUniqueFilename(file.originalname)),
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
      cb(null, true);
      return;
    }
    cb(
      new Error(
        "Invalid audio format. Allowed: .wav, .mp3, .m4a, .caf, .aac.",
      ),
    );
  },
});

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const hasApiKey = () => Boolean(process.env.OPENAI_API_KEY);

const saveAndPlayAudio = async (audioBuffer) => {
  await writeFile(OUTPUT_AUDIO_PATH, audioBuffer);
  console.log("Playing AI response...");

  try {
    await execAsync("afplay output.mp3", { cwd: __dirname });
  } catch (error) {
    // Keep API stable even if local playback fails.
    console.error("Audio playback error:", error?.message || error);
  }
};

const createDigitalTwinResponse = async ({ message, userProfile, userId }) => {
  const memoryKey =
    typeof userId === "string" && userId.trim() ? userId.trim() : "default-user";
  const memory = memoryStore[memoryKey] || [];
  const profileText =
    typeof userProfile === "string" && userProfile.trim()
      ? `\nExtra context about me: ${userProfile.trim()}`
      : "";
  const personalityPrompt =
    "You are my digital twin. Always talk like my personality: confident, ambitious, and slightly sarcastic young entrepreneur. " +
    "Use a casual Arabic + English mix (Arabizi/English is fine). Keep replies short, smart, and slightly funny. " +
    "Sound natural, bold, and focused on growth. Never break character." +
    profileText;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: personalityPrompt },
      ...memory,
      { role: "user", content: message },
    ],
  });
  const reply =
    completion.choices?.[0]?.message?.content?.trim() ||
    "I do not have a reply yet.";

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: reply,
  });
  const audioBuffer = Buffer.from(await speech.arrayBuffer());
  await saveAndPlayAudio(audioBuffer);

  memoryStore[memoryKey] = [
    ...memory,
    { role: "user", content: message },
    { role: "assistant", content: reply },
  ].slice(-MAX_MEMORY_MESSAGES);

  return { reply, audioBuffer };
};

app.post("/chat", async (req, res) => {
  try {
    const { message, userProfile, userId } = req.body || {};
    console.log("POST /chat request received");

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please provide a valid 'message' string in the request body.",
      });
    }
    if (!hasApiKey()) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY in .env file.",
      });
    }

    const { reply, audioBuffer } = await createDigitalTwinResponse({
      message,
      userProfile,
      userId,
    });
    console.log("POST /chat success");
    return res.json({ reply, audio: audioBuffer.toString("base64") });
  } catch (error) {
    console.error("POST /chat error:", error);
    return res.status(500).json({
      error: "Failed to generate AI response.",
    });
  }
});

const handleVoiceFile = async (uploadedPath, req, res, { binaryResponse }) => {
  const { userProfile, userId } = req.body || {};

  if (!uploadedPath) {
    return res.status(400).json({
      error: "No audio file received.",
    });
  }
  if (!hasApiKey()) {
    return res.status(500).json({
      error: "Missing OPENAI_API_KEY in .env file.",
    });
  }

  console.log("Transcribing uploaded audio");
  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: createReadStream(uploadedPath),
  });
  const message = transcription.text?.trim();
  if (!message) {
    return res.status(400).json({
      error: "Could not transcribe the uploaded audio.",
    });
  }

  const { reply, audioBuffer } = await createDigitalTwinResponse({
    message,
    userProfile,
    userId,
  });

  if (binaryResponse) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audioBuffer.length));
    console.log("POST /upload success (binary audio)");
    return res.send(audioBuffer);
  }

  console.log("POST /voice success");
  return res.json({ reply, audio: audioBuffer.toString("base64") });
};

app.post("/voice", upload.single("audio"), async (req, res) => {
  const uploadedPath = req.file?.path;

  try {
    console.log("POST /voice request received");
    return await handleVoiceFile(uploadedPath, req, res, { binaryResponse: false });
  } catch (error) {
    console.error("POST /voice error:", error);
    if (error?.message?.includes("Invalid audio format")) {
      return res.status(400).json({
        error: error.message,
      });
    }
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "File too large. Max allowed size is 10MB.",
      });
    }
    return res.status(500).json({
      error: "Failed to process voice request.",
    });
  } finally {
    if (uploadedPath) {
      await unlink(uploadedPath).catch(() => {});
    }
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;

  try {
    console.log("POST /upload request received");
    return await handleVoiceFile(uploadedPath, req, res, { binaryResponse: true });
  } catch (error) {
    console.error("POST /upload error:", error);
    if (error?.message?.includes("Invalid audio format")) {
      return res.status(400).json({
        error: error.message,
      });
    }
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "File too large. Max allowed size is 10MB.",
      });
    }
    return res.status(500).json({
      error: "Failed to process upload.",
    });
  } finally {
    if (uploadedPath) {
      await unlink(uploadedPath).catch(() => {});
    }
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled request error:", err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "File too large. Max allowed size is 10MB.",
      });
    }
    return res.status(400).json({
      error: `Upload error: ${err.message}`,
    });
  }

  if (err?.message?.includes("Invalid audio format")) {
    return res.status(400).json({
      error: err.message,
    });
  }

  return res.status(500).json({
    error: "Internal server error.",
  });
});

const startServer = async () => {
  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Digital Twin AI backend listening on http://0.0.0.0:${PORT} (LAN: use this machine's IP)`,
      );
    });
  } catch (error) {
    console.error("Server startup error:", error);
    process.exit(1);
  }
};

startServer();
