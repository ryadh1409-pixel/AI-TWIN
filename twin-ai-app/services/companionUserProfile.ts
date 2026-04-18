import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import { getDb, getFirebaseAuth } from '@/lib/firebase';

export const USER_PROFILE_COLLECTION = 'user_profile';

/** Companion-facing slice of `user_profile` (merged with server learning fields). */
export type CompanionUserProfileState = {
  userId: string;
  lastActiveAtMs: number;
  streakDays: number;
  topics: string[];
  lastSuggestionShownMs: number | null;
  ignoredLastSuggestion: boolean;
  lastStreakOpenDay: string | null;
  lastSuggestionText: string;
};

function currentUid(): string | null {
  return getFirebaseAuth()?.currentUser?.uid ?? null;
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tsToMs(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as Timestamp).toMillis === 'function') {
    return (v as Timestamp).toMillis();
  }
  return 0;
}

function defaultState(uid: string): CompanionUserProfileState {
  return {
    userId: uid,
    lastActiveAtMs: Date.now(),
    streakDays: 1,
    topics: [],
    lastSuggestionShownMs: null,
    ignoredLastSuggestion: false,
    lastStreakOpenDay: null,
    lastSuggestionText: '',
  };
}

export function normalizeUserProfileDoc(
  userId: string,
  data: Record<string, unknown> | undefined,
): CompanionUserProfileState {
  const d = defaultState(userId);
  if (!data) return d;

  d.lastActiveAtMs = tsToMs(data.lastActiveAt) || d.lastActiveAtMs;
  const sd = data.streakDays;
  d.streakDays =
    typeof sd === 'number' && Number.isFinite(sd) && sd >= 1 ? Math.min(9999, Math.floor(sd)) : 1;
  const topics = data.topics;
  d.topics = Array.isArray(topics)
    ? topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 24)
    : [];
  d.lastSuggestionShownMs = tsToMs(data.lastSuggestionShown) || null;
  d.ignoredLastSuggestion =
    data.ignoredLastSuggestion === true || data.skipInitiativeUntilNextChat === true;
  const ld = data.lastStreakOpenDay;
  d.lastStreakOpenDay =
    typeof ld === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ld) ? ld : d.lastStreakOpenDay;
  d.lastSuggestionText =
    typeof data.lastSuggestionText === 'string' ? data.lastSuggestionText.slice(0, 400) : '';

  return d;
}

