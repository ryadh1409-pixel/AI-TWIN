"use strict";

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai").default;
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { INSIGHT_ENGINE_PROMPT } = require("./insightEnginePrompt");
const { analyzeUserBehavior, shouldTriggerInsight } = require("./behaviorAnalytics");
const { mergeInsightFeedback } = require("./insightProfileLearn");

const MODEL = process.env.OPENAI_INSIGHT_MODEL || process.env.OPENAI_DECISION_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 55_000;
const MS_24H = 24 * 60 * 60 * 1000;

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

function sliceFirstSection(md, heading) {
  const s = md.indexOf(heading);
  if (s === -1) return "";
  const from = s + heading.length;
  const next = md.indexOf("\n## ", from);
  return md
    .slice(from, next === -1 ? undefined : next)
    .trim()
    .slice(0, 400);
}

async function loadBehaviorEvents(db, uid, limit = 140) {
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

async function hadInsightInLast24h(db, uid) {
  const snap = await db
    .collection("user_insights")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return false;
  const t = snap.docs[0].data()?.createdAt;
  const ms = createdMs(t);
  return Boolean(ms && Date.now() - ms < MS_24H);
}

/**
 * @param {import('firebase-functions/params').SecretParam} openaiApiKey
 * @param {(req: any, res: any, next: any) => void} requireAuth
 */
function createBehaviorInsightApp(openaiApiKey, requireAuth) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true }));
  app.options("/{*splat}", cors({ origin: true }));
  app.use(express.json({ limit: "128kb" }));

  app.post("/generate", requireAuth, async (req, res) => {
    const uid = req.uid;
    const force = req.body?.force === true;
    const started = Date.now();
    console.log(JSON.stringify({ event: "insight_generate_start", uid, force }));

    try {
      const apiKey = openaiApiKey.value();
      if (!apiKey) {
        return res.status(500).json({ error: "Missing OpenAI configuration." });
      }

      const db = admin.firestore();
      if (!force && (await hadInsightInLast24h(db, uid))) {
        console.log(JSON.stringify({ event: "insight_generate_skip", uid, reason: "daily_cap" }));
        return res.status(200).json({ skipped: true, reason: "daily_cap" });
      }

      const events = await loadBehaviorEvents(db, uid);
      const patterns = analyzeUserBehavior(events);
      const trig = shouldTriggerInsight(patterns);
      if (!force && !trig.ok) {
        console.log(
          JSON.stringify({
            event: "insight_generate_skip",
            uid,
            reason: trig.reason,
            ms: Date.now() - started,
          }),
        );
        return res.status(200).json({ skipped: true, reason: trig.reason, patterns });
      }

      const openai = new OpenAI({ apiKey });
      const payload = {
        patterns,
        eventCount: events.length,
        recentMessages: events
          .filter((e) => e.eventType === "message")
          .slice(-12)
          .map((e) => String(e.messageText || "").slice(0, 160)),
      };

      const completion = await withTimeout(
        openai.chat.completions.create({
          model: MODEL,
          temperature: 0.42,
          max_tokens: 1200,
          messages: [
            { role: "system", content: INSIGHT_ENGINE_PROMPT },
            {
              role: "user",
              content: `Analyze this behavioral summary (JSON). Stay within the evidence.\n\n${JSON.stringify(payload).slice(0, 12000)}`,
            },
          ],
        }),
        OPENAI_TIMEOUT_MS,
        "openai_insight",
      );

      const markdown = String(completion.choices?.[0]?.message?.content || "").trim();
      if (!markdown) {
        return res.status(500).json({ error: "Empty model response." });
      }

      const patternSummary =
        sliceFirstSection(markdown, "## 🧠 Behavioral Insight") ||
        sliceFirstSection(markdown, "## 📊 Pattern Detected") ||
        "Insight";

      const ref = await db.collection("user_insights").add({
        userId: uid,
        markdown,
        patternSummary: patternSummary.slice(0, 400),
        patternsJson: JSON.stringify(patterns).slice(0, 8000),
        helpful: null,
        triggerReason: trig.reason || "force",
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(
        JSON.stringify({
          event: "insight_generate_ok",
          uid,
          insightId: ref.id,
          ms: Date.now() - started,
        }),
      );

      return res.status(200).json({
        skipped: false,
        insightId: ref.id,
        markdown,
        patternSummary,
      });
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(JSON.stringify({ event: "insight_generate_error", uid, msg }));
      if (String(msg).includes("timeout")) {
        return res.status(504).json({ error: "Insight request timed out." });
      }
      return res.status(500).json({ error: msg });
    }
  });

  app.post("/feedback", requireAuth, async (req, res) => {
    try {
      const id = typeof req.body?.insightId === "string" ? req.body.insightId.trim() : "";
      if (!id) return res.status(400).json({ error: "Missing insightId." });
      if (typeof req.body?.helpful !== "boolean") {
        return res.status(400).json({ error: "helpful must be a boolean." });
      }
      const helpful = req.body.helpful;
      const db = admin.firestore();
      const ref = db.collection("user_insights").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Not found." });
      if (snap.data()?.userId !== req.uid) return res.status(403).json({ error: "Forbidden." });
      await ref.update({
        helpful,
        helpfulAt: FieldValue.serverTimestamp(),
      });
      await mergeInsightFeedback(db, req.uid, helpful, id);
      console.log(JSON.stringify({ event: "insight_feedback", uid: req.uid, id, helpful }));
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[insight] feedback", e?.message || e);
      return res.status(500).json({ error: e?.message || "feedback failed" });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

module.exports = { createBehaviorInsightApp };
