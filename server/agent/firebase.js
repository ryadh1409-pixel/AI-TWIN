/**
 * Firebase Admin — optional. If credentials are missing, Firestore features are skipped.
 */
// eslint-disable-next-line import/no-extraneous-dependencies
const admin = require("firebase-admin");

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin.apps.length > 0 ? admin : null;
  initialized = true;

  try {
    if (admin.apps.length > 0) {
      return admin;
    }

    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (json && json.trim()) {
      const cred = JSON.parse(json);
      admin.initializeApp({
        credential: admin.credential.cert(cred),
      });
    } else if (credPath && credPath.trim()) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } else {
      console.warn(
        "[agent] Firestore disabled: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS",
      );
      return null;
    }

    return admin;
  } catch (e) {
    console.warn("[agent] Firebase init failed:", e?.message || e);
    return null;
  }
}

function getDb() {
  const a = initFirebaseAdmin();
  if (!a || !a.apps.length) return null;
  return a.firestore();
}

function getAdmin() {
  const a = initFirebaseAdmin();
  if (!a || !a.apps.length) return null;
  return a;
}

module.exports = { initFirebaseAdmin, getDb, getAdmin };
