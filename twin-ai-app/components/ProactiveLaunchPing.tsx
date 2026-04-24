import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRetention } from '@/contexts/RetentionContext';
import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { fetchCompanionInitiative } from '@/services/api';
import { shouldInitiate } from '@/services/companionInitiative';
import {
  loadUserProfile,
  markProactiveLineShownForSession,
  markSuggestionIgnored,
  proactiveLineShownForSession,
  shouldFetchInitiativeRequest,
} from '@/services/companionUserProfile';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const K_LAST_ACTIVITY = '@dt_last_activity_iso';
const K_LAST_INITIATIVE_FETCH = '@dt_last_initiative_fetch_iso';
const K_INITIATIVE_SESSION = '@dt_initiative_session_id';
const MIN_HOURS_BETWEEN_INITIATIVE_CHECKS = 10;

function timeOfDayLabel(d: Date) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

async function touchActivityStorage() {
  try {
    await AsyncStorage.setItem(K_LAST_ACTIVITY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

async function getOrCreateInitiativeSessionId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(K_INITIATIVE_SESSION);
    if (!id) {
      id = `ini_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(K_INITIATIVE_SESSION, id);
    }
    return id;
  } catch {
    return `ini_${Date.now()}`;
  }
}

/**
 * Subtle bottom “chat bubble” initiative (max one per initiative session; respects ignored flag).
 */
export function ProactiveLaunchPing() {
  const { user, loading } = useAuth();
  const { refresh: refreshRetention } = useRetention();
  const insets = useSafeAreaInsets();
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const ran = useRef(false);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void touchActivityStorage();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return () => {
      if (delayTimer.current) clearTimeout(delayTimer.current);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      try {
        const lastFetch = await AsyncStorage.getItem(K_LAST_INITIATIVE_FETCH);
        if (lastFetch) {
          const hours = (Date.now() - new Date(lastFetch).getTime()) / 3600000;
          if (hours < MIN_HOURS_BETWEEN_INITIATIVE_CHECKS) {
            await touchActivityStorage();
            return;
          }
        }

        const now = new Date();
        const userId = user?.uid ?? 'local-user';
        const proactiveSessionId = await getOrCreateInitiativeSessionId();

        let profileGate: Awaited<ReturnType<typeof loadUserProfile>> | null = null;
        let proactiveAlreadyShown = false;
        if (user?.uid && isFirebaseConfigured()) {
          profileGate = await loadUserProfile(user.uid);
          proactiveAlreadyShown = await proactiveLineShownForSession(proactiveSessionId);
          const gate = shouldFetchInitiativeRequest({
            profile: profileGate,
            proactiveAlreadyShownThisSession: proactiveAlreadyShown,
          });
          if (!gate.shouldFetchServer) {
            await touchActivityStorage();
            return;
          }
          const ini = shouldInitiate(profileGate, Date.now());
          if (!ini.ok) {
            await touchActivityStorage();
            return;
          }
        }

        const res = await fetchCompanionInitiative({
          userId,
          time: now.toISOString(),
          timeOfDay: timeOfDayLabel(now),
          proactiveSessionId,
          lastTopics: profileGate?.topics ?? [],
        });

        await AsyncStorage.setItem(K_LAST_INITIATIVE_FETCH, now.toISOString());
        await touchActivityStorage();

        if (!res.shouldInitiate || !res.message?.trim()) {
          return;
        }

        const wait = Math.min(120000, Math.max(0, Number(res.delayMs) || 0));
        delayTimer.current = setTimeout(() => {
          const line = res.message!.trim();
          setBubbleText(line);
          void markProactiveLineShownForSession(proactiveSessionId);
          if (user?.uid) {
            console.log('[companion-retention] suggestion_shown', { userId: user.uid });
          }
          delayTimer.current = null;
        }, wait);
      } catch (e) {
        console.warn('[ProactiveLaunchPing]', e);
      }
    })();
  }, [loading, user?.uid]);

  if (!bubbleText) return null;

  return (
    <View
      style={[
        styles.bubbleWrap,
        { bottom: Math.max(insets.bottom, 12) + 56 },
        { pointerEvents: 'box-none' },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Suggestion: ${bubbleText}`}>
      <View style={styles.bubble}>
        <Text style={styles.bubbleText}>{bubbleText}</Text>
        <Pressable
          onPress={() => {
            setBubbleText(null);
            if (user?.uid && isFirebaseConfigured()) {
              void markSuggestionIgnored(user.uid);
              void refreshRetention();
              console.log('[companion-retention] suggestion_ignored', { userId: user.uid });
            }
          }}
          hitSlop={10}
          accessibilityLabel="Dismiss suggestion"
          style={styles.dismiss}>
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 36,
    elevation: 3,
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: 'rgba(38, 44, 58, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bubbleText: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 20,
  },
  dismiss: {
    paddingTop: 2,
  },
  dismissText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '700',
  },
});
