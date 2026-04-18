import { COMPANION_SMART_SUGGEST_URL } from '@/services/api';
import type { BuiltAgentContext } from '@/services/contextBuilder';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} as const;

export type SuggestionContext = BuiltAgentContext & {
  topics?: string[];
  /** When set, server avoids repeating last stored suggestion text. */
  userId?: string;
};

/**
 * OpenAI-backed companion hint (topics, time of day, mood). Short, non-repetitive.
 */
export async function generateSuggestion(context: SuggestionContext): Promise<string> {
  const res = await fetch(COMPANION_SMART_SUGGEST_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({
      userId: context.userId,
      topics: (context.lastTopics?.length ? context.lastTopics : context.topics) ?? [],
      timeOfDay: context.timeOfDay,
      mood: context.mood,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`);
  }
  const data = JSON.parse(raw) as { line?: string };
  const line = typeof data.line === 'string' ? data.line.trim() : '';
  if (!line) throw new Error('Empty suggestion.');
  return line;
}
