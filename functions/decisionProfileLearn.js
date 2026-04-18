"use strict";

const { FieldValue } = require("firebase-admin/firestore");

/**
 * Merge decision outcome signals into user_profile for companion personalization.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {{ executed: boolean, outcomeNote?: string }} payload
 */
async function mergeDecisionOutcomeIntoProfile(db, uid, { executed, outcomeNote }) {
  if (!uid || !db) return;
  const ref = db.collection("user_profile").doc(uid);
  const snap = await ref.get();
  const ex = snap.exists ? snap.data() || {} : {};
  const dl =
    ex.decisionLearning && typeof ex.decisionLearning === "object"
      ? ex.decisionLearning
      : {};
  const followed = Number(dl.followedCount || 0) + (executed ? 1 : 0);
  const skipped = Number(dl.skippedCount || 0) + (executed ? 0 : 1);
  const total = followed + skipped;
  const executionRate = total > 0 ? Math.round((followed / total) * 100) / 100 : 0;
  let riskTolerance = "unknown";
  if (total >= 3) {
    if (executionRate >= 0.62) riskTolerance = "execution-oriented";
    else if (executionRate <= 0.35) riskTolerance = "cautious-selective";
    else riskTolerance = "balanced";
  }
  const styleNotes = Array.isArray(dl.styleNotes)
    ? dl.styleNotes.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const note = String(outcomeNote || "").trim().slice(0, 240);
  if (note) {
    styleNotes.unshift(note);
    styleNotes.splice(10);
  }
  await ref.set(
    {
      userId: uid,
      decisionLearning: {
        followedCount: followed,
        skippedCount: skipped,
        executionRate,
        riskTolerance,
        styleNotes,
        lastOutcomeAt: FieldValue.serverTimestamp(),
        lastExecuted: executed,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

module.exports = { mergeDecisionOutcomeIntoProfile };
