import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';

import type { Character } from '@/services/userFirestore';
import { getDb } from '@/lib/firebase';

export type MomDadMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: Date;
};

export type FamilyAssistantMessage = {
  id: string;
  role: 'assistant';
  mom: string;
  dad: string;
  maher: string;
  mjeed: string;
  createdAt?: Date;
};

export type FamilyMessage = MomDadMessage | FamilyAssistantMessage;

function asDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Timestamp) return v.toDate();
  if (
    typeof v === 'object' &&
    v !== null &&
    'toDate' in v &&
    typeof (v as Timestamp).toDate === 'function'
  ) {
    return (v as Timestamp).toDate();
  }
  return undefined;
}

function collectionName(c: Character) {
  if (c === 'mom') return 'momMessages';
  if (c === 'dad') return 'dadMessages';
  if (c === 'maher') return 'maherMessages';
  if (c === 'mjeed') return 'mjeedMessages';
  return 'familyMessages';
}

export function subscribeMessages(
  uid: string,
  character: Character,
  onMessages: (items: (MomDadMessage | FamilyMessage)[]) => void,
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onMessages([]);
    return () => {};
  }
  const col = collection(db, 'users', uid, collectionName(character));
  const q = query(col, orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snap) => {
    const items: (MomDadMessage | FamilyMessage)[] = [];
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const createdAt = asDate(data.createdAt);
      if (character === 'family' && data.role === 'assistant') {
        items.push({
          id: d.id,
          role: 'assistant',
          mom: String(data.mom ?? ''),
          dad: String(data.dad ?? ''),
          maher: String(data.maher ?? ''),
          mjeed: String(data.mjeed ?? ''),
          createdAt,
        });
      } else {
        items.push({
          id: d.id,
          role: data.role === 'user' ? 'user' : 'assistant',
          content: String(data.content ?? ''),
          createdAt,
        });
      }
    });
    onMessages(items.reverse());
  });
}
