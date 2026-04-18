"use strict";

const { FieldValue } = require("firebase-admin/firestore");

/**
 * Store lightweight feedback so future prompts can bias tone (via user_profile read).
 */
async function mergeInsightFeedback(db, uid, helpful, insightId) {
  if (!uid || !db) return;
  await db.collection("user_profile").doc(uid).set(
    {
      userId: uid,
      behaviorInsightFeedback: {
        lastHelpful: helpful === true,
        lastInsightId: String(insightId || "").slice(0, 128),
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
}

module.exports = { mergeInsightFeedback };
