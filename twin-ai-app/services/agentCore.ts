export type Context = {
  userMessage?: string;
  memory: any;
  time: number;
};

export type Action =
  | { type: "respond"; content: string }
  | { type: "suggest"; content: string }
  | { type: "store_memory"; data: any }
  | { type: "wait" };

export function decideNextAction(context: Context): Action {
  // RULES:

  // 1. If user sent message → respond
  if (context.userMessage) {
    return { type: "respond", content: "AI will generate response" };
  }

  // 2. If no interaction for a while → suggest
  const now = Date.now();
  if (now - context.time > 1000 * 60 * 30) {
    return { type: "suggest", content: "Check-in message" };
  }

  // 3. Otherwise → wait
  return { type: "wait" };
}
