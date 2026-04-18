import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { saveExpoPushToken } from '@/services/userFirestore';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Request notification permission on sign-in and store Expo push token in Firestore `users/{uid}`.
 */
export function DecisionPushRegistration() {
  const { user } = useAuth();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const uid = user?.uid;
    if (!uid || !isFirebaseConfigured()) return;

    void (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;

        const projectId =
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
            ?.projectId ??
          (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId ??
          Constants.expoConfig?.projectId;

        const tokenRes = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId: String(projectId) } : undefined,
        );
        const tok = tokenRes.data?.trim();
        if (tok) await saveExpoPushToken(uid, tok);
      } catch (e) {
        console.warn('[DecisionPushRegistration]', e);
      }
    })();
  }, [user?.uid]);

  return null;
}
