"use strict";

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai").default;
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { DECISION_ENGINE_PROMPT } = require("./decisionEnginePrompt");
const { buildFollowUpSuggestionsForUser } = require("./followUpCheck");
const { mergeDecisionOutcomeIntoProfile } = require("./decisionProfileLearn");

const MODEL = process.env.OPENAI_DECISION_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 48_000;
const MAX_INPUT = 12_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

function sliceBetween(md, startMarker, endMarker) {
  const s = md.indexOf(startMarker);
  if (s === -1) return "";
  const from = s + startMarker.length;
  const e = endMarker ? md.indexOf(endMarker, from) : -1;
  return md.slice(from, e === -1 ? undefined : e).trim();
}

function parseRecommendationLine(md) {
  const block = sliceBetween(md, "## ✅ Recommendation", "## 💡 Reasoning");
  const first = block
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return first ? first.replace(/^[-*]\s*/, "").slice(0, 500) : "";
}

function parseConfidencePercent(md) {
  const block = sliceBetween(md, "## 🎯 Confidence", "## 🚀 Action Plan");
  const pct = block.match(/(\d{1,3})\s*%/);
  if (pct) return Math.min(100, Math.max(0, parseInt(pct[1], 10)));
  return null;
}

function parseActionPlan(md) {
  return sliceBetween(md, "## 🚀 Action Plan", "## 📈 PMF Insight").slice(0, 8000);
}

/**
 * @param {import('firebase-functions/params').SecretParam} openaiApiKey
 * @param {(req: any, res: any, next: any) => void} requireAuth
 */
function createDecideApp(openaiApiKey, requireAuth) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true }));
  app.options("/{*splat}", cors({ origin: true }));
  app.use(express.json({ limit: "128kb" }));

  const runDecide = async (req, res) => {
    const uid = req.uid;
    const raw =
      typeof req.body?.userInput === "string"
        ? req.body.userInput
        : typeof req.body?.message === "string"
          ? req.body.message
          : "";
    const userInput = String(raw || "").trim().slice(0, MAX_INPUT);
    if (!userInput) {
      return res.status(400).json({ error: "Missing userInput or message." });
    }

    const apiKey = openaiApiKey.value();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI configuration." });
    }

    const openai = new OpenAI({ apiKey });
    const started = Date.now();
    console.log(
      JSON.stringify({
        event: "decide_start",
        uid,
        inputLen: userInput.length,
        ts: new Date().toISOString(),
      }),
    );

    try {
      const completion = await withTimeout(
        openai.chat.completions.create({
          model: MODEL,
          temperature: 0.35,
          max_tokens: 3500,
          messages: [
            { role: "system", content: DECISION_ENGINE_PROMPT },
            { role: "user", content: userInput },
          ],
        }),
        OPENAI_TIMEOUT_MS,
        "openai",
      );

      const markdown = String(completion.choices?.[0]?.message?.content || "").trim();
      if (!markdown) {
        console.warn("[decide] empty completion", { uid });
        return res.status(500).json({ error: "Empty model response." });
      }

      const recommendation = parseRecommendationLine(markdown);
      const confidence = parseConfidencePercent(markdown);
      const actionPlan = parseActionPlan(markdown);

      let decisionId = null;
      try {
        const ref = await admin.firestore().collection("decisions").add({
          userId: uid,
          userInput,
          markdown,
          recommendation: recommendation || "",
          confidence: confidence != null ? confidence : null,
          actionPlan: actionPlan || "",
          followUpStatus: "pending",
          outcome: null,
          outcomeAt: null,
          executed: null,
          feedbackHelpful: null,
          followUpMessage: null,
          lastReminderSentAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
        decisionId = ref.id;
      } catch (fe) {
        console.error("[decide] firestore save failed:", fe?.message || fe);
      }

      console.log(
        JSON.stringify({
          event: "decide_ok",
          uid,
          ms: Date.now() - started,
          confidence,
          decisionId,
          hasActionPlan: Boolean(actionPlan),
          ts: new Date().toISOString(),
        }),
      );
      return res.status(200).json({
        markdown,
        recommendation,
        confidence,
        actionPlan: actionPlan || null,
        decisionId,
      });
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(JSON.stringify({ event: "decide_error", uid, msg, ts: new Date().toISOString() }));
      if (String(msg).includes("timeout")) {
        return res
          .status(504)
          .json({ error: "Decision request timed out. Try a shorter question." });
      }
      return res.status(500).json({ error: msg });
    }
  };

  app.post("/", requireAuth, runDecide);
  app.post("/decide", requireAuth, runDecide);

  app.get("/follow-ups", requireAuth, async (req, res) => {
    const uid = req.uid;
    const apiKey = openaiApiKey.value();
    const openai = apiKey ? new OpenAI({ apiKey }) : null;
    try {
      const db = admin.firestore();
      const result = await buildFollowUpSuggestionsForUser(db, openai, uid);
      console.log("[decide] follow-ups", { uid, count: result.items.length });
      return res.status(200).json(result);
    } catch (e) {
      console.error("[decide] follow-ups error", e?.message || e);
      return res.status(500).json({ error: e?.message || "follow-ups failed" });
    }
  });

  app.post("/outcome", requireAuth, async (req, res) => {
    try {
      const id = typeof req.body?.decisionId === "string" ? req.body.decisionId.trim() : "";
      if (!id) {
        return res.status(400).json({ error: "Missing decisionId." });
      }
      if (typeof req.body?.executed !== "boolean") {
        return res.status(400).json({ error: "executed must be a boolean." });
      }
      const executed = req.body.executed;
      const outcome =
        typeof req.body?.outcome === "string" ? req.body.outcome.trim().slice(0, 2000) : "";

      const ref = admin.firestore().collection("decisions").doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Not found." });
      }
      const owner = snap.data()?.userId;
      if (owner !== req.uid) {
        return res.status(403).json({ error: "Forbidden." });
      }

      await ref.update({
        followUpStatus: "done",
        executed,
        outcome: outcome || (executed ? "تم التنفيذ" : "لم يُنفَّذ"),
        outcomeAt: FieldValue.serverTimestamp(),
      });

      await mergeDecisionOutcomeIntoProfile(admin.firestore(), req.uid, {
        executed,
        outcomeNote: outcome || (executed ? "تم التنفيذ" : "ما نفذت"),
      });

      console.log("[decide] outcome", { uid: req.uid, id, executed });
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[decide] outcome error", e?.message || e);
      return res.status(500).json({ error: e?.message || "outcome failed" });
    }
  });

  const feedbackPost = async (req, res) => {
    try {
      const id = typeof req.body?.decisionId === "string" ? req.body.decisionId.trim() : "";
      if (!id) {
        return res.status(400).json({ error: "Missing decisionId." });
      }
      if (typeof req.body?.helpful !== "boolean") {
        return res.status(400).json({ error: "helpful must be a boolean." });
      }
      const helpful = req.body.helpful;
      const ref = admin.firestore().collection("decisions").doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Not found." });
      }
      const owner = snap.data()?.userId;
      if (owner !== req.uid) {
        return res.status(403).json({ error: "Forbidden." });
      }
      await ref.update({
        feedbackHelpful: helpful,
        feedbackAt: FieldValue.serverTimestamp(),
      });
      console.log("[decide] feedback", { uid: req.uid, id, helpful });
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[decide] feedback error", e?.message || e);
      return res.status(500).json({ error: e?.message || "feedback failed" });
    }
  };

  app.post("/feedback", requireAuth, feedbackPost);
  app.post("/decide/feedback", requireAuth, feedbackPost);

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

module.exports = { createDecideApp };
