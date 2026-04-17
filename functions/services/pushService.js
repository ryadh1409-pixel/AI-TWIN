/**
 * Placeholder for FCM / Expo push when you wire tokens in Firestore.
 * @param {{ reportId?: string, type?: string }} _payload
 */
async function notifyDailyReportPlaceholder(_payload) {
  // TODO: load device tokens from users/{uid}/devices, send via FCM HTTP v1 or Expo push API
  console.log(
    "[X7][push] placeholder — wire FCM/Expo; payload:",
    JSON.stringify(_payload || {}),
  );
}

module.exports = { notifyDailyReportPlaceholder };
