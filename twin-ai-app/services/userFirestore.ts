import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';

import { getDb } from '@/lib/firebase';

export type UserProfile = {
  name: string;
  age: string;
  goals: string;
};

export type UserMemory = {
  mood: string;
  preferences: string;
  importantFacts: string;
  emotionalState: string;
  behaviorPatterns: string;
};

export type Character = 'mom' | 'dad' | 'maher' | 'mjeed' | 'family';
export type NotifyCharacter = Exclude<Character, 'family'>;

export type NotificationPrefs = {
  enabled: boolean;
  hour: number;
  minute: number;
  characters: Record<NotifyCharacter, boolean>;
};

const emptyProfile: UserProfile = {
  name: '',
  age: '',
  goals: '',
};

const emptyMemory: UserMemory = {
  mood: '',
  preferences: '',
  importantFacts: '',
  emotionalState: '',
  behaviorPatterns: '',
};

const defaultNotificationPrefs: NotificationPrefs = {
  enabled: false,
  hour: 17,
  minute: 0,
  characters: {
    mom: true,
    dad: true,
    maher: true,
    mjeed: true,
  },
};

export function subscribeUserDoc(
  uid: string,
  onData: (data: { profile: UserProfile; memory: UserMemory }) => void,
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onData({ profile: emptyProfile, memory: emptyMemory });
    return () => {};
  }
  const ref = doc(db, 'users', uid);
  return onSnapshot(ref, (snap) => {
    const d = snap.data() as
      | { profile?: Partial<UserProfile>; memory?: Partial<UserMemory> }
      | undefined;
    onData({
      profile: { ...emptyProfile, ...d?.profile },
      memory: { ...emptyMemory, ...d?.memory },
    });
  });
}

export async function saveUserProfileMemory(
  uid: string,
  profile: UserProfile,
  memory: UserMemory,
) {
  const db = getDb();
  if (!db) throw new Error('Firebase is not configured.');
  await setDoc(
    doc(db, 'users', uid),
    {
      profile,
      memory,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function saveUserNotificationPrefs(
  uid: string,
  prefs: NotificationPrefs,
) {
  const db = getDb();
  if (!db) throw new Error('Firebase is not configured.');
  await setDoc(
    doc(db, 'users', uid),
    {
      notificationPrefs: prefs,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** Persist Expo push token for Cloud Functions → Expo Push API (`sendReminderNotification`). */
export async function saveExpoPushToken(uid: string, expoPushToken: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const tok = String(expoPushToken || '').trim().slice(0, 512);
  if (!tok) return;
  await setDoc(
    doc(db, 'users', uid),
    {
      expoPushToken: tok,
      expoPushTokenUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function loadUserNotificationPrefs(
  uid: string,
): Promise<NotificationPrefs | null> {
  const db = getDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.data() as
    | {
        notificationPrefs?: Partial<NotificationPrefs> & {
          characters?: Partial<Record<NotifyCharacter, boolean>>;
        };
      }
    | undefined;
  const p = data?.notificationPrefs;
  if (!p) return null;
  return {
    enabled: Boolean(p.enabled),
    hour:
      typeof p.hour === 'number' && p.hour >= 0 && p.hour < 24
        ? p.hour
        : defaultNotificationPrefs.hour,
    minute:
      typeof p.minute === 'number' && p.minute >= 0 && p.minute < 60
        ? p.minute
        : defaultNotificationPrefs.minute,
    characters: {
      ...defaultNotificationPrefs.characters,
      ...p.characters,
    },
  };
}
