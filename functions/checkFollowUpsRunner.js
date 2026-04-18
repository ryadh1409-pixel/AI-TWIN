"use strict";

const OpenAI = require("openai").default;
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { sendReminderNotification } = require("./services/expoPushService");

const MODEL = process.env.OPENAI_DECISION_MODEL || "gpt-4o-mini";
const PUSH_LINE_TIMEOUT_MS = 12_000;
const MS_24H = 24 * 60 * 60 * 1000;
const MS_48H = 48 * 60 * 60 * 1000;
const MAX_SENDS_PER_RUN = 40;

const DEFAULT_PUSH_AR = "كيف ماشي القرار اللي أخذته أمس؟ 👀";

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

function isPendingDecision(data) {
  return String(data?.followUpStatus || "pending") !== "done";
}

/**
 * One short Arabic notification line (no markdown).
 * @param {import("openai").default|null} openai
 */
async function generateShortPushLine(openai, userInput, recommendation) {
  if (!openai) return DEFAULT_PUSH_AR;
  try {
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.55,
        max_tokens: 80,
        messages: [
          {
            role: "system",
            content: `Write ONE short push notification body in Arabic (Gulf-friendly). Max 100 characters. Friendly check-in about how their earlier decision is going — not pushy, no guilt, one emoji max optional. No quotes, no title, body only.`,
          },
          {
            role: "user",
            content: `قرار المستخدم (مختصر):\n${String(userInput || "").slice(0, 500)}\n\nالتوصية:\n${String(recommendation || "").slice(0, 400)}`,
          },
        ],
      }),
      PUSH_LINE_TIMEOUT_MS,
      "openai_push_line",
    );
    const t = String(completion.choices?.[0]?.message?.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return t || DEFAULT_PUSH_AR;
  } catch (e) {
    console.warn("[checkFollowUps] push line AI failed", e?.message || e);
    return DEFAULT_PUSH_AR;
  }
}

async function userReceivedPushInLast24h(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return false;
  const t = snap.data()?.lastDecisionReminderAt;
  const ms = createdMs(t);
  if (!ms) return false;
  return Date.now() - ms < MS_24H;
}

/**
 * Scheduled follow-up: pending decisions 24–48h old, reminder throttle on decision + max 1 push/user/24h.
 * @param {FirebaseFirestore.Firestore} db
 * @param {import("openai").default|null} openai
 */
async function runCheckFollowUps(db, openai) {
  const now = Date.now();
  const lower = admin.firestore.Timestamp.fromMillis(now - MS_48H);
  const upper = admin.firestore.Timestamp.fromMillis(now - MS_24H);

  let snap;
  try {
    snap = await db
      .collection("decisions")
      .where("createdAt", ">=", lower)
      .where("createdAt", "<=", upper)
      .orderBy("createdAt", "asc")
      .limit(150)
      .get();
  } catch (e) {
    console.error("[checkFollowUps] query failed", e?.message || e);
    return { sent: 0, skipped: 0, errors: 1, message: String(e?.message || e) };
  }

  const sentUserThisRun = new Set();
  let sent = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (!isPendingDecision(d)) {
      skipped += 1;
      continue;
    }
    const uid = String(d.userId || "").trim();
    if (!uid) {
      skipped += 1;
      continue;
    }
    if (sentUserThisRun.has(uid)) {
      skipped += 1;
      continue;
    }
    if (await userReceivedPushInLast24h(db, uid)) {
      skipped += 1;
      continue;
    }

    const lastRm = createdMs(d.lastReminderSentAt);
    if (lastRm && now - lastRm < MS_24H) {
      skipped += 1;
      continue;
    }

    try {
      const body = await generateShortPushLine(openai, d.userInput, d.recommendation);

      await doc.ref.set(
        {
          followUpMessage: body,
          followUpMessageAt: FieldValue.serverTimestamp(),
          lastReminderSentAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      sentUserThisRun.add(uid);

      const push = await sendReminderNotification(db, uid, body, { decisionId: doc.id });

      if (push.ok) {
        await db.collection("users").doc(uid).set(
          {
            lastDecisionReminderAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        sent += 1;
      } else {
        skipped += 1;
      }
    } catch (e) {
      console.warn("[checkFollowUps] row failed", doc.id, e?.message || e);
      skipped += 1;
    }

    if (sent >= MAX_SENDS_PER_RUN) break;
  }

  console.log(
    JSON.stringify({
      event: "checkFollowUps_complete",
      sent,
      skipped,
      scanned: snap.size,
    }),
  );
  return { sent, skipped, scanned: snap.size, errors: 0 };
}

module.exports = { runCheckFollowUps, generateShortPushLine, DEFAULT_PUSH_AR };
