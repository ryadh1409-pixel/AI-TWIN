'use strict';

/**
 * Run plan steps in order. Keyword routing (case-insensitive):
 * - news → fetchNews()
 * - sleep / sleep story / bedtime → fetchSleepStory()
 * - voice / tts → mark needsTts (audio after combine)
 * - else → runCompanionReplyCore() for chat
 *
 * @param {object} ctx
 * @param {{ goal: string, steps: string[] }} ctx.plan
 * @param {string} ctx.message
 * @param {string} ctx.userId
 * @param {unknown} ctx.rawLocation
 * @param {unknown[]} ctx.conversationHistory
 * @param {() => Promise<string>} ctx.fetchNews
 * @param {() => Promise<string>} ctx.fetchSleepStory
 * @param {(args: object) => Promise<object>} ctx.runCompanionReplyCore
 * @param {{ mood: string, toneDirective: string }|null|undefined} ctx.companionContext
 * @param {string} [ctx.retentionContextBlock] — optional app retention JSON/text for companion prompt
 * @returns {Promise<{ stepResults: { step: string, output: string }[], needsTts: boolean, lastCompanionMeta: object|null }>}
 */
async function executeSteps(ctx) {
  const {
    plan,
    message,
    userId,
    rawLocation,
    conversationHistory,
    fetchNews,
    fetchSleepStory,
    runCompanionReplyCore,
    companionContext,
    retentionContextBlock,
  } = ctx;

  const stepResults = [];
  let needsTts = false;
  /** @type {object|null} */
  let lastCompanionMeta = null;

  for (let i = 0; i < plan.steps.length; i++) {
    const stepRaw = String(plan.steps[i] || '').trim();
    const step = stepRaw.toLowerCase();
    console.log('[agent/plan] step', i + 1, '/', plan.steps.length, ':', stepRaw);

    let output = '';
    try {
      if (step.includes('news')) {
        output = await fetchNews();
      } else if (step.includes('sleep') || (step.includes('story') && step.includes('bed'))) {
        output = await fetchSleepStory();
      } else if (step.includes('voice') || step.includes('tts') || step.includes('text to speech')) {
        needsTts = true;
        output = '(voice step: audio will be generated from the final combined reply)';
      } else {
        const r = await runCompanionReplyCore({
          userId,
          text: message,
          location: rawLocation,
          conversationHistory,
          companionContext: companionContext || null,
          retentionContextBlock: retentionContextBlock || null,
        });
        output = r.reply;
        lastCompanionMeta = {
          memoryHint: r.memoryHint ?? null,
          nearbySuggestions: r.nearbySuggestions ?? [],
          nearbySource: r.nearbySource ?? 'none',
        };
      }
    } catch (err) {
      output = `(step failed: ${err?.message || err})`;
    }

    stepResults.push({ step: stepRaw, output });
    console.log('[agent/plan] step result preview:', String(output).slice(0, 200));
  }

  return { stepResults, needsTts, lastCompanionMeta };
}

module.exports = { executeSteps };
