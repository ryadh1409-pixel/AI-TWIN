import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { getDb } from '@/lib/firebase';

export type DecisionListItem = {
  id: string;
  userInput: string;
  recommendation: string;
  confidence: number | null;
  actionPlan: string;
  followUpStatus: string;
  outcome: string | null;
  followUpMessage: string | null;
  lastReminderSentAtMs: number;
  createdAtMs: number;
};

function tsToMs(v: unknown): number {
  if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function listMyDecisions(userId: string, max = 30): Promise<DecisionListItem[]> {
  const db = getDb();
  if (!db || !userId.trim()) return [];
  try {
    const q = query(
      collection(db, 'decisions'),
      where('userId', '==', userId.trim()),
      orderBy('createdAt', 'desc'),
      limit(Math.min(50, max)),
    );
    const snap = await getDocs(q);
    const out: DecisionListItem[] = [];
    snap.forEach((doc) => {
      const d = doc.data();
      out.push({
        id: doc.id,
        userInput: String(d.userInput || '').slice(0, 500),
        recommendation: String(d.recommendation || '').slice(0, 400),
        confidence: typeof d.confidence === 'number' ? d.confidence : null,
        actionPlan: String(d.actionPlan || '').slice(0, 400),
        followUpStatus: typeof d.followUpStatus === 'string' ? d.followUpStatus : 'pending',
        outcome: typeof d.outcome === 'string' ? d.outcome : null,
        followUpMessage: typeof d.followUpMessage === 'string' ? d.followUpMessage : null,
        lastReminderSentAtMs: tsToMs(d.lastReminderSentAt),
        createdAtMs: tsToMs(d.createdAt),
      });
    });
    return out;
  } catch (e) {
    console.warn('[decisionsFirestore] listMyDecisions', e);
    return [];
  }
}
