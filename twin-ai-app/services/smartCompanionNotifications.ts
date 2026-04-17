import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

const ID_INACTIVITY = 'x-companion-inactivity';
const ID_MORNING = 'x-companion-morning';
const ID_EVENING = 'x-companion-evening';

/** 6 minutes — middle of 5–10 min “inactivity” follow-up after leaving the app */
const INACTIVITY_SECONDS = 360;

async function ensureSmartChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('companion-smart', {
      name: 'X companion',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#1f4f8f',
    });
  }
}

async function scheduleInactivityFollowUp() {
  await Notifications.cancelScheduledNotificationAsync(ID_INACTIVITY).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: ID_INACTIVITY,
    content: {
      title: 'X',
      body: 'لسه تراها؟ تبغى نكمل… وين نروح؟',
      data: { type: 'x-companion-inactivity' },
      sound: true,
      ...(Platform.OS === 'android'
        ? { android: { channelId: 'companion-smart' } }
        : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: INACTIVITY_SECONDS,
      repeats: false,
    },
  });
}

async function cancelInactivityFollowUp() {
  await Notifications.cancelScheduledNotificationAsync(ID_INACTIVITY).catch(() => {});
}

async function scheduleMorningEveningPings() {
  await Notifications.cancelScheduledNotificationAsync(ID_MORNING).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(ID_EVENING).catch(() => {});

  const androidExtra =
    Platform.OS === 'android'
      ? { android: { channelId: 'companion-smart' } }
      : {};

  await Notifications.scheduleNotificationAsync({
    identifier: ID_MORNING,
    content: {
      title: 'X',
      body: 'صباح الخير ☀️ وش خطتك اليوم؟',
      data: { type: 'x-companion-morning' },
      sound: true,
      ...androidExtra,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 9,
      minute: 0,
    },
  });

  await Notifications.scheduleNotificationAsync({
    identifier: ID_EVENING,
    content: {
      title: 'X',
      body: 'مساء الخير 👀 تبغى نطلع؟',
      data: { type: 'x-companion-evening' },
      sound: true,
      ...androidExtra,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 18,
      minute: 30,
    },
  });
}

/**
 * Request permission, schedule gentle morning/evening pings, and arm inactivity follow-up when app backgrounds.
 * Idempotent per install session flag to avoid re-scheduling every hot reload excessively.
 */
export async function initSmartCompanionNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  await ensureSmartChannel();

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  await scheduleMorningEveningPings();
}

export function registerInactivityNotificationListener(): () => void {
  if (Platform.OS === 'web') {
    return () => {};
  }

  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      void scheduleInactivityFollowUp();
    } else if (state === 'active') {
      void cancelInactivityFollowUp();
    }
  });

  return () => sub.remove();
}
