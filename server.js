/**
 * Root entry: loads the Twin AI Express app from twin-ai-app/server/index.js,
 * registers RAG routes on the SAME app instance, then starts listening.
 * Run: node server.js   (from repo root)
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { FaissStore } = require("@langchain/community/vectorstores/faiss");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EMBEDDING_MODEL = "text-embedding-3-small";
const FAISS_ROOT = path.resolve(__dirname, "faiss_index");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const embeddings = new OpenAIEmbeddings({
  apiKey: OPENAI_API_KEY,
  model: EMBEDDING_MODEL,
});

const upload = multer();
const uploadPdfMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
/** Same Express app as twin-ai-app/server/index.js (required below).
 *  POST /ask-vision is registered on that app (see twin-ai-app/server/index.js).
 *  POST /tts is also registered there and intentionally does not require auth middleware.
 */
const app = require("./twin-ai-app/server/index.js");

function normalizeUserId(raw) {
  const value = String(raw || "").trim();
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe || "local-user";
}

function userIndexDir(userId) {
  return path.join(FAISS_ROOT, normalizeUserId(userId));
}

function hasUserIndex(indexDir) {
  return (
    fs.existsSync(path.join(indexDir, "docstore.json")) &&
    fs.existsSync(path.join(indexDir, "faiss.index"))
  );
}

async function loadOrCreateUserVectorStore(indexDir, docs) {
  if (hasUserIndex(indexDir)) {
    const existing = await FaissStore.load(indexDir, embeddings);
    await existing.addDocuments(docs);
    return existing;
  }
  return FaissStore.fromDocuments(docs, embeddings);
}

async function getChunksFromFaiss(indexDir, question, k = 5) {
  const vectorStore = await FaissStore.load(indexDir, embeddings);
  return vectorStore.similaritySearch(question, k);
}

/**
 * Chunk plain text, embed, merge into per-user FAISS index (same pipeline as POST /upload).
 * @param {Record<string, unknown>} [meta] Extra metadata stored on chunk docs (e.g. source: "pdf").
 */
async function ingestTextForUser(userId, text, meta = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    const err = new Error("Missing text.");
    err.httpStatus = 400;
    throw err;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const docs = await splitter.createDocuments([trimmed], [
    {
      userId,
      createdAt: new Date().toISOString(),
      ...meta,
    },
  ]);

  if (!docs.length) {
    const err = new Error("No chunks generated from text.");
    err.httpStatus = 400;
    throw err;
  }

  const indexDir = userIndexDir(userId);
  fs.mkdirSync(indexDir, { recursive: true });
  const vectorStore = await loadOrCreateUserVectorStore(indexDir, docs);
  await vectorStore.save(indexDir);

  return { userId, chunks: docs.length, indexDir };
}

// --- RAG routes (registered on the same `app` as /chat, etc.) ---
app.post("/upload", upload.none(), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    }

    const text = String(req.body?.text || "").trim();
    const userId = normalizeUserId(req.body?.userId);

    if (!userId) {
      return res.status(400).json({ error: "Missing userId." });
    }

    const { chunks, indexDir } = await ingestTextForUser(userId, text, {});

    console.log(
      `[rag] POST /upload ok userId=${userId} chunks=${chunks} dir=${indexDir}`,
    );
    return res.status(200).json({
      ok: true,
      userId,
      chunks,
      indexPath: indexDir,
    });
  } catch (error) {
    const status =
      error && typeof error.httpStatus === "number"
        ? error.httpStatus
        : 500;
    console.error("[rag] /upload error:", error);
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Upload failed.",
    });
  }
});

app.post("/upload-pdf", uploadPdfMemory.single("file"), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    }

    const userId = normalizeUserId(req.body?.userId);
    if (!userId) {
      return res.status(400).json({ error: "Missing userId." });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Missing PDF file (field: file)." });
    }

    const mime = String(req.file.mimetype || "");
    const originalName = String(req.file.originalname || "");
    const looksPdf =
      mime === "application/pdf" ||
      mime === "application/x-pdf" ||
      originalName.toLowerCase().endsWith(".pdf");
    if (!looksPdf) {
      return res.status(400).json({ error: "File must be a PDF." });
    }

    const parsed = await pdfParse(req.file.buffer);
    const extracted = String(parsed.text || "").trim();
    if (!extracted) {
      return res.status(400).json({
        error:
          "No extractable text from PDF (empty document or image-only scan).",
      });
    }

    const { chunks } = await ingestTextForUser(userId, extracted, {
      source: "pdf",
      filename: originalName,
    });

    console.log(`[rag] POST /upload-pdf ok userId=${userId} chunks=${chunks}`);
    return res.status(200).json({ ok: true, chunks });
  } catch (error) {
    const status =
      error && typeof error.httpStatus === "number"
        ? error.httpStatus
        : 500;
    console.error("[rag] /upload-pdf error:", error);
    return res.status(status).json({
      error:
        error instanceof Error ? error.message : "PDF upload failed.",
    });
  }
});

/** POST /ask is registered on `twin-ai-app/server/index.js` (Cloud Run + local). */

app.listen(PORT, HOST, () => {
  console.log(
    `[rag] Listening on http://${HOST}:${PORT} — POST /upload, POST /upload-pdf (+ POST /ask, /ask-vision, … from twin-ai-app/server)`,
  );
  console.log(
    `[voice] Same app: POST /transcribe (multipart mock), POST /chat, POST /tts — use LAN IP from device, port ${PORT}`,
  );
});