export async function loadUserProfile(userId: string): Promise<CompanionUserProfileState> {
  const uid = currentUid();
  const db = getDb();
  if (!db || !uid || uid !== userId) return defaultState(userId);
  try {
    const ref = doc(db, USER_PROFILE_COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return defaultState(userId);
    return normalizeUserProfileDoc(userId, snap.data() as Record<string, unknown>);
  } catch (e) {
    console.warn('[companionUserProfile] loadUserProfile:', e);
    return defaultState(userId);
  }
}

export async function saveUserProfilePatch(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const uid = currentUid();
  const db = getDb();
  if (!db || !uid || uid !== userId) return;
  try {
    await setDoc(
      doc(db, USER_PROFILE_COLLECTION, userId),
      {
        userId,
        ...patch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn('[companionUserProfile] saveUserProfilePatch:', e);
  }
}

const MS_24 = 24 * 60 * 60 * 1000;

/**
 * App open: return within 24h → increment streak (at most once per calendar day); else reset.
 * Returns profile + display label `Day X streak`.
 */
export async function updateStreakOnAppOpen(
  userId: string,
): Promise<{ profile: CompanionUserProfileState; streakLabel: string }> {
  const prev = await loadUserProfile(userId);
  const today = localYmd(new Date());
  const lastMs = prev.lastActiveAtMs || 0;
  const gap = Date.now() - lastMs;
  let streak = Math.max(1, prev.streakDays || 1);
  let lastStreakOpenDay = prev.lastStreakOpenDay;

  const firstEver = !lastMs || lastMs <= 0;
  if (firstEver) {
    streak = 1;
    lastStreakOpenDay = today;
  } else if (gap > MS_24) {
    streak = 1;
    lastStreakOpenDay = today;
  } else if (prev.lastStreakOpenDay !== today) {
    streak = Math.min(9999, streak + 1);
    lastStreakOpenDay = today;
  }

  await saveUserProfilePatch(userId, {
    lastActiveAt: serverTimestamp(),
    streakDays: streak,
    lastStreakOpenDay,
  });
  const profile = await loadUserProfile(userId);
  const label = `Day ${Math.max(1, profile.streakDays)} streak`;
  return { profile, streakLabel: label };
}

/** Snapshot for prompts (plan-and-run body). */
export async function loadUserProfileForPrompt(userId: string | null): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  const p = await loadUserProfile(userId);
  const db = getDb();
  const uid = currentUid();
  let decisionLearning: unknown = null;
  let behaviorInsightFeedback: unknown = null;
  if (db && uid === userId) {
    try {
      const ref = doc(db, USER_PROFILE_COLLECTION, userId);
      const snap = await getDoc(ref);
      const raw = snap.data();
      const dl = raw?.decisionLearning;
      if (dl && typeof dl === 'object') decisionLearning = dl;
      const bif = raw?.behaviorInsightFeedback;
      if (bif && typeof bif === 'object') behaviorInsightFeedback = bif;
    } catch {
      /* ignore */
    }
  }
  return {
    streakDays: p.streakDays,
    topics: p.topics,
    lastActiveAt: p.lastActiveAtMs,
    ignoredLastSuggestion: p.ignoredLastSuggestion,
    lastSuggestionText: p.lastSuggestionText,
    ...(decisionLearning ? { decisionLearning } : {}),
    ...(behaviorInsightFeedback ? { behaviorInsightFeedback } : {}),
  };
}

/**
 * After each user message: touch activity, merge AI topics, clear "ignored" when they engage.
 */
export async function updateUserProfile(
  userId: string,
  message: string,
  extractedTopics: string[],
): Promise<void> {
  const prev = await loadUserProfile(userId);
  const merged = new Set(prev.topics.map((t) => t.toLowerCase()));
  const add: string[] = [];
  for (const t of extractedTopics.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)) {
    if (merged.size >= 24) break;
    const k = t.toLowerCase();
    if (!merged.has(k)) {
      merged.add(k);
      add.push(t.slice(0, 48));
    }
  }
  const topics = [...prev.topics, ...add].slice(-24);

  await saveUserProfilePatch(userId, {
    lastActiveAt: serverTimestamp(),
    topics,
    ignoredLastSuggestion: false,
  });
  console.log('[companion-retention] user_interaction_after_suggestion', {
    userId,
    messageLen: message.length,
    topicsAdded: add.length,
  });
}

export async function markSuggestionIgnored(userId: string): Promise<void> {
  await saveUserProfilePatch(userId, {
    ignoredLastSuggestion: true,
  });
  console.log('[companion-retention] suggestion_ignored', { userId });
}

export async function markSuggestionShown(userId: string, text: string): Promise<void> {
  await saveUserProfilePatch(userId, {
    lastSuggestionShown: serverTimestamp(),
    lastSuggestionText: String(text).slice(0, 400),
  });
  console.log('[companion-retention] suggestion_shown', { userId, len: text.length });
}

/** @deprecated Use markSuggestionIgnored — kept for ProactiveLaunchPing import stability */
export async function markInitiativeDismissedWithoutChat(userId: string): Promise<void> {
  await markSuggestionIgnored(userId);
}

/** Session cap: max one proactive line per initiative session id */
const K_INI_SHOWN = '@dt_ini_line_shown_';

export async function proactiveLineShownForSession(sessionId: string): Promise<boolean> {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  try {
    return (await AsyncStorage.getItem(K_INI_SHOWN + sid)) === '1';
  } catch {
    return false;
  }
}

export async function markProactiveLineShownForSession(sessionId: string): Promise<void> {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    await AsyncStorage.setItem(K_INI_SHOWN + sid, '1');
  } catch {
    /* ignore */
  }
}

export type InitiativeClientGate = {
  shouldFetchServer: boolean;
  reason?: string;
};

export function shouldFetchInitiativeRequest(input: {
  profile: CompanionUserProfileState;
  proactiveAlreadyShownThisSession: boolean;
}): InitiativeClientGate {
  if (input.proactiveAlreadyShownThisSession) {
    return { shouldFetchServer: false, reason: 'session_proactive_cap' };
  }
  if (input.profile.ignoredLastSuggestion) {
    return { shouldFetchServer: false, reason: 'ignored_last_suggestion' };
  }
  return { shouldFetchServer: true };
}
