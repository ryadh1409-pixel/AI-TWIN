'use strict';

/**
 * Ask the model for a structured plan: goal + ordered steps.
 * @param {import('openai').default} openai
 * @param {string} model
 * @param {string} message
 * @param {string} memoryBlock — Firestore conversation memory + optional hints
 * @param {'tired'|'stressed'|'happy'|'neutral'} [detectedMood]
 * @returns {Promise<{ goal: string, steps: string[] }>}
 */
async function planTask(openai, model, message, memoryBlock, detectedMood = 'neutral') {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a planning agent. Read the user message and memory, then output ONLY valid JSON:
{"goal":"short phrase","steps":["step 1","step 2",...]}

Rules for steps (short imperative phrases, English is fine):
- Include "news" or "fetch news" when the user wants headlines, Saudi/Gulf news, digest, أخبار.
- Include "sleep story" or "bedtime story" when the user wants a story before sleep, قصة نوم.
- Include "voice" or "tts" when the user wants spoken audio of the result (usually LAST after content is ready).
- Include "chat" or "answer" for normal conversation, advice, questions, or when nothing else fits.
- Order steps logically (e.g. generate content before voice).
- Use 1–4 steps typically.

Mood signal for this turn: ${detectedMood}
- If mood is tired and the user is not refusing stories, prefer including a sleep story or gentle wind-down step when it fits.
- If mood is stressed, avoid piling on tasks; prefer simple chat support or calming content, not noisy news unless they asked.
- If memory mentions past structured decisions, use them only when clearly relevant to the current message (do not force continuity).`,
      },
      {
        role: 'user',
        content: `Memory (recent user/assistant exchanges, oldest first):\n${memoryBlock}\n\nUser message:\n${message}`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const goal = typeof parsed.goal === 'string' && parsed.goal.trim() ? parsed.goal.trim() : 'assist the user';
  let steps = Array.isArray(parsed.steps) ? parsed.steps.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (steps.length === 0) {
    steps = ['answer the user in chat'];
  }
  return { goal, steps };
}

module.exports = { planTask };
