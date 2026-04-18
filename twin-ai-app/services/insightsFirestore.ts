import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { getDb } from '@/lib/firebase';

export type UserInsightDoc = {
  id: string;
  markdown: string;
  patternSummary: string;
  helpful: boolean | null;
  createdAtMs: number;
};

function tsToMs(v: unknown): number {
  if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function listUserInsights(userId: string, max = 20): Promise<UserInsightDoc[]> {
  const db = getDb();
  if (!db || !userId.trim()) return [];
  try {
    const q = query(
      collection(db, 'user_insights'),
      where('userId', '==', userId.trim()),
      orderBy('createdAt', 'desc'),
      limit(Math.min(40, max)),
    );
    const snap = await getDocs(q);
    const out: UserInsightDoc[] = [];
    snap.forEach((doc) => {
      const d = doc.data();
      out.push({
        id: doc.id,
        markdown: String(d.markdown || ''),
        patternSummary: String(d.patternSummary || '').slice(0, 400),
        helpful: typeof d.helpful === 'boolean' ? d.helpful : null,
        createdAtMs: tsToMs(d.createdAt),
      });
    });
    return out;
  } catch (e) {
    console.warn('[insightsFirestore] listUserInsights', e);
    return [];
  }
}
