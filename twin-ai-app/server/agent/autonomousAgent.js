'use strict';

/**
 * @typedef {'respond'|'use_tool'|'store_memory'|'wait'|'suggest'} AgentActionType
 * @typedef {{ type: AgentActionType, tool?: 'news'|'sleep'|'tts'|null, reason?: string }} AgentDecision
 */

const AGENT_GOAL = 'Help the user proactively and intelligently';

const MAX_LOOPS = 2;
const DEFAULT_TIMEOUT_MS = 52000;

function formatShortTermMemory(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return '(none)';
  }
  return conversationHistory
    .slice(-6)
    .map(
      (h, i) =>
        `[${i + 1}] user: ${String(h.message || '').slice(0, 600)}\nassistant: ${String(h.response || '').slice(0, 600)}`,
    )
    .join('\n---\n');
}

function withDeadline(promise, ms) {
  if (ms == null || ms <= 0) {
    return Promise.reject(new Error('timeout'));
  }
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('agent_timeout')), ms)),
  ]);
}

/**
 * Decision engine: pick one action for this step.
 * @param {object} context
 * @param {import('openai').default} openai
 * @param {string} model
 * @returns {Promise<AgentDecision>}
 */
async function decideNextAction(context, openai, model) {
  if (!openai) {
    return { type: 'respond', tool: null, reason: 'no_openai_fallback' };
  }

  const toolHint = context.toolOutput
    ? `Prior step already fetched content (preview): ${String(context.toolOutput).slice(0, 400)}… You should usually choose "respond" to integrate it naturally unless user asked for more tools.`
    : '';

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.15,
    max_tokens: 140,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are the decision engine for one step of an autonomous companion agent.

Goal: ${AGENT_GOAL}

Choose exactly ONE action:
- "respond": produce the main conversational reply (default when chat suffices or after integrating tool output).
- "use_tool": need fresh external content — set "tool" to "news"|"sleep"|"tts" (only one).
- "store_memory": user clearly states durable preference/location/name worth saving from the latest user message.
- "wait": stop the loop — nothing useful to add (rare).
- "suggest": emit only a short optional follow-up hook (second person), not the main answer — use sparingly.

Rules:
- If loop_index is 1 and tool_output exists, prefer "respond".
- If loop_index is 1 and no tool_output, prefer "respond" or "wait".
- Do not pick "use_tool" twice in one request.
- Never choose paths that would recurse infinitely.

Output ONLY JSON: {"action":"respond|use_tool|store_memory|wait|suggest","tool":null|"news"|"sleep"|"tts","reason":"short"}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          loop_index: context.loopIndex,
          goal: context.goal,
          user_message: context.userMessage,
          short_term_memory: context.shortTerm,
          long_term_summary: context.longTerm,
          tool_output: context.toolOutput || null,
          used_tool: context.usedTool || null,
          last_reflection: context.lastReflection || null,
          hint: toolHint,
        }).slice(0, 12000),
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: 'respond', tool: null, reason: 'parse_fallback' };
  }

  const action = String(parsed.action || 'respond').toLowerCase();
  const allowed = new Set(['respond', 'use_tool', 'store_memory', 'wait', 'suggest']);
  const type = allowed.has(action) ? /** @type {AgentActionType} */ (action) : 'respond';

  let tool = parsed.tool != null ? String(parsed.tool).toLowerCase() : null;
  if (tool === 'null' || tool === '') tool = null;
  if (!['news', 'sleep', 'tts', null].includes(tool)) tool = null;

  if (type === 'use_tool' && !tool) tool = 'news';
  if (type !== 'use_tool') tool = null;
  if (context.usedTool && type === 'use_tool') {
    return { type: 'respond', tool: null, reason: 'tool_already_used' };
  }

  return { type, tool, reason: String(parsed.reason || '').slice(0, 200) || undefined };
}

/**
 * Lightweight reflection after each step (no extra model call).
 * @param {AgentDecision} decision
 * @param {{ ok?: boolean, error?: string, replyLen?: number, toolBytes?: number }} outcome
 */
