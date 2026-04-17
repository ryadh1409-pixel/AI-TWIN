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
const { OpenAIEmbeddings, ChatOpenAI } = require("@langchain/openai");
const { FaissStore } = require("@langchain/community/vectorstores/faiss");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_MODEL = "gpt-4o-mini";
const FAISS_ROOT = path.resolve(__dirname, "faiss_index");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

/** Shared AI Twin personality for /ask and /ask-vision */
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

const embeddings = new OpenAIEmbeddings({
  apiKey: OPENAI_API_KEY,
  model: EMBEDDING_MODEL,
});

const chatModel = OPENAI_API_KEY
  ? new ChatOpenAI({
      apiKey: OPENAI_API_KEY,
      model: CHAT_MODEL,
      temperature: 0.75,
      maxTokens: 500,
    })
  : null;

const upload = multer();
const uploadPdfMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
/** Same Express app as twin-ai-app/server/index.js (required below).
 *  POST /ask-vision is registered on that app (see twin-ai-app/server/index.js).
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

app.post("/ask", upload.none(), async (req, res) => {
  try {
    if (!OPENAI_API_KEY || !chatModel) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    }

    const question = String(req.body?.question || "").trim();
    const userId = normalizeUserId(req.body?.userId);

    if (!question) {
      return res.status(400).json({ error: "Missing question." });
    }
    if (!userId) {
      return res.status(400).json({ error: "Missing userId." });
    }

    const indexDir = userIndexDir(userId);
    let userPrompt = `Question:\n${question}`;
    if (hasUserIndex(indexDir)) {
      const docs = await getChunksFromFaiss(indexDir, question, 5);
      const context = docs
        .map((doc, i) => `Chunk ${i + 1}:\n${String(doc.pageContent || "")}`)
        .join("\n\n");
      userPrompt = `Context:\n${context}\n\nQuestion:\n${question}`;
    } else {
      console.log(
        `[rag] /ask no FAISS index for userId=${userId} — using direct model fallback`,
      );
    }

    const msg = await chatModel.invoke([
      new SystemMessage(AI_TWIN_SYSTEM_PROMPT),
      new HumanMessage(userPrompt),
    ]);

    const raw = msg?.content;
    const answer = Array.isArray(raw)
      ? raw.map((p) => (typeof p === "string" ? p : p?.text || "")).join("")
      : String(raw || "").trim();

    return res.status(200).json({ answer });
  } catch (error) {
    console.error("[rag] /ask error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Ask failed.",
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(
    `[rag] Listening on http://${HOST}:${PORT} — POST /upload, POST /upload-pdf, POST /ask (+ POST /ask-vision from twin-ai-app/server)`,
  );
});
