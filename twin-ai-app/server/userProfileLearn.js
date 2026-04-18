'use strict';

const path = require('path');
const { FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'user_profile';
const MAX_PREFERENCES = 10;
const MAX_TOPICS = 18;
const TOPIC_DECAY = 0.97;
const MIN_CONF_FOR_MOOD = 0.38;
const MIN_CONF_FOR_PREFERENCES = 0.52;

function getFirebaseDb() {
  try {
    const { getDb } = require(path.resolve(__dirname, '../../server/agent/firebase.js'));
    return getDb();
  } catch {
    return null;
  }
}

function usageBucketKey(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getUTCDay()]}-${String(d.getUTCHours()).padStart(2, '0')}`;
}

function normalizeTopicLabel(s) {
  return String(s || '')
    .trim()
    .slice(0, 48);
}

/**
 * Gradual merge: light decay on topic counts, cap list sizes, few new preferences per turn.
 * @param {Record<string, unknown>} existing
 * @param {{ mood: string, topicHints: string[], interests?: string[], intent?: string, confidence?: number }} signals
 * @param {Date} now
 */
function mergeProfileDocument(existing, signals, now) {
  const conf =
    typeof signals.confidence === 'number' && Number.isFinite(signals.confidence)
      ? Math.min(1, Math.max(0, signals.confidence))
      : 0.55;

  const preferences = Array.isArray(existing.preferences)
    ? existing.preferences.map((p) => String(p).trim()).filter(Boolean)
    : [];
  const moodBase = { tired: 0, stressed: 0, happy: 0, neutral: 0 };
  const mood_patterns =
    existing.mood_patterns && typeof existing.mood_patterns === 'object'
      ? { ...moodBase, ...existing.mood_patterns }
      : { ...moodBase };
  const usage_times =
    existing.usage_times && typeof existing.usage_times === 'object'
      ? { buckets: { ...(existing.usage_times.buckets || {}) } }
      : { buckets: {} };
  const common_topics = Array.isArray(existing.common_topics)
    ? existing.common_topics.map((t) => ({
        topic: String(t.topic || t.label || '').trim(),
        count: Math.max(0, Number(t.count) || 0),
      }))
    : [];

  const bucketKey = usageBucketKey(now);
  usage_times.buckets[bucketKey] = (usage_times.buckets[bucketKey] || 0) + 1;
  usage_times.last_seen = now.toISOString();

  const mood = ['tired', 'stressed', 'happy', 'neutral'].includes(String(signals.mood || '').toLowerCase())
    ? String(signals.mood).toLowerCase()
    : 'neutral';
  if (conf >= MIN_CONF_FOR_MOOD) {
    mood_patterns[mood] = (mood_patterns[mood] || 0) + 1;
  }

  let decayed = common_topics
    .filter((t) => t.topic)
    .map((t) => ({ topic: t.topic, count: Math.max(0.01, (t.count || 1) * TOPIC_DECAY) }));

  const bump = new Map();
  for (const h of [...(signals.topicHints || []), ...(signals.interests || [])].map(normalizeTopicLabel).filter(Boolean)) {
    bump.set(h.toLowerCase(), h);
  }
  for (const [, label] of bump) {
    const key = label.toLowerCase();
    const idx = decayed.findIndex((t) => t.topic.toLowerCase() === key);
    if (idx >= 0) {
      decayed[idx] = { topic: decayed[idx].topic, count: decayed[idx].count + 1 };
    } else if (conf >= MIN_CONF_FOR_PREFERENCES) {
      decayed.push({ topic: label, count: 1 });
    }
  }

  decayed = decayed
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOPICS)
    .map((t) => ({ topic: t.topic, count: Math.round(t.count * 10) / 10 }));

  const newPrefs = [];
  if (conf >= MIN_CONF_FOR_PREFERENCES) {
    for (const x of (signals.interests || []).map(normalizeTopicLabel).filter(Boolean).slice(0, 2)) {
      if (!preferences.some((p) => p.toLowerCase() === x.toLowerCase())) {
        newPrefs.push(x);
      }
    }
  }
  const mergedPrefs = [...newPrefs, ...preferences].slice(0, MAX_PREFERENCES);

  const last_intent =
    conf >= MIN_CONF_FOR_PREFERENCES && signals.intent && String(signals.intent).trim()
      ? String(signals.intent).trim().slice(0, 120)
      : existing.last_intent || '';

  return {
    preferences: mergedPrefs,
    common_topics: decayed,
    mood_patterns,
    usage_times,
    last_intent,
    learning_confidence_last: conf,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Persist adaptive signals to Firestore `user_profile/{userId}` (Admin SDK).
 * Skips when Firebase is not configured or user is anonymous.
 *
 * @param {{ userId: string, signals: { mood: string, topicHints: string[], interests?: string[], intent?: string, confidence?: number } }} args
 */
async function updateUserProfile(args) {
  const { userId, signals } = args;
  if (!userId || userId === 'local-user' || !signals) {
    return;
  }

  const db = getFirebaseDb();
  if (!db) {
    return;
  }

  const ref = db.collection(COLLECTION).doc(userId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : {};
  const merged = mergeProfileDocument(existing, signals, new Date());

  await ref.set(
    {
      userId,
      ...merged,
    },
    { merge: true },
  );
  console.log('[user_profile] updated', userId, { mood: signals.mood, conf: signals.confidence });
}

module.exports = { updateUserProfile, mergeProfileDocument, COLLECTION };
