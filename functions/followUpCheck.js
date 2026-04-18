"use strict";

const OpenAI = require("openai").default;
const { FieldValue } = require("firebase-admin/firestore");
const { FOLLOWUP_PROMPT } = require("./followupPrompt");

const MODEL = process.env.OPENAI_DECISION_MODEL || "gpt-4o-mini";
const FOLLOWUP_TIMEOUT_MS = 22_000;
const DEFAULT_FOLLOWUP_AR =
  "وش صار على القرار اللي أخذته أمس؟ نفّذت التوصية ولا غيّرت خطتك؟";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

function createdMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts._seconds === "number") return ts._seconds * 1000;
  return 0;
}

function isPending(data) {
  const s = data?.followUpStatus;
  if (s === "done") return false;
  return true;
}

/**
 * Pending decisions older than minHours for follow-up nudge.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {{ minHours?: number, maxHours?: number, limit?: number }} opts
 */
async function checkFollowUpsForUser(db, uid, opts = {}) {
  const minHours = typeof opts.minHours === "number" ? opts.minHours : 24;
  const maxHours = typeof opts.maxHours === "number" ? opts.maxHours : 168;
  const limit = typeof opts.limit === "number" ? opts.limit : 25;
  const now = Date.now();
  const minMs = now - maxHours * 3600 * 1000;
  const maxMs = now - minHours * 3600 * 1000;

  const snap = await db
    .collection("decisions")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const candidates = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (!isPending(d)) return;
    const t = createdMs(d.createdAt);
    if (!t || t > maxMs || t < minMs) return;
    candidates.push({ id: doc.id, ref: doc.ref, data: d });
  });

  return candidates;
}

async function generateFollowUpMessage(openai, userInput, recommendation) {
  const completion = await withTimeout(
    openai.chat.completions.create({
      model: MODEL,
      temperature: 0.42,
      max_tokens: 220,
      messages: [
        { role: "system", content: FOLLOWUP_PROMPT },
        {
          role: "user",
          content: `Original question/decision:\n${String(userInput || "").slice(0, 2000)}\n\nRecommendation given:\n${String(recommendation || "").slice(0, 900)}`,
        },
      ],
    }),
    FOLLOWUP_TIMEOUT_MS,
    "openai_followup",
  );
  const text = String(completion.choices?.[0]?.message?.content || "").trim();
  return text || DEFAULT_FOLLOWUP_AR;
}

/**
 * Build follow-up suggestions for the authenticated user; optionally persist generated text on docs.
 * @param {FirebaseFirestore.Firestore} db
 * @param {import("openai").default|null} openai
 * @param {string} uid
 * @param {{ maxOpenAi?: number }} opts
 */
async function buildFollowUpSuggestionsForUser(db, openai, uid, opts = {}) {
  const maxOpenAi = typeof opts.maxOpenAi === "number" ? opts.maxOpenAi : 4;
  const rows = await checkFollowUpsForUser(db, uid);
  const out = [];
  let openAiUsed = 0;

  for (const row of rows) {
    const d = row.data;
    let message = typeof d.followUpMessage === "string" && d.followUpMessage.trim()
      ? d.followUpMessage.trim()
      : "";

    if (!message && openai && openAiUsed < maxOpenAi) {
      try {
        message = await generateFollowUpMessage(openai, d.userInput, d.recommendation);
        openAiUsed += 1;
        await row.ref.set(
          {
            followUpMessage: message,
            followUpMessageAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch (e) {
        console.warn("[followUp] openai failed", row.id, e?.message || e);
        message = DEFAULT_FOLLOWUP_AR;
      }
    }
    if (!message) message = DEFAULT_FOLLOWUP_AR;

    out.push({
      decisionId: row.id,
      userInput: String(d.userInput || "").slice(0, 400),
      recommendation: String(d.recommendation || "").slice(0, 300),
      confidence: typeof d.confidence === "number" ? d.confidence : null,
      followUpSuggestion: message,
      actionPlanPreview: String(d.actionPlan || "").slice(0, 200),
    });
  }

  return { items: out, defaultTemplate: DEFAULT_FOLLOWUP_AR };
}

module.exports = {
  checkFollowUpsForUser,
  buildFollowUpSuggestionsForUser,
  DEFAULT_FOLLOWUP_AR,
};
