import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  applyDailyCheckInSchedule,
  fromNotificationPrefs,
  loadDailyCheckInSettings,
  requestNotificationPermission,
  saveDailyCheckInSettings,
  toNotificationPrefs,
  type DailyCheckInSettings,
  type NotifyCharacter,
} from '@/services/dailyNotifications';
import {
  loadUserNotificationPrefs,
  saveUserNotificationPrefs,
} from '@/services/userFirestore';

const NOTIFY_ORDER: { key: NotifyCharacter; label: string }[] = [
  { key: 'mom', label: 'Micheal (Mom)' },
  { key: 'dad', label: 'Colonel (Dad)' },
  { key: 'maher', label: 'Maher' },
  { key: 'mjeed', label: 'Mjeed' },
];

function makeDate(hour: number, minute: number) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function DailyCheckInSettingsBlock() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<DailyCheckInSettings | null>(null);
  const [showTime, setShowTime] = useState(false);
  const [pickerDate, setPickerDate] = useState(() => makeDate(17, 0));

  useEffect(() => {
    let alive = true;
    void (async () => {
      const local = await loadDailyCheckInSettings();
      if (!alive) return;
      setSettings(local);
      setPickerDate(makeDate(local.hour, local.minute));
      if (!user || !isFirebaseConfigured()) return;
      try {
        const remote = await loadUserNotificationPrefs(user.uid);
        if (!remote || !alive) return;
        const merged = fromNotificationPrefs(remote);
        setSettings(merged);
        setPickerDate(makeDate(merged.hour, merged.minute));
        await saveDailyCheckInSettings(merged);
        await applyDailyCheckInSchedule(merged);
      } catch {
        // keep local settings if cloud fetch fails
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  const persist = useCallback(async (next: DailyCheckInSettings) => {
    setSettings(next);
    await saveDailyCheckInSettings(next);
    await applyDailyCheckInSchedule(next);
    if (user && isFirebaseConfigured()) {
      try {
        await saveUserNotificationPrefs(user.uid, toNotificationPrefs(next));
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : 'Failed to sync notification settings to Firebase.';
        Alert.alert('Sync warning', msg);
      }
    }
  }, [user]);

  const onToggleMaster = async (enabled: boolean) => {
    if (!settings) return;
    if (enabled && Platform.OS !== 'web') {
      const ok = await requestNotificationPermission();
      if (!ok) {
        return;
      }
    }
    await persist({ ...settings, enabled });
  };

  const onToggleChar = async (key: NotifyCharacter, value: boolean) => {
    if (!settings) return;
    await persist({
      ...settings,
      characters: { ...settings.characters, [key]: value },
    });
  };

  const timeLabel = useMemo(() => {
    if (!settings) return '';
    const d = makeDate(settings.hour, settings.minute);
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [settings]);

  const openTimePicker = () => {
    if (!settings?.enabled) return;
    setPickerDate(makeDate(settings.hour, settings.minute));
    setShowTime(true);
  };

  const onTimeChange = (_event: unknown, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowTime(false);
    }
    if (!date || !settings) return;
    setPickerDate(date);
    if (Platform.OS === 'android') {
      void persist({
        ...settings,
        hour: date.getHours(),
        minute: date.getMinutes(),
      });
    }
  };

  const confirmIosTime = () => {
    if (!settings) return;
    setShowTime(false);
    void persist({
      ...settings,
      hour: pickerDate.getHours(),
      minute: pickerDate.getMinutes(),
    });
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.card}>
        <Text style={styles.section}>Daily check-in</Text>
        <Text style={styles.webNote}>
          Daily reminders are available on the iOS and Android apps.
        </Text>
      </View>
    );
  }

  if (!settings) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.section}>Daily check-in</Text>
      <Text style={styles.hint}>
        Reminders sync with your account and schedule on this device. Tap a
        notification to open chat with that character.
      </Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Enable reminders</Text>
        <Switch
          value={settings.enabled}
          onValueChange={(v) => void onToggleMaster(v)}
        />
      </View>

      <Pressable
        style={styles.timeRow}
        onPress={openTimePicker}
        disabled={!settings.enabled}>
        <Text
          style={[
            styles.rowLabel,
            !settings.enabled && styles.rowLabelDisabled,
          ]}>
          Time
        </Text>
        <Text
          style={[
            styles.timeValue,
            !settings.enabled && styles.rowLabelDisabled,
          ]}>
          {timeLabel}
        </Text>
      </Pressable>

      {showTime && (
        <DateTimePicker
          value={pickerDate}
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onTimeChange}
        />
      )}

      {Platform.OS === 'ios' && showTime ? (
        <Pressable style={styles.doneIos} onPress={confirmIosTime}>
          <Text style={styles.doneIosText}>Done</Text>
        </Pressable>
      ) : null}

      <Text style={styles.subLabel}>Who can notify you</Text>
      {NOTIFY_ORDER.map(({ key, label }) => (
        <View key={key} style={styles.row}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Switch
            value={settings.characters[key]}
            onValueChange={(v) => void onToggleChar(key, v)}
            disabled={!settings.enabled}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 4,
  },
  section: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 14,
  },
  webNote: {
    fontSize: 14,
    color: '#666',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  rowLabel: {
    fontSize: 16,
    color: '#111',
    flex: 1,
    paddingRight: 12,
  },
  rowLabelDisabled: {
    opacity: 0.45,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginTop: 12,
    marginBottom: 4,
  },
  doneIos: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
  },
  doneIosText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007aff',
  },
});
