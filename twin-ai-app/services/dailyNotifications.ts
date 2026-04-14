import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type {
  Character,
  NotificationPrefs,
} from '@/services/userFirestore';

const STORAGE_KEY = '@mfa_daily_checkin_v1';
export type NotifyCharacter = Exclude<Character, 'family'>;

export type DailyCheckInSettings = {
  /** Master switch — when false, no notifications scheduled */
  enabled: boolean;
  /** Per-character (only mom, dad, maher, mjeed) */
  characters: Record<NotifyCharacter, boolean>;
  hour: number;
  minute: number;
};

const DEFAULT_SETTINGS: DailyCheckInSettings = {
  enabled: false,
  characters: {
    mom: true,
    dad: true,
    maher: true,
    mjeed: true,
  },
  hour: 17,
  minute: 0,
};

export const CHECK_IN_MESSAGES: Record<
  NotifyCharacter,
  { title: string; body: string }
> = {
  mom: {
    title: 'My Family AI',
    body: 'ميشيل: أكلت؟ نمت زين؟ \nكلمني أطمن عليك 🤍',
  },
  dad: {
    title: 'My Family AI',
    body: 'والدك: وش اللي أنجزته اليوم؟\nأتوقع جواب واضح.',
  },
  maher: {
    title: 'My Family AI',
    body: 'ماهر: الحياة قصيرة،\nوش سويت اليوم؟ 💪',
  },
  mjeed: {
    title: 'My Family AI',
    body: 'مجيد: العبقري! \nكيف يومك؟ الاتحاد كسب وأنت؟ 😂⚽',
  },
};

const IDS: NotifyCharacter[] = ['mom', 'dad', 'maher', 'mjeed'];

function idFor(c: NotifyCharacter) {
  return `daily-checkin-${c}`;
}

export async function loadDailyCheckInSettings(): Promise<DailyCheckInSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DailyCheckInSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      characters: {
        ...DEFAULT_SETTINGS.characters,
        ...parsed.characters,
      },
      hour:
        typeof parsed.hour === 'number' && parsed.hour >= 0 && parsed.hour < 24
          ? parsed.hour
          : DEFAULT_SETTINGS.hour,
      minute:
        typeof parsed.minute === 'number' &&
        parsed.minute >= 0 &&
        parsed.minute < 60
          ? parsed.minute
          : DEFAULT_SETTINGS.minute,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveDailyCheckInSettings(
  s: DailyCheckInSettings,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function toNotificationPrefs(
  settings: DailyCheckInSettings,
): NotificationPrefs {
  return {
    enabled: settings.enabled,
    hour: settings.hour,
    minute: settings.minute,
    characters: settings.characters,
  };
}

export function fromNotificationPrefs(
  prefs: NotificationPrefs,
): DailyCheckInSettings {
  return {
    enabled: prefs.enabled,
    hour: prefs.hour,
    minute: prefs.minute,
    characters: prefs.characters,
  };
}

async function ensureAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('daily-checkin', {
      name: 'Daily check-in',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#111111',
    });
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Cancel all daily check-in schedules */
export async function cancelAllDailyCheckIns() {
  for (const c of IDS) {
    await Notifications.cancelScheduledNotificationAsync(idFor(c)).catch(
      () => {},
    );
  }
}

/**
 * Apply current settings: cancel all, then schedule enabled slots.
 * No-op on web.
 */
export async function applyDailyCheckInSchedule(
  settings: DailyCheckInSettings,
): Promise<void> {
  if (Platform.OS === 'web') return;

  await ensureAndroidChannel();
  await cancelAllDailyCheckIns();

  if (!settings.enabled) return;

  const granted = await requestNotificationPermission();
  if (!granted) return;

  for (const c of IDS) {
    if (!settings.characters[c]) continue;
    const msg = CHECK_IN_MESSAGES[c];
    await Notifications.scheduleNotificationAsync({
      identifier: idFor(c),
      content: {
        title: msg.title,
        body: msg.body,
        data: { character: c, type: 'daily-checkin' },
        sound: true,
        ...(Platform.OS === 'android'
          ? { android: { channelId: 'daily-checkin' } }
          : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: settings.hour,
        minute: settings.minute,
        repeats: true,
      },
    });
  }
}
