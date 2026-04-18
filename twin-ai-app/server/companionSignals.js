'use strict';

const MOODS = new Set(['tired', 'stressed', 'happy', 'neutral']);

/**
 * Classify latest user message: mood + short topic hints for memory.
 * @param {import('openai').default} openai
 * @param {string} model
 * @param {string} text
 * @returns {Promise<{ mood: string, topicHints: string[], interests: string[], intent: string, confidence: number }>}
 */
async function analyzeUserSignals(openai, model, text) {
  const trimmed = String(text || '').trim();
  if (!openai || !trimmed) {
    return { mood: 'neutral', topicHints: [], interests: [], intent: '', confidence: 0 };
  }

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 180,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Analyze ONLY the user's latest message. Output JSON:
{"mood":"tired"|"stressed"|"happy"|"neutral","topic_hints":["...",...],"interests":["...",...],"intent":"<few words>","confidence":0.0-1.0}

mood:
- tired: sleepy, late night, exhausted, insomnia, "can't sleep", تعبان، ما نمت، نعسان
- stressed: overwhelmed, anxious, deadline pressure, worried, ضغط، قلق، تعبت نفسياً
- happy: excited, celebrating, great news, cheerful, فرحان، مبسوط
- neutral: default when unclear

topic_hints: 0-3 short theme labels (work, family, sleep, news, …). [] if none.
interests: 0-2 longer-term likes/hobbies ONLY if clearly stated (not guesses). [] if none.
intent: 3-8 words: what they want now (e.g. "wind down", "get news", "vent"). "" if unclear.
confidence: your certainty in this whole extraction (use LOW 0.25-0.45 when ambiguous; do not overfit).`,
      },
      { role: 'user', content: trimmed.slice(0, 2000) },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { mood: 'neutral', topicHints: [], interests: [], intent: '', confidence: 0 };
  }
  let mood = String(parsed.mood || 'neutral').toLowerCase();
  if (!MOODS.has(mood)) mood = 'neutral';

  const hints = Array.isArray(parsed.topic_hints)
    ? parsed.topic_hints
    : Array.isArray(parsed.topicHints)
      ? parsed.topicHints
      : [];
  const topicHints = hints
    .map((h) => String(h || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  const intArr = Array.isArray(parsed.interests)
    ? parsed.interests
    : Array.isArray(parsed.interest)
      ? parsed.interest
      : [];
  const interests = intArr
    .map((h) => String(h || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  const intent = String(parsed.intent || '').trim().slice(0, 120);
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.55;
  confidence = Math.min(1, Math.max(0, confidence));

  return { mood, topicHints, interests, intent, confidence };
}

module.exports = { analyzeUserSignals };
