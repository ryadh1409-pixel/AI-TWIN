'use strict';

/**
 * Skip obvious low-value cases to avoid extra model calls and UI noise.
 */
function shouldSkipSuggestHeuristic(lastUserMessage, assistantReply) {
  const u = String(lastUserMessage || '').trim().toLowerCase();
  if (u.length < 2) return true;
  const trivial =
    /^(ok|okay|k|kk|ya|yep|thanks|thank you|thx|ty|شكرا|شكرًا|تمام|تم|الحمدلله|bye|goodbye|سلام|مع السلامة|نعم|لا|👍|🙏)\.?$/i;
  if (trivial.test(u)) return true;
  if (/^عذرًا، صار خطأ|^sorry, something went wrong/i.test(String(assistantReply || ''))) {
    return true;
  }
  return false;
}

function formatRecentPairs(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return '(none)';
  }
  return conversationHistory
    .slice(-4)
    .map(
      (h, i) =>
        `[${i + 1}] user: ${String(h.message || '').slice(0, 400)}\nassistant: ${String(h.response || '').slice(0, 400)}`,
    )
    .join('\n---\n');
}

/**
 * One lightweight follow-up suggestion (or null). Max one string per call.
 * @param {import('openai').default} openai
 * @param {string} model
 * @param {{
 *   lastUserMessage: string,
 *   assistantReply: string,
 *   memorySummary: string,
 *   timeOfDay: string,
 *   timeOfDayHint?: string,
 *   conversationHistory: unknown[],
 * }} input
 * @returns {Promise<string|null>}
 */
async function suggestNextAction(openai, model, input) {
  const {
    lastUserMessage,
    assistantReply,
    memorySummary,
    timeOfDay,
    timeOfDayHint,
    conversationHistory,
  } = input;

  if (!openai) return null;

  if (shouldSkipSuggestHeuristic(lastUserMessage, assistantReply)) {
    console.log('[suggest] skipped (heuristic)');
    return null;
  }

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.25,
    max_tokens: 90,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You output ONLY JSON: {"suggest": "<string>"} or {"suggest": null}

"suggest" is ONE optional follow-up for a friendly bilingual (Arabic/English) companion — e.g. sleep story before bed, Gulf news, read reply aloud, nearby walk.

Rules:
- null unless a concrete next step clearly helps now. No generic "how can I help" or chit-chat.
- null if the exchange already feels complete (thanks, goodbye, simple acknowledgment).
- Match the user's language from last_user when possible.
- If memory or time_of_day suggests tired/night wind-down, a soft sleep-story offer is a strong candidate when non-null.
- One short question or offer, max ~20 words. Plain text, no nested quotes.`,
      },
      {
        role: 'user',
        content: `time_of_day: ${timeOfDay}
${timeOfDayHint ? `hint: ${timeOfDayHint}\n` : ''}memory: ${memorySummary}

recent_exchanges:
${formatRecentPairs(conversationHistory)}
---
last_user: ${String(lastUserMessage).slice(0, 800)}
assistant_reply: ${String(assistantReply).slice(0, 1500)}`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = parsed.suggest;
  if (s === null || s === undefined) {
    console.log('[suggest] model returned null');
    return null;
  }
  const out = String(s).trim().replace(/^["']|["']$/g, '');
  if (!out || out.length > 220) return null;
  console.log('[suggest] ok:', out.slice(0, 100));
  return out;
}

module.exports = { suggestNextAction, shouldSkipSuggestHeuristic };
