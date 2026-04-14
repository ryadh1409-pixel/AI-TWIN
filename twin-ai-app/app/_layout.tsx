import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { useAuth } from '@/contexts/AuthContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  applyDailyCheckInSchedule,
  fromNotificationPrefs,
  loadDailyCheckInSettings,
  saveDailyCheckInSettings,
} from '@/services/dailyNotifications';
import { isFirebaseConfigured } from '@/lib/firebase';
import { loadUserNotificationPrefs } from '@/services/userFirestore';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function RescheduleDailyNotifications() {
  const { user } = useAuth();

  useEffect(() => {
    void (async () => {
      const local = await loadDailyCheckInSettings();
      await applyDailyCheckInSchedule(local);
      if (!user || !isFirebaseConfigured()) return;
      try {
        const cloud = await loadUserNotificationPrefs(user.uid);
        if (!cloud) return;
        const merged = fromNotificationPrefs(cloud);
        await saveDailyCheckInSettings(merged);
        await applyDailyCheckInSchedule(merged);
      } catch {
        // keep local settings if cloud read fails
      }
    })();
  }, [user]);
  return null;
}

function NotificationOpenChat() {
  const router = useRouter();
  const coldStartHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const openFromResponse = (
      response: Notifications.NotificationResponse | null,
    ) => {
      if (!response) return;
      const data = response.notification.request.content
        .data as Record<string, unknown> | undefined;
      if (data?.type !== 'daily-checkin') return;
      const c = data.character;
      if (c !== 'mom' && c !== 'dad' && c !== 'maher' && c !== 'mjeed') return;
      requestAnimationFrame(() => {
        router.push({
          pathname: '/(tabs)/chat',
          params: { character: c },
        });
      });
    };

    void Notifications.getLastNotificationResponseAsync().then((res) => {
      if (coldStartHandled.current) return;
      if (!res) return;
      coldStartHandled.current = true;
      openFromResponse(res);
    });

    const sub =
      Notifications.addNotificationResponseReceivedListener((response) => {
        openFromResponse(response);
      });

    return () => sub.remove();
  }, [router]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <RescheduleDailyNotifications />
      <NotificationOpenChat />
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="setup" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
