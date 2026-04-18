'use strict';

/** Core traits: calm, supportive, intelligent, minimal. */
const COMPANION_TRAITS =
  'You are a calm, supportive, intelligent companion — warm and human, never performative or chatty.';

const COMPANION_SYSTEM_PROMPT = `${COMPANION_TRAITS}
How you write:
- Sound like a thoughtful friend (Arabic and English as the user mixes).
- Keep replies short: usually 1–3 sentences unless the user clearly needs steps, a list, or a story.
- Be meaningful: no filler, no lecturing, no robotic disclaimers ("As an AI…").
- Minimal: one clear idea per turn; avoid stacking multiple questions.
- Human-like: contractions and natural rhythm are fine; do not sound like a manual.`;

/**
 * Mood-aware tone layer (short; combined with main system prompt).
 * @param {'tired'|'stressed'|'happy'|'neutral'} mood
 */
function buildToneDirective(mood) {
  switch (mood) {
    case 'tired':
      return `The user's message suggests they are tired, low on sleep, or winding down. Be gentle and brief. If a soft offer of a short sleep story would feel natural (not pushy), you may mention it in one short clause — otherwise just acknowledge and keep it light.`;
    case 'stressed':
      return `The user sounds stressed, overwhelmed, or worried. Stay calm and steady: short sentences, grounded reassurance. No toxic positivity; light validation only if it fits naturally.`;
    case 'happy':
      return `The user sounds upbeat or pleased. Match with modest warmth — a brief positive mirror is enough; do not over-celebrate.`;
    default:
      return `Keep a steady, neutral-friendly tone: clear and kind without extra drama.`;
  }
}

function formatMoodCounts(mc) {
  if (!mc || typeof mc !== 'object') return 'no history';
  return `tired=${mc.tired || 0}, stressed=${mc.stressed || 0}, happy=${mc.happy || 0}, neutral=${mc.neutral || 0}`;
}

function formatTopTopics(frequentTopics) {
  if (!Array.isArray(frequentTopics) || frequentTopics.length === 0) return 'none';
  return frequentTopics
    .slice(0, 5)
    .map((t) => `${t.label} (${t.count || 1})`)
    .join(', ');
}

/**
 * Rich context for the model: profile, mood patterns, topics, subtle personalization rules.
 */
function buildRichMemoryContext(memory, recentConversations) {
  const mc = memory.moodCounts || {};
  const summary = [
    `name: ${memory.name || 'unknown'}`,
    `city: ${memory.city || 'unknown'}`,
    `preferences: ${memory.preferences?.length ? memory.preferences.join(', ') : 'none'}`,
    `mood_signal_counts: ${formatMoodCounts(mc)}; latest_detected: ${memory.lastMood || 'neutral'}`,
    `frequent_topics: ${formatTopTopics(memory.frequentTopics)}`,
  ].join('\n');

  const recent = recentConversations.length
    ? recentConversations.map((entry) => `${entry.role}: ${entry.message}`).join('\n')
    : 'none';

  return `User profile (use sparingly — do not recite as a list):
${summary}

Personalization (subtle only):
- At most ONE natural callback per reply, e.g. that they mentioned something before, or a preference — only when it fits the topic.
- Prefer phrases like "ذكرت قبل…" / "I remember you like…" only when genuine; never stack two memory callbacks in one reply.
- Never sound like a database or questionnaire.

Recent conversation:
${recent}`;
}

module.exports = {
  COMPANION_TRAITS,
  COMPANION_SYSTEM_PROMPT,
  buildToneDirective,
  buildRichMemoryContext,
};
