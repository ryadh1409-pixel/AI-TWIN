'use strict';

const path = require('path');

/** User must be quiet at least this long before we consider a proactive line. */
const MIN_IDLE_MS = 25 * 60 * 1000;
/** Minimum hours between any proactive initiative for the same server user. */
const MIN_HOURS_BETWEEN_INITIATIVES = 6;
/** Meaningfulness threshold — avoids empty or random pings. */
const MEANINGFUL_THRESHOLD = 0.4;

function hoursSinceIso(iso) {
  if (!iso || typeof iso !== 'string') return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3600000;
}

async function fetchUserProfileDoc(userId) {
  try {
    const { getDb } = require(path.resolve(__dirname, '../../server/agent/firebase.js'));
    const db = getDb();
    if (!db || !userId || userId === 'local-user') return null;
    const snap = await db.collection('user_profile').doc(userId).get();
    return snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} userProfile
 */
function scoreMeaningfulness(userProfile, timeOfDay, recentMood) {
  let s = 0.18;
  const up = userProfile && typeof userProfile === 'object' ? userProfile : {};
  const mp = up.mood_patterns && typeof up.mood_patterns === 'object' ? up.mood_patterns : {};
  const tiredN = Number(mp.tired) || 0;
  const topics = Array.isArray(up.common_topics) ? up.common_topics.slice(0, 6) : [];
  const prefs = Array.isArray(up.preferences) ? up.preferences : [];
  const topicBlob = JSON.stringify(topics).toLowerCase();

  if (timeOfDay === 'night' || timeOfDay === 'evening') {
    s += 0.14;
    if (recentMood === 'tired' || tiredN >= 2) s += 0.28;
  }
  if (timeOfDay === 'morning') {
    s += 0.1;
    if (
      topicBlob.includes('news') ||
      topicBlob.includes('أخبار') ||
      prefs.some((p) => /news|أخبار|headline|digest/i.test(String(p)))
    ) {
      s += 0.24;
    }
  }
  if (topics.length >= 2) s += 0.08;
  if (String(up.last_intent || '').trim().length > 4) s += 0.06;
  return Math.min(1, s);
}

/**
 * @param {{
 *   gapMsSinceLastInteraction: number,
 *   userProfile: Record<string, unknown>|null,
 *   timeOfDay: string,
 *   recentMood: string,
 *   sessionInitiativeCount: number,
 *   hoursSinceLastInitiative: number,
 *   proactiveSessionId: string,
 *   serverInteractionCount?: number,
 * }} input
 * @returns {{ shouldInitiate: boolean, reason: string, meaningfulScore?: number }}
 */
function decideInitiative(input) {
  const {
    gapMsSinceLastInteraction,
    userProfile,
    timeOfDay,
    recentMood,
    sessionInitiativeCount,
    hoursSinceLastInitiative,
    proactiveSessionId,
    serverInteractionCount = 0,
  } = input;

  if (hoursSinceLastInitiative < MIN_HOURS_BETWEEN_INITIATIVES) {
    return { shouldInitiate: false, reason: 'global_rate_limit' };
  }

  const gap = Number.isFinite(gapMsSinceLastInteraction) ? gapMsSinceLastInteraction : Infinity;
  if (gap < MIN_IDLE_MS) {
    return { shouldInitiate: false, reason: 'recent_interaction' };
  }

  const sid = String(proactiveSessionId || '').trim();
  if (sid && sessionInitiativeCount >= 1) {
    return { shouldInitiate: false, reason: 'session_cap' };
  }

  let meaningfulScore = scoreMeaningfulness(userProfile, timeOfDay, recentMood);
  if (serverInteractionCount >= 4) {
    meaningfulScore = Math.min(1, meaningfulScore + 0.1);
  }
  if (meaningfulScore < MEANINGFUL_THRESHOLD) {
    return { shouldInitiate: false, reason: 'not_meaningful_enough', meaningfulScore };
  }

  if (Math.random() > 0.22 + meaningfulScore * 0.48) {
    return { shouldInitiate: false, reason: 'occasional_skip', meaningfulScore };
  }

  return { shouldInitiate: true, reason: 'due', meaningfulScore };
}

function summarizeProfileForPrompt(userProfile, serverMemorySummary) {
  const up = userProfile && typeof userProfile === 'object' ? userProfile : {};
  const prefs = Array.isArray(up.preferences) ? up.preferences.slice(0, 6).join(', ') : 'none';
  const topics = Array.isArray(up.common_topics)
    ? up.common_topics
        .slice(0, 5)
        .map((t) => `${t.topic || t.label}:${t.count}`)
        .join('; ')
    : 'none';
  const moods = up.mood_patterns && typeof up.mood_patterns === 'object' ? JSON.stringify(up.mood_patterns) : '{}';
  return `server_memory_summary: ${serverMemorySummary}
firestore_profile:
- preferences: ${prefs}
- common_topics: ${topics}
- mood_patterns: ${moods}
- last_intent: ${String(up.last_intent || '').slice(0, 120) || 'none'}`;
}

/**
 * @param {import('openai').default} openai
 * @param {string} model
 * @param {{ userProfileBlock: string, lastMessage: string, timeOfDay: string, mood: string, lastTopics?: string[] }} ctx
 */
async function generateProactiveMessage(openai, model, ctx) {
  const { userProfileBlock, lastMessage, timeOfDay, mood } = ctx;
  const lastTopics = Array.isArray(ctx.lastTopics) ? ctx.lastTopics.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8) : [];
  if (!openai) {
    return null;
  }

  const topicsLine =
    lastTopics.length > 0 ? `\nrecent_topics (hints only): ${lastTopics.join(', ')}` : '';

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.55,
    max_tokens: 56,
    messages: [
      {
        role: 'system',
        content: `You write ONE very short proactive line (the user did not just ask you something).
Rules:
- Calm, human, warm — not pushy, not salesy, not robotic.
- Match Arabic/English to the user's last message language if obvious; otherwise Arabic is fine.
- Max 16 words. No emoji spam. No "As an AI". No guilt.
- Offer a gentle hook: wind-down / sleep, light news, or check-in — only what fits time_of_day and mood.
- If recent_topics fit naturally, you may nod to one lightly; never list topics.
- Do not repeat the user's words verbatim.`,
      },
      {
        role: 'user',
        content: `time_of_day: ${timeOfDay}
recent_mood_signal: ${mood}
last_user_message (context only): ${String(lastMessage).slice(0, 500)}${topicsLine}

${userProfileBlock}

Write exactly one line the companion might say unprompted.`,
      },
    ],
  });

  const line = String(completion.choices?.[0]?.message?.content || '')
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!line || line.length > 220) return null;
  return line;
}

/** Natural delay before the client surfaces the line (ms). */
function randomInitiativeDelayMs() {
  return Math.floor(22000 + Math.random() * 70000);
}

module.exports = {
  decideInitiative,
  generateProactiveMessage,
  randomInitiativeDelayMs,
  fetchUserProfileDoc,
  scoreMeaningfulness,
  summarizeProfileForPrompt,
  MIN_IDLE_MS,
  MIN_HOURS_BETWEEN_INITIATIVES,
};
