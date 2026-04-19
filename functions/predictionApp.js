"use strict";

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai").default;
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { PREDICTION_ENGINE_PROMPT } = require("./predictionEnginePrompt");
const { predictUserBehavior, hasStrongPredictionSignal } = require("./predictionAnalytics");

const MODEL = process.env.OPENAI_PREDICTION_MODEL || process.env.OPENAI_DECISION_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 48_000;
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

async function loadBehaviorEvents(db, uid, limit = 120) {
  const snap = await db
    .collection("user_behavior")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out.reverse();
}

async function loadRecentDecisions(db, uid, limit = 40) {
  const snap = await db
    .collection("decisions")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    out.push({
      id: d.id,
      userInput: x.userInput,
      recommendation: x.recommendation,
      followUpStatus: x.followUpStatus,
      executed: x.executed,
      confidence: x.confidence,
      outcome: x.outcome,
    });
  });
  return out.reverse();
}

async function alreadyPredictedThisSession(db, uid, sessionId) {
  if (!sessionId) return false;
  const snap = await db
    .collection("user_predictions")
    .where("userId", "==", uid)
    .where("sessionId", "==", sessionId)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * @param {import('firebase-functions/params').SecretParam} openaiApiKey
 * @param {(req: any, res: any, next: any) => void} requireAuth
 */
function createPredictionApp(openaiApiKey, requireAuth) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true }));
  app.options("/{*splat}", cors({ origin: true }));
  app.use(express.json({ limit: "128kb" }));

  app.post("/generate", requireAuth, async (req, res) => {
    const uid = req.uid;
    const sessionId = String(req.body?.sessionId || "").trim().slice(0, 128);
    const afterDecision = req.body?.afterDecision === true;
    const newDecisionHint = String(req.body?.newDecisionHint || "").trim().slice(0, 400);
    const force = req.body?.force === true;

    console.log(JSON.stringify({ event: "prediction_generate_start", uid, afterDecision, force }));

    try {
      const apiKey = openaiApiKey.value();
      if (!apiKey) {
        return res.status(500).json({ error: "Missing OpenAI configuration." });
      }

      const db = admin.firestore();

      if (
        !force &&
        sessionId &&
        (await alreadyPredictedThisSession(db, uid, sessionId))
      ) {
        return res.status(200).json({ skipped: true, reason: "session_limit" });
      }

      const events = await loadBehaviorEvents(db, uid);
      const decisions = await loadRecentDecisions(db, uid);
      const model = predictUserBehavior({ events, decisions });

      const strong = hasStrongPredictionSignal(events, decisions, model);
      if (!force && !afterDecision && !strong) {
        return res
          .status(200)
          .json({ skipped: true, reason: "weak_signal", predictionModel: model });
      }

      const openai = new OpenAI({ apiKey });
      const payload = {
        predictionModel: model,
        recentDecisionSnippets: decisions.slice(-6).map((d) => ({
          q: String(d.userInput || "").slice(0, 200),
          rec: String(d.recommendation || "").slice(0, 120),
          outcome: d.followUpStatus === "done" ? (d.executed ? "executed" : "not_executed") : "pending",
        })),
        newDecisionHint: newDecisionHint || null,
      };

      const completion = await withTimeout(
        openai.chat.completions.create({
          model: MODEL,
          temperature: 0.38,
          max_tokens: 900,
          messages: [
            { role: "system", content: PREDICTION_ENGINE_PROMPT },
            {
              role: "user",
              content: `Behavior + decision summary (JSON). Infer likely next move, not fate.\n\n${JSON.stringify(payload).slice(0, 14000)}`,
            },
          ],
        }),
        OPENAI_TIMEOUT_MS,
        "openai_prediction",
      );

      const markdown = String(completion.choices?.[0]?.message?.content || "").trim();
      if (!markdown) {
        return res.status(500).json({ error: "Empty model response." });
      }

      const ref = await db.collection("user_predictions").add({
        userId: uid,
        sessionId: sessionId || null,
        markdown,
        predictionModel: JSON.stringify(model).slice(0, 12000),
        trigger: afterDecision ? "after_decision" : strong ? "strong_pattern" : "force",
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(JSON.stringify({ event: "prediction_generate_ok", uid, id: ref.id }));

      return res.status(200).json({
        skipped: false,
        predictionId: ref.id,
        markdown,
        predictionModel: model,
      });
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(JSON.stringify({ event: "prediction_generate_error", uid, msg }));
      if (String(msg).includes("timeout")) {
        return res.status(504).json({ error: "Prediction timed out." });
      }
      return res.status(500).json({ error: msg });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

module.exports = { createPredictionApp };
