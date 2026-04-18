import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { logBehaviorSession } from '@/services/userBehaviorFirestore';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

/**
 * Logs approximate foreground session length to `user_behavior` when app backgrounds.
 */
export function BehaviorSessionTracker() {
  const { user } = useAuth();
  const activeSince = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const uid = user?.uid;
    if (!uid || !isFirebaseConfigured()) return;

    const onChange = (next: AppStateStatus) => {
      if (next === 'active') {
        activeSince.current = Date.now();
        return;
      }
      if (next === 'background' || next === 'inactive') {
        const start = activeSince.current;
        activeSince.current = null;
        if (!start) return;
        const sec = Math.round((Date.now() - start) / 1000);
        void logBehaviorSession(uid, sec);
      }
    };

    if (AppState.currentState === 'active') {
      activeSince.current = Date.now();
    }

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user?.uid]);

  return null;
}
