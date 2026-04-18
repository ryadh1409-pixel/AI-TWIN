'use strict';

const { planTask } = require('./planTask');
const { executeSteps } = require('./executeSteps');

function formatFirestoreMemory(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return '(none)';
  }
  return conversationHistory
    .slice(-5)
    .map(
      (h, i) =>
        `[${i + 1}] user: ${String(h.message || '').slice(0, 800)}\nassistant: ${String(h.response || '').slice(0, 800)}`,
    )
    .join('\n---\n');
}

/**
 * Merge step outputs into one user-facing reply (OpenAI editor pass).
 */
async function combineStepResults(
  openai,
  model,
  userMessage,
  goal,
  stepResults,
  detectedMood = 'neutral',
  retentionBlock = '',
) {
  const nonEmpty = stepResults.filter((s) => {
    const o = String(s.output || '').trim();
    if (!o) return false;
    if (o.startsWith('(voice step:')) return false;
    return true;
  });
  if (nonEmpty.length === 0) {
    return 'I could not complete those steps. Try rephrasing?';
  }
  if (nonEmpty.length === 1) {
    return String(nonEmpty[0].output).trim();
  }

  const moodNote =
    detectedMood === 'stressed'
      ? ' The user seemed stressed — keep the combined reply calm, short, and grounding.'
      : detectedMood === 'tired'
        ? ' The user seemed tired — keep the combined reply gentle and brief.'
        : detectedMood === 'happy'
          ? ' The user seemed upbeat — keep the tone warm but not overexcited.'
          : '';

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.45,
    max_tokens: 1200,
    messages: [
      {
        role: 'system',
        content: `You combine multiple agent step outputs into ONE cohesive assistant message.
Preserve facts. Match the user's language (Arabic/English mix if present). Stay human, concise, and meaningful — no filler.
Planning goal: ${goal}.${moodNote}`,
      },
      {
        role: 'user',
        content: [
          `Original user message:\n${userMessage}`,
          retentionBlock && String(retentionBlock).trim()
            ? `\n\nApp retention (topics/streaks; use only if it improves tone — do not recite stats):\n${String(retentionBlock).trim().slice(0, 1800)}`
            : '',
          '',
          'Step outputs:',
          ...nonEmpty.map((s, i) => `\n--- Step ${i + 1} (${s.step}) ---\n${s.output}`),
        ].join('\n'),
      },
    ],
  });

  const out = completion.choices?.[0]?.message?.content?.trim();
  return out || nonEmpty.map((s) => s.output).join('\n\n');
}

/**
 * @param {object} ctx
 * @returns {Promise<{ reply: string, audio?: object|null, memoryHint?: string|null, nearbySuggestions?: unknown[], nearbySource?: string, plan: object, stepResults: object[] }>}
 */
async function runPlanningAgent(ctx) {
  const {
    openai,
    model,
    message,
    conversationHistory,
    userId,
    rawLocation,
    fetchNews,
    fetchSleepStory,
    synthesizeWithElevenLabs,
    runCompanionReplyCore,
    companionContext,
    detectedMood = 'neutral',
    retentionBlock = '',
  } = ctx;

  let memoryBlock = formatFirestoreMemory(conversationHistory);
  const rb = retentionBlock && String(retentionBlock).trim();
  if (rb) {
    memoryBlock = `Usage / retention (from app):\n${rb.slice(0, 4200)}\n\n---\n\n${memoryBlock}`;
  }
  const plan = await planTask(openai, model, message, memoryBlock, detectedMood);
  console.log('[agent/plan] goal:', plan.goal);
  console.log('[agent/plan] steps:', JSON.stringify(plan.steps));

  const { stepResults, needsTts, lastCompanionMeta } = await executeSteps({
    plan,
    message,
    userId,
    rawLocation,
    conversationHistory,
    fetchNews,
    fetchSleepStory,
    runCompanionReplyCore,
    companionContext,
    retentionContextBlock: retentionBlock || '',
  });

  console.log(
    '[agent/results]',
    JSON.stringify(
      stepResults.map((s) => ({
        step: s.step,
        preview: String(s.output || '').slice(0, 160),
      })),
    ),
  );

  const combined = await combineStepResults(
    openai,
    model,
    message,
    plan.goal,
    stepResults,
    detectedMood,
    retentionBlock,
  );
  console.log('[agent/plan] combined preview:', String(combined).slice(0, 240));

  let audio = null;
  if (needsTts && combined) {
    try {
      audio = await synthesizeWithElevenLabs(combined);
      console.log('[agent/plan] tts ok, bytes:', audio?.audioBase64?.length || 0);
    } catch (e) {
      console.warn('[agent/plan] tts failed:', e?.message || e);
    }
  }

  const memoryHint = lastCompanionMeta?.memoryHint ?? null;
  const nearbySuggestions = lastCompanionMeta?.nearbySuggestions ?? [];
  const nearbySource = lastCompanionMeta?.nearbySource ?? 'none';

  return {
    reply: combined,
    audio,
    memoryHint,
    nearbySuggestions,
    nearbySource,
    plan,
    stepResults,
  };
}

module.exports = { runPlanningAgent, formatFirestoreMemory, combineStepResults };
