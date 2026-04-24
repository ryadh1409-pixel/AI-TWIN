import { useRetention } from '@/contexts/RetentionContext';
import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Small streak line at top (see {@link RetentionProvider}). */
export function RetentionProgressBanner() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { streakLabel, profile } = useRetention();

  if (!user || !isFirebaseConfigured() || !streakLabel || !profile) return null;

  const topics = profile.topics?.length ?? 0;

  return (
    <View
      style={[styles.wrap, { top: Math.max(insets.top, 8) + 2 }, { pointerEvents: 'none' }]}
      accessibilityRole="text">
      <Text style={styles.text}>
        {streakLabel}
        {topics > 0 ? ` · ${topics} topic${topics === 1 ? '' : 's'}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 30,
    elevation: 2,
    alignItems: 'center',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(20,24,32,0.52)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
