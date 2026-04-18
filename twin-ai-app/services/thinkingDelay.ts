/**
 * Simulates a short "thinking" pause before sending a reply.
 * Short / light messages → quick; longer or heavier messages → ~1–2s.
 */
function isDeepMessage(text: string): boolean {
  const t = text.trim();
  if (t.length >= 220) return true;
  if (t.split(/[.!?]+/).filter(Boolean).length >= 4) return true;
  if (
    /\b(why|how come|depressed|anxious|suicidal|suicide|self[- ]?harm|therapy|trauma|relationship|explain everything|meaning of life)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length >= 90 && /\?/.test(t)) return true;
  return false;
}

export function thinkingDelayMs(message: string): number {
  const t = String(message ?? '').trim();
  if (!t || t.length < 22) {
    return Math.round(60 + Math.random() * 140);
  }
  if (isDeepMessage(t)) {
    return Math.round(1000 + Math.random() * 1000);
  }
  return Math.round(180 + Math.random() * 320);
}

export function awaitThinkingDelay(message: string): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, thinkingDelayMs(message));
  });
}
