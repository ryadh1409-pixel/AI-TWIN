import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { getDb, getFirebaseAuth } from '@/lib/firebase';

const COLLECTION = 'agent_core_memory';

export type AgentInteraction = {
  role: 'user' | 'assistant';
  content: string;
  at: number;
};

function currentUid(): string | null {
  return getFirebaseAuth()?.currentUser?.uid ?? null;
}

/**
 * Load prior agent interactions and timestamps for `userId`.
 * Returns a plain object suitable for {@link Context.memory} in `agentCore`.
 */
export async function loadMemory(userId: string): Promise<any> {
  const uid = currentUid();
  const db = getDb();
  if (!db || !uid || uid !== userId) {
    return {
      interactions: [] as AgentInteraction[],
      lastInteractionAt: Date.now(),
    };
  }

  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return {
        interactions: [] as AgentInteraction[],
        lastInteractionAt: Date.now(),
      };
    }
    const data = snap.data() as Record<string, unknown>;
    const raw = data.interactions;
    const interactions: AgentInteraction[] = Array.isArray(raw)
      ? raw
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const r = row as Record<string, unknown>;
            const role = r.role === 'assistant' ? 'assistant' : 'user';
            const content = String(r.content ?? '');
            const at =
              typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : Date.now();
            if (!content.trim()) return null;
            return { role, content: content.slice(0, 8000), at };
          })
          .filter((x): x is AgentInteraction => x != null)
      : [];

    const last =
      typeof data.lastInteractionAt === 'number' && Number.isFinite(data.lastInteractionAt)
        ? data.lastInteractionAt
        : interactions.length
          ? interactions[interactions.length - 1].at
          : Date.now();

    const extras =
      data.extras && typeof data.extras === 'object' && !Array.isArray(data.extras)
        ? (data.extras as Record<string, unknown>)
        : {};

    return {
      interactions,
      lastInteractionAt: last,
      extras,
    };
  } catch (e) {
    console.warn('[memory] loadMemory:', e);
    return {
      interactions: [] as AgentInteraction[],
      lastInteractionAt: Date.now(),
    };
  }
}

/**
 * Persist merged agent memory to Firestore (`agent_core_memory/{userId}`).
 * Pass `appendInteractions` to append turns without replacing the full history.
 */
export async function saveMemory(userId: string, data: any): Promise<void> {
  const uid = currentUid();
  const db = getDb();
  if (!db || !uid || uid !== userId) return;

  const ref = doc(db, COLLECTION, userId);
  const appendRaw = data?.appendInteractions;
  const strip = { ...data };
  delete strip.appendInteractions;

  try {
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
    let interactions: AgentInteraction[] = Array.isArray(prev.interactions)
      ? (prev.interactions as AgentInteraction[]).filter(
          (x) => x && typeof x.content === 'string' && x.content.trim(),
        )
      : [];

    if (Array.isArray(appendRaw)) {
      for (const row of appendRaw) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const role = r.role === 'assistant' ? 'assistant' : 'user';
        const content = String(r.content ?? '').trim();
        if (!content) continue;
        const at =
          typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : Date.now();
        interactions.push({
          role,
          content: content.slice(0, 8000),
          at,
        });
      }
      interactions = interactions.slice(-200);
    }

    const lastInteractionAt =
      typeof strip.lastInteractionAt === 'number' && Number.isFinite(strip.lastInteractionAt)
        ? strip.lastInteractionAt
        : interactions.length
          ? interactions[interactions.length - 1].at
          : typeof prev.lastInteractionAt === 'number'
            ? prev.lastInteractionAt
            : Date.now();

    const prevExtras =
      prev.extras && typeof prev.extras === 'object' && !Array.isArray(prev.extras)
        ? (prev.extras as Record<string, unknown>)
        : {};
    const nextExtras =
      strip.extras && typeof strip.extras === 'object' && !Array.isArray(strip.extras)
        ? { ...prevExtras, ...(strip.extras as Record<string, unknown>) }
        : prevExtras;

    const { extras: _e, lastInteractionAt: _l, interactions: _i, ...restStrip } = strip;

    await setDoc(
      ref,
      {
        ...restStrip,
        interactions,
        lastInteractionAt,
        extras: nextExtras,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn('[memory] saveMemory:', e);
  }
}
