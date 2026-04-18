import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { getDb, getFirebaseAuth } from '@/lib/firebase';

export type ConversationTurn = {
  message: string;
  response: string;
};

function currentUid(): string | null {
  return getFirebaseAuth()?.currentUser?.uid ?? null;
}

/**
 * Persist one user message + AI reply to `conversations` (requires signed-in user).
 */
export async function saveMessage(
  userId: string,
  message: string,
  response: string,
): Promise<void> {
  const uid = currentUid();
  const db = getDb();
  if (!db || !uid || uid !== userId) return;

  const trimmedUser = String(message ?? '').trim();
  const trimmedAi = String(response ?? '').trim();
  if (!trimmedUser || !trimmedAi) return;

  try {
    await addDoc(collection(db, 'conversations'), {
      userId,
      message: trimmedUser,
      response: trimmedAi,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[conversationMemory] saveMessage:', e);
  }
}

/**
 * Last `count` exchanges for `userId`, oldest first (for model context).
 */
export async function getRecentMessages(
  userId: string,
  count = 5,
): Promise<ConversationTurn[]> {
  const uid = currentUid();
  const db = getDb();
  if (!db || !uid || uid !== userId) return [];

  try {
    const q = query(
      collection(db, 'conversations'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(count),
    );

    const snap = await getDocs(q);
    const rows: ConversationTurn[] = [];
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      rows.push({
        message: String(data.message ?? ''),
        response: String(data.response ?? ''),
      });
    });
    return rows.filter((r) => r.message && r.response).reverse();
  } catch (e) {
    console.warn('[conversationMemory] getRecentMessages:', e);
    return [];
  }
}
