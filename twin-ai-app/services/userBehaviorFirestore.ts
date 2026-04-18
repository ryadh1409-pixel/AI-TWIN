import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

import { getDb } from '@/lib/firebase';

export type BehaviorEventType =
  | 'message'
  | 'decision_made'
  | 'decision_completed'
  | 'session'
  | 'app_open'
  | 'usage_ping';

async function pushEvent(
  userId: string,
  eventType: BehaviorEventType,
  fields: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  if (!db || !userId.trim()) return;
  try {
    await addDoc(collection(db, 'user_behavior'), {
      userId: userId.trim(),
      eventType,
      ...fields,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[userBehavior]', eventType, e);
  }
}

export async function logBehaviorUserMessage(userId: string, messageText: string): Promise<void> {
  const text = String(messageText || '').trim().slice(0, 2000);
  if (!text) return;
  await pushEvent(userId, 'message', { messageText: text });
}

export async function logBehaviorDecisionMade(userId: string, decisionId: string, preview: string): Promise<void> {
  await pushEvent(userId, 'decision_made', {
    decisionId: String(decisionId || '').slice(0, 128),
    messageText: String(preview || '').slice(0, 500),
  });
}

export async function logBehaviorDecisionCompleted(
  userId: string,
  decisionId: string,
  executed: boolean,
): Promise<void> {
  await pushEvent(userId, 'decision_completed', {
    decisionId: String(decisionId || '').slice(0, 128),
    executed,
  });
}

export async function logBehaviorSession(userId: string, sessionDurationSec: number): Promise<void> {
  const sec = Math.min(Math.max(0, Math.floor(sessionDurationSec)), 24 * 3600);
  if (sec < 15) return;
  await pushEvent(userId, 'session', { sessionDurationSec: sec });
}

export async function logBehaviorAppOpen(userId: string): Promise<void> {
  await pushEvent(userId, 'app_open', {});
}

export async function logBehaviorUsagePing(userId: string): Promise<void> {
  await pushEvent(userId, 'usage_ping', {});
}
