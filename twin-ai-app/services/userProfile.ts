import { doc, getDoc } from 'firebase/firestore';

import { getDb, getFirebaseAuth } from '@/lib/firebase';

export type UserProfileTopic = { topic: string; count: number };

export type UserProfileDoc = {
  userId: string;
  preferences?: string[];
  common_topics?: UserProfileTopic[];
  mood_patterns?: Record<string, number>;
  usage_times?: { buckets?: Record<string, number>; last_seen?: string };
  last_intent?: string;
  learning_confidence_last?: number;
};

/**
 * Read adaptive `user_profile/{userId}` (same user must be signed in).
 */
export async function getUserProfile(userId: string): Promise<UserProfileDoc | null> {
  const uid = getFirebaseAuth()?.currentUser?.uid;
  const db = getDb();
  if (!db || !uid || uid !== userId.trim()) return null;

  const ref = doc(db, 'user_profile', userId.trim());
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as UserProfileDoc;
}
