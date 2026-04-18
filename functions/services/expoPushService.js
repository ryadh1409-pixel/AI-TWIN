"use strict";

const DEFAULT_TITLE = "قرارك";

/**
 * Send one Expo push notification (Expo Push API).
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} userId
 * @param {string} body — short natural text (Arabic OK)
 * @param {Record<string, unknown>} [data] — optional payload for deep link
 * @returns {Promise<{ ok: boolean, reason?: string, detail?: string }>}
 */
async function sendReminderNotification(db, userId, body, data = {}) {
  const uid = String(userId || "").trim();
  const text = String(body || "").trim().slice(0, 180);
  if (!uid || !text) {
    return { ok: false, reason: "bad_input" };
  }

  let token = "";
  try {
    const snap = await db.collection("users").doc(uid).get();
    token = snap.exists ? String(snap.data()?.expoPushToken || "").trim() : "";
  } catch (e) {
    console.warn("[expoPush] read users failed", uid, e?.message || e);
    return { ok: false, reason: "read_error" };
  }

  if (!token.startsWith("ExponentPushToken")) {
    console.log(JSON.stringify({ event: "expo_push_skip", uid, reason: "no_token" }));
    return { ok: false, reason: "no_token" };
  }

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        title: DEFAULT_TITLE,
        body: text,
        sound: "default",
        priority: "default",
        data: { type: "decision-followup", ...data },
      }),
    });
    const raw = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const err = parsed?.data?.[0]?.status === "error" ? parsed?.data?.[0]?.message : null;
    if (!res.ok || err) {
      console.warn(
        JSON.stringify({
          event: "expo_push_http_error",
          uid,
          status: res.status,
          err: err || raw.slice(0, 200),
        }),
      );
      return { ok: false, reason: "expo_reject", detail: err || raw.slice(0, 120) };
    }
    console.log(JSON.stringify({ event: "expo_push_sent", uid, len: text.length }));
    return { ok: true };
  } catch (e) {
    console.warn("[expoPush] fetch failed", uid, e?.message || e);
    return { ok: false, reason: "network", detail: String(e?.message || e) };
  }
}

module.exports = { sendReminderNotification, DEFAULT_TITLE };
