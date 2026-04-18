export type BuildContextInput = {
  userMessage?: string;
  memory?: any;
  time: number;
};

export type BuiltAgentContext = {
  mood: string;
  timeOfDay: string;
  lastTopics: string[];
};

function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Lightweight mood hint from the latest user line (not clinical). */
export function inferMood(userMessage?: string): string {
  const text = String(userMessage ?? "")
    .toLowerCase()
    .trim();
  if (!text) return "neutral";

  if (
    /\b(stressed|anxious|worried|overwhelmed|panic|can't cope|exhausted)\b/.test(text)
  ) {
    return "stressed";
  }
  if (/\b(tired|sleepy|exhausted|burnt out|burned out|insomnia)\b/.test(text)) {
    return "tired";
  }
  if (
    /\b(sad|depressed|lonely|down|blue|cry|crying|miss you|hurts)\b/.test(text)
  ) {
    return "low";
  }
  if (
    /\b(happy|great|awesome|love it|excited|yay|lol|haha|thanks so much)\b/.test(text)
  ) {
    return "upbeat";
  }
  if (/\b(angry|mad|furious|annoyed|frustrated|hate)\b/.test(text)) {
    return "frustrated";
  }
  return "neutral";
}

/** Local clock bucket for the given epoch ms. */
export function getTimeOfDay(time: number): string {
  const t = Number.isFinite(time) && time > 0 ? time : Date.now();
  const hour = new Date(t).getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function buildContext({
  userMessage,
  memory,
  time,
}: BuildContextInput): BuiltAgentContext {
  const clock =
    Number.isFinite(time) && time > 0 ? time : Date.now();
  return {
    mood: inferMood(userMessage),
    timeOfDay: getTimeOfDay(clock),
    lastTopics: normalizeTopics(memory?.topics),
  };
}

