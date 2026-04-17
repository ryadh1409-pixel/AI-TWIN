const { getDb, getAdmin } = require("./firebase");

const CHATS = "chats";
const PROFILE = "profile";
const REMINDERS = "reminders";
const PROFILE_DOC_ID = "facts";

/**
 * @param {string} userId
 */
function memRef(userId) {
  const db = getDb();
  if (!db) return null;
  return db.collection("memories").doc(userId);
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
async function getProfile(userId) {
  const base = memRef(userId);
  if (!base) return {};
  const snap = await base.collection(PROFILE).doc(PROFILE_DOC_ID).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : {};
}

/**
 * @param {string} userId
 * @param {Record<string, unknown>} partial
 */
async function mergeProfile(userId, partial) {
  const base = memRef(userId);
  if (!base) return;
  const admin = getAdmin();
  if (!admin) return;
  await base.collection(PROFILE).doc(PROFILE_DOC_ID).set(
    {
      ...partial,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * @param {string} userId
 * @param {{ role: string, text: string, embedding?: number[] }} payload
 */
async function appendChat(userId, payload) {
  const base = memRef(userId);
  if (!base) return;
  const admin = getAdmin();
  if (!admin) return;
  const ts = Date.now();
  await base.collection(CHATS).add({
    role: payload.role,
    text: payload.text,
    timestamp: admin.firestore.Timestamp.fromMillis(ts),
    embedding: payload.embedding || [],
  });
}

/**
 * Last N chat messages, oldest first (for LLM context).
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<Array<{ role: string, text: string, timestamp?: unknown }>>}
 */
async function getRecentChats(userId, limit = 20) {
  const base = memRef(userId);
  if (!base) return [];
  const snap = await base
    .collection(CHATS)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .get();

  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      role: data.role === "ai" ? "assistant" : data.role === "user" ? "user" : "user",
      text: String(data.text || ""),
      timestamp: data.timestamp,
    };
  });
  return rows.reverse();
}

/**
 * @param {string} userId
 * @param {{ text: string, remindAtIso: string }} payload
 */
async function addReminder(userId, payload) {
  const base = memRef(userId);
  if (!base) return { ok: false, error: "no_db" };
  const admin = getAdmin();
  if (!admin) return { ok: false, error: "no_db" };
  const at = new Date(payload.remindAtIso);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: "invalid_date" };
  }
  const ref = await base.collection(REMINDERS).add({
    text: String(payload.text || "").trim(),
    remindAt: admin.firestore.Timestamp.fromDate(at),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, id: ref.id };
}

module.exports = {
  getProfile,
  mergeProfile,
  appendChat,
  getRecentChats,
  addReminder,
};
