import type { Action, Context } from '@/services/agentCore';
import { decideNextAction } from '@/services/agentCore';
import { AGENT_CORE_GENERATE_URL } from '@/services/api';
import { generateSuggestion } from '@/services/companionSuggestions';
import { buildContext } from '@/services/contextBuilder';
import { loadMemory, saveMemory } from '@/services/memory';
import { personality } from '@/services/personality';
import { awaitThinkingDelay } from '@/services/thinkingDelay';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} as const;

const DEFAULT_MAX_LOOPS = 2;
const DEFAULT_TIMEOUT_MS = 28_000;
const MAX_TIMEOUT_CAP_MS = 60_000;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.reject(new Error('agent_timeout'));
  }
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('agent_timeout')), ms),
    ),
  ]);
}

async function callOpenAI(
  kind: 'respond' | 'suggest',
  userMessage: string | undefined,
  memory: any,
  deadlineMs: number,
  companion: {
    personality: typeof personality;
    context: { mood: string; timeOfDay: string; lastTopics: string[] };
  },
): Promise<string> {
  const ms = Math.max(800, deadlineMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(AGENT_CORE_GENERATE_URL, {
      method: 'POST',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({
        kind,
        userMessage: userMessage ?? '',
        memory: memory ?? {},
        personality: companion.personality,
        context: {
          mood: companion.context.mood,
          timeOfDay: companion.context.timeOfDay,
          lastTopics: companion.context.lastTopics,
        },
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(raw) as { error?: string };
        if (typeof j.error === 'string' && j.error) msg = j.error;
      } catch {
        if (raw) msg = raw.slice(0, 200);
      }
      throw new Error(msg);
    }
    const data = JSON.parse(raw) as { reply?: string };
    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    if (!reply) throw new Error('Empty model reply.');
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

export type RunAgentInput = {
  userId: string;
  userMessage?: string;
  /** Hard cap 2 — prevents infinite loops. */
  maxLoops?: number;
  /** Wall-clock budget for load + decide + network + save (capped at 60s). */
  timeoutMs?: number;
};

export type RunAgentOutput = {
  lastAction: Action;
  reply?: string;
  suggestion?: string;
  loopsUsed: number;
  timedOut?: boolean;
  error?: string;
};

/**
 * 1) load memory → 2) build context → 3) decideNextAction → 4) execute (OpenAI for respond/suggest)
 * → 5) save results → 6) stop after at most {@link RunAgentInput.maxLoops} iterations.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const maxLoops = Math.min(Math.max(1, input.maxLoops ?? DEFAULT_MAX_LOOPS), DEFAULT_MAX_LOOPS);
  const timeoutMs = Math.min(
    Math.max(2000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_CAP_MS,
  );
  const runDeadline = Date.now() + timeoutMs;

  let pendingUserMessage = input.userMessage?.trim() || undefined;
  let lastAction: Action = { type: 'wait' };
  let loopsUsed = 0;
  let reply: string | undefined;
  let suggestion: string | undefined;
  let timedOut = false;
  let error: string | undefined;

  for (let i = 0; i < maxLoops; i++) {
    const msLeft = runDeadline - Date.now();
    if (msLeft < 400) {
      timedOut = true;
      break;
    }

    loopsUsed = i + 1;
    let memory: any;
    try {
      memory = await withDeadline(loadMemory(input.userId), Math.max(200, msLeft - 100));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      error = m;
      if (m === 'agent_timeout') timedOut = true;
      break;
    }

    const lastT =
      typeof memory?.lastInteractionAt === 'number' && Number.isFinite(memory.lastInteractionAt)
        ? memory.lastInteractionAt
        : Date.now();

    const context: Context = {
      userMessage: pendingUserMessage,
      memory,
      time: lastT,
    };

    const action = decideNextAction(context);
    lastAction = action;

    if (action.type === 'wait') {
      break;
    }

    if (action.type === 'store_memory') {
      await withDeadline(
        saveMemory(input.userId, { extras: action.data, lastInteractionAt: Date.now() }),
        runDeadline - Date.now() - 50,
      ).catch(() => {});
      continue;
    }

    if (action.type === 'respond') {
      const msg = pendingUserMessage;
      if (!msg) {
        error = 'respond_without_user_message';
        break;
      }
      try {
        const companionCtx = buildContext({
          userMessage: msg,
          memory,
          time: Date.now(),
        });
        await withDeadline(awaitThinkingDelay(msg), runDeadline - Date.now() - 400).catch(
          () => {},
        );
        const text = await withDeadline(
          callOpenAI('respond', msg, memory, runDeadline - Date.now() - 200, {
            personality,
            context: companionCtx,
          }),
          runDeadline - Date.now() - 150,
        );
        reply = text;
        await withDeadline(
          saveMemory(input.userId, {
            appendInteractions: [
              { role: 'user' as const, content: msg, at: Date.now() },
              { role: 'assistant' as const, content: text, at: Date.now() },
            ],
            lastInteractionAt: Date.now(),
          }),
          runDeadline - Date.now() - 50,
        ).catch(() => {});
        pendingUserMessage = undefined;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        error = m;
        if (m === 'agent_timeout') timedOut = true;
      }
      break;
    }

    if (action.type === 'suggest') {
      try {
        const companionCtx = buildContext({
          userMessage: pendingUserMessage,
          memory,
          time: Date.now(),
        });
        const text = await withDeadline(
          generateSuggestion({
            ...companionCtx,
            topics: companionCtx.lastTopics,
            userId: input.userId,
          }),
          runDeadline - Date.now() - 150,
        );
        suggestion = text;
        await withDeadline(
          saveMemory(input.userId, {
            lastInteractionAt: Date.now(),
            extras: { lastSuggestionGeneratedAt: Date.now() },
          }),
          runDeadline - Date.now() - 50,
        ).catch(() => {});
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        error = m;
        if (m === 'agent_timeout') timedOut = true;
      }
      break;
    }
  }

  return {
    lastAction,
    reply,
    suggestion,
    loopsUsed,
    timedOut: timedOut || undefined,
    error,
  };
}
