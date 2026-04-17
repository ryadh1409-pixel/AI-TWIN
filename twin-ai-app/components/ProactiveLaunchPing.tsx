import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { sendProactiveContextCheck } from '@/services/api';
import { getForegroundCoords } from '@/services/location';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const K_LAST_ACTIVITY = '@dt_last_activity_iso';
const K_LAST_CLIENT_PROACTIVE = '@dt_last_proactive_ping_iso';
const MIN_CLIENT_HOURS = 8;

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

/**
 * On app open: POST /proactive (rate-limited). Shows X’s line as a chat-style bubble.
 */
export function ProactiveLaunchPing() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void touchActivityStorage();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      try {
        const lastPing = await AsyncStorage.getItem(K_LAST_CLIENT_PROACTIVE);
        if (lastPing) {
          const hours = (Date.now() - new Date(lastPing).getTime()) / 3600000;
          if (hours < MIN_CLIENT_HOURS) {
            await touchActivityStorage();
            return;
          }
        }

        const prevActivity = await AsyncStorage.getItem(K_LAST_ACTIVITY);
        const now = new Date();
        const location = await getForegroundCoords();
        const userId = user?.uid ?? 'local-user';

        const res = await sendProactiveContextCheck({
          userId,
          location,
          time: now.toISOString(),
          timeOfDay: timeOfDayLabel(now),
          lastActivity: prevActivity,
        });

        await AsyncStorage.setItem(K_LAST_CLIENT_PROACTIVE, now.toISOString());
        await touchActivityStorage();

        if (res.message && res.skip !== true) {
          setBubbleText(res.message);
        }
      } catch (e) {
        console.warn('[ProactiveLaunchPing]', e);
      }
    })();
  }, [loading, user?.uid]);

  if (!bubbleText) return null;

  return (
    <View
      style={[styles.float, { top: Math.max(insets.top, 8) + 2 }]}
      accessibilityRole="summary">
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>X</Text>
        </View>
        <View style={styles.bubbleCol}>
          <Text style={styles.nameTag}>X</Text>
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{bubbleText}</Text>
          </View>
        </View>
        <Pressable
          onPress={() => setBubbleText(null)}
          hitSlop={12}
          accessibilityLabel="Dismiss"
          style={styles.dismissHit}>
          <Text style={styles.dismiss}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  float: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 9999,
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1f4f8f',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  avatarText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  bubbleCol: {
    flex: 1,
    maxWidth: '82%',
  },
  nameTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#456',
    marginBottom: 4,
    marginLeft: 2,
  },
  bubble: {
    backgroundColor: '#e9effc',
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#d0dcee',
  },
  bubbleText: {
    fontSize: 15,
    color: '#1a1a1a',
    lineHeight: 21,
  },
  dismissHit: {
    padding: 6,
    alignSelf: 'flex-start',
  },
  dismiss: {
    fontSize: 16,
    color: '#666',
    fontWeight: '600',
  },
});