function reflectOnAction(decision, outcome) {
  const useful =
    outcome.ok !== false &&
    !outcome.error &&
    (decision.type === 'store_memory' ||
      decision.type === 'wait' ||
      decision.type === 'suggest' ||
      (outcome.replyLen != null && outcome.replyLen > 8) ||
      (outcome.toolBytes != null && outcome.toolBytes > 20));

  const adjust = useful ? 'hold' : outcome.error ? 'simplify_next' : 'retry_lighter';

  return {
    useful,
    adjust,
    note: outcome.error ? String(outcome.error).slice(0, 120) : useful ? 'ok' : 'weak_outcome',
  };
}

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.fetchNews
 * @param {() => Promise<string>} deps.fetchSleepStory
 * @param {(text: string) => Promise<object>} deps.synthesizeWithElevenLabs
 * @param {(opts: object) => Promise<object>} deps.runCompanionReplyCore
 * @param {(uid: string, data: object) => object} deps.updateUserMemory
 * @param {(text: string) => object} deps.extractMemoryData
 * @param {(uid: string) => object} deps.getUserMemory
 * @param {(uid: string) => string} deps.buildServerMemorySummary
 * @param {(openai: any, model: string, text: string) => Promise<object>} deps.analyzeUserSignals
 * @param {(uid: string, s: object) => void} deps.recordCompanionSignals
 * @param {(s: object) => string[]} deps.mergeTopicHintsForRecord
 * @param {(mood: string) => string} deps.buildToneDirective
 */
async function runAgent(deps) {
  const {
    openai,
    model,
    userId,
    message,
    conversationHistory,
    rawLocation,
    fetchNews,
    fetchSleepStory,
    synthesizeWithElevenLabs,
    runCompanionReplyCore,
    updateUserMemory,
    extractMemoryData,
    getUserMemory,
    buildServerMemorySummary,
    analyzeUserSignals,
    recordCompanionSignals,
    mergeTopicHintsForRecord,
    buildToneDirective,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxLoops = MAX_LOOPS,
  } = deps;

  const deadline = Date.now() + timeoutMs;
  const trace = [];
  const reflections = [];

  let toolOutput = null;
  let usedTool = null;
  let finalReply = '';
  let audio = null;
  let companionMeta = null;
  let pendingSuggestion = null;
  let lastReflection = null;

  const shortTerm = formatShortTermMemory(conversationHistory);
  const mem0 = getUserMemory(userId);
  let longTerm = buildServerMemorySummary(mem0);

  let signals = null;
  try {
    const msLeft0 = deadline - Date.now();
    if (msLeft0 < 1500) throw new Error('agent_timeout');
    signals = await withDeadline(analyzeUserSignals(openai, model, message), msLeft0);
    recordCompanionSignals(userId, {
      mood: signals.mood,
      topicHints: mergeTopicHintsForRecord(signals),
    });
    longTerm = buildServerMemorySummary(getUserMemory(userId));
  } catch (e) {
    trace.push({ phase: 'analyze', error: e?.message || String(e) });
  }

  for (let loopIndex = 0; loopIndex < maxLoops; loopIndex++) {
    const msLeft = deadline - Date.now();
    if (msLeft < 2000) {
      trace.push({ loop: loopIndex, event: 'deadline' });
      break;
    }

    const context = {
      goal: AGENT_GOAL,
      loopIndex,
      userMessage: message,
      shortTerm,
      longTerm,
      toolOutput,
      usedTool,
      lastReflection,
    };

    let decision;
    try {
      decision = await withDeadline(decideNextAction(context, openai, model), msLeft);
    } catch (e) {
      trace.push({ loop: loopIndex, decision: 'error', error: e?.message || String(e) });
      break;
    }

    trace.push({ loop: loopIndex, decision });

    /** @type {{ ok?: boolean, error?: string, replyLen?: number, toolBytes?: number }} */
    let outcomeMeta = { ok: true };

    try {
      if (decision.type === 'wait') {
        outcomeMeta = { ok: true };
        reflections.push({ loop: loopIndex, decision, reflection: reflectOnAction(decision, outcomeMeta) });
        break;
      }

      if (decision.type === 'store_memory') {
        const upd = extractMemoryData(message);
        if (Object.keys(upd).length > 0) {
          updateUserMemory(userId, upd);
          longTerm = buildServerMemorySummary(getUserMemory(userId));
          outcomeMeta = { ok: true, replyLen: 0 };
        } else {
          outcomeMeta = { ok: false, error: 'nothing_to_store' };
        }
        reflections.push({ loop: loopIndex, decision, reflection: reflectOnAction(decision, outcomeMeta) });
        lastReflection = reflections[reflections.length - 1].reflection;
        continue;
      }

      if (decision.type === 'use_tool') {
        let text = '';
        if (decision.tool === 'news') text = await withDeadline(fetchNews(), msLeft);
        else if (decision.tool === 'sleep') text = await withDeadline(fetchSleepStory(), msLeft);
        else if (decision.tool === 'tts') {
          const base = String(toolOutput || message || '').trim() || message;
          audio = await withDeadline(synthesizeWithElevenLabs(base), msLeft);
          toolOutput = message;
          text = '[voice note ready for user]';
        } else {
          text = await withDeadline(fetchNews(), msLeft);
        }
        toolOutput = text;
        usedTool = decision.tool || 'news';
        outcomeMeta = { ok: true, toolBytes: String(text).length };
        reflections.push({ loop: loopIndex, decision, reflection: reflectOnAction(decision, outcomeMeta) });
        lastReflection = reflections[reflections.length - 1].reflection;
        continue;
      }

      if (decision.type === 'suggest') {
        const comp = await withDeadline(
          openai.chat.completions.create({
            model,
            temperature: 0.5,
            max_tokens: 64,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: `${AGENT_GOAL} Output JSON only: {"line":"<one short optional follow-up, max 14 words>"} Calm, human, not pushy.`,
              },
              {
                role: 'user',
                content: `user: ${message.slice(0, 800)}\nmood: ${signals?.mood || 'neutral'}`,
              },
            ],
          }),
          msLeft,
        );
        const raw = comp.choices?.[0]?.message?.content?.trim() || '{"line":""}';
        let line = '';
        try {
          line = JSON.parse(raw).line || '';
        } catch {
          line = '';
        }
        pendingSuggestion = String(line).replace(/^["']|["']$/g, '').trim().slice(0, 220);
        outcomeMeta = { ok: Boolean(pendingSuggestion), replyLen: pendingSuggestion?.length || 0 };
        reflections.push({ loop: loopIndex, decision, reflection: reflectOnAction(decision, outcomeMeta) });
        lastReflection = reflections[reflections.length - 1].reflection;
        continue;
      }

      /* respond */
      const augmentedMessage =
        toolOutput && loopIndex > 0
          ? `${message}\n\n[Internal: include or reference this prior result naturally in your reply — do not paste verbatim if long]\n${String(toolOutput).slice(0, 3500)}`
          : message;

      const r = await withDeadline(
        runCompanionReplyCore({
          userId,
          text: augmentedMessage,
          location: rawLocation,
          conversationHistory,
          companionContext: signals
            ? { mood: signals.mood, toneDirective: buildToneDirective(signals.mood) }
            : null,
        }),
        msLeft,
      );
      finalReply = r.reply;
      companionMeta = r;
      outcomeMeta = { ok: true, replyLen: finalReply.length };
      reflections.push({ loop: loopIndex, decision, reflection: reflectOnAction(decision, outcomeMeta) });
      lastReflection = reflections[reflections.length - 1].reflection;
      break;
    } catch (e) {
      outcomeMeta = { ok: false, error: e?.message || String(e) };
      reflections.push({ loop: loopIndex, decision, reflection: reflectOnAction(decision, outcomeMeta) });
      lastReflection = reflections[reflections.length - 1].reflection;
      trace.push({ loop: loopIndex, executeError: outcomeMeta.error });
      break;
    }
  }

  if (!finalReply) {
    finalReply =
      toolOutput && String(toolOutput).trim().length > 0
        ? String(toolOutput).trim()
        : 'ما قدرت أكمل الخطوة — جرّب تعيد صياغة السؤال؟';
  }

  return {
    goal: AGENT_GOAL,
    reply: finalReply,
    audio,
    memoryHint: companionMeta?.memoryHint ?? null,
    nearbySuggestions: companionMeta?.nearbySuggestions ?? [],
    nearbySource: companionMeta?.nearbySource ?? 'none',
    nextActionSuggestion: pendingSuggestion || undefined,
    profileSignals: signals,
    trace,
    reflections,
    loopsUsed: reflections.length,
  };
}

module.exports = {
  AGENT_GOAL,
  MAX_LOOPS,
  DEFAULT_TIMEOUT_MS,
  decideNextAction,
  reflectOnAction,
  runAgent,
  formatShortTermMemory,
};
