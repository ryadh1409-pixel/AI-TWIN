import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { SETUP_STORAGE_KEY } from '@/constants/setup';
import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  applyDailyCheckInSchedule,
  saveDailyCheckInSettings,
  type DailyCheckInSettings,
  type NotifyCharacter,
} from '@/services/dailyNotifications';
import {
  saveUserNotificationPrefs,
  saveUserProfileMemory,
  type UserMemory,
  type UserProfile,
} from '@/services/userFirestore';

const CHARACTERS = [
  {
    title: 'Mom AI — Micheal (49)',
    subtitle: 'Loving · worries about everything',
    body: 'Deeply caring, overprotective, asks ten questions when you say one — food, sleep, why you didn’t call. Drama-with-love 😂 then full hugs and support. Arabic/English mom energy.',
    emoji: '💗',
  },
  {
    title: 'Dad AI (59)',
    subtitle: 'Colonel · Ministry of Interior',
    body: 'Strict, military-style discipline — corrects everything, rare praise, tough love. Pushes you hard because he believes in you. Arabic/English: "المفروض" energy 😂',
    emoji: '🧭',
  },
  {
    title: 'Friend AI — Maher (35)',
    subtitle: 'ICU doctor · blunt but loyal',
    body: 'Sees life and death daily — pushes you to act, value time, and level up. Uses real ICU perspective (no sugarcoating), Arabic/English, and stories for life lessons — success, discipline, health, being a good person. Core vibe: life is short; be who you want to be now.',
    emoji: '🔥',
  },
  {
    title: 'Brother AI — Mjeed (31)',
    subtitle: 'Pediatric doctor · Al Ittihad ⚽',
    body: 'Funny, sarcastic, hypes you as a genius; brings Al Ittihad Jeddah into the chat 😂 Pediatric humor, light even on heavy topics. Arabic/English — “عبقري” energy.',
    emoji: '😂',
  },
];

export default function SetupScreen() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    age: '',
    goals: '',
  });
  const [notificationPrefs, setNotificationPrefs] = useState<DailyCheckInSettings>({
    enabled: true,
    hour: 17,
    minute: 0,
    characters: {
      mom: true,
      dad: true,
      maher: true,
      mjeed: true,
    },
  });

  const setupMemory: UserMemory = {
    mood: '',
    preferences: '',
    importantFacts: '',
    emotionalState: '',
    behaviorPatterns: '',
  };

  const formatTime = () => {
    const d = new Date();
    d.setHours(notificationPrefs.hour, notificationPrefs.minute, 0, 0);
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const setCharacterEnabled = (character: NotifyCharacter, enabled: boolean) => {
    setNotificationPrefs((prev) => ({
      ...prev,
      characters: {
        ...prev.characters,
        [character]: enabled,
      },
    }));
  };

  const finish = async () => {
    setSaving(true);
    try {
      await saveDailyCheckInSettings(notificationPrefs);
      await applyDailyCheckInSchedule(notificationPrefs);
      if (user && isFirebaseConfigured()) {
        await Promise.all([
          saveUserProfileMemory(user.uid, profile, setupMemory),
          saveUserNotificationPrefs(user.uid, {
            enabled: notificationPrefs.enabled,
            hour: notificationPrefs.hour,
            minute: notificationPrefs.minute,
            characters: notificationPrefs.characters,
          }),
        ]);
      }
      await AsyncStorage.setItem(SETUP_STORAGE_KEY, '1');
      router.replace('/(tabs)');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>My Family AI</Text>
      <Text style={styles.lead}>
        Build your family profile first. This helps Mom, Dad, Maher, and Mjeed
        talk to you with better emotional context from day one.
      </Text>

      <View style={styles.formCard}>
        <Text style={styles.formTitle}>First-time setup</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={profile.name}
          onChangeText={(name) => setProfile((p) => ({ ...p, name }))}
          placeholder="Your name"
          placeholderTextColor="#999"
        />

        <Text style={styles.label}>Age</Text>
        <TextInput
          style={styles.input}
          value={profile.age}
          onChangeText={(age) => setProfile((p) => ({ ...p, age }))}
          placeholder="e.g. 29"
          keyboardType="numbers-and-punctuation"
          placeholderTextColor="#999"
        />

        <Text style={styles.label}>Goals</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={profile.goals}
          onChangeText={(goals) => setProfile((p) => ({ ...p, goals }))}
          placeholder="What are you trying to achieve?"
          placeholderTextColor="#999"
          multiline
        />

        <Text style={styles.sectionLabel}>Daily check-in</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>Enable reminders</Text>
          <Switch
            value={notificationPrefs.enabled}
            onValueChange={(enabled) =>
              setNotificationPrefs((prev) => ({ ...prev, enabled }))
            }
          />
        </View>
        <Pressable
          style={styles.row}
          onPress={() => setShowTime(true)}
          disabled={!notificationPrefs.enabled}>
          <Text
            style={[
              styles.rowText,
              !notificationPrefs.enabled && styles.rowTextDisabled,
            ]}>
            Time
          </Text>
          <Text
            style={[
              styles.rowText,
              !notificationPrefs.enabled && styles.rowTextDisabled,
            ]}>
            {formatTime()}
          </Text>
        </Pressable>
        {showTime ? (
          <DateTimePicker
            value={new Date(0, 0, 0, notificationPrefs.hour, notificationPrefs.minute)}
            mode="time"
            display="default"
            onChange={(_, date) => {
              setShowTime(false);
              if (!date) return;
              setNotificationPrefs((prev) => ({
                ...prev,
                hour: date.getHours(),
                minute: date.getMinutes(),
              }));
            }}
          />
        ) : null}

        <Text style={styles.sectionLabel}>Who can notify you</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>Mom (Micheal)</Text>
          <Switch
            value={notificationPrefs.characters.mom}
            onValueChange={(v) => setCharacterEnabled('mom', v)}
            disabled={!notificationPrefs.enabled}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowText}>Dad (Colonel)</Text>
          <Switch
            value={notificationPrefs.characters.dad}
            onValueChange={(v) => setCharacterEnabled('dad', v)}
            disabled={!notificationPrefs.enabled}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowText}>Maher</Text>
          <Switch
            value={notificationPrefs.characters.maher}
            onValueChange={(v) => setCharacterEnabled('maher', v)}
            disabled={!notificationPrefs.enabled}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowText}>Mjeed</Text>
          <Switch
            value={notificationPrefs.characters.mjeed}
            onValueChange={(v) => setCharacterEnabled('mjeed', v)}
            disabled={!notificationPrefs.enabled}
          />
        </View>
      </View>

      {CHARACTERS.map((c) => (
        <View key={c.title} style={styles.card}>
          <Text style={styles.cardTitle}>
            {c.emoji} {c.title}
          </Text>
          <Text style={styles.cardSub}>{c.subtitle}</Text>
          <Text style={styles.cardBody}>{c.body}</Text>
        </View>
      ))}

      <Text style={styles.footer}>
        Tip: Fill your profile under the Profile tab so everyone knows your goals
        and what to remember.
      </Text>

      <Pressable
        style={({ pressed }) => [
          styles.btn,
          pressed && styles.btnPressed,
          saving && styles.btnDisabled,
        ]}
        onPress={() => void finish()}
        disabled={saving}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Get started</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 24,
    paddingTop: 56,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  lead: {
    fontSize: 16,
    lineHeight: 24,
    color: '#444',
    textAlign: 'center',
    marginBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    backgroundColor: '#fafafa',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
  },
  formCard: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    color: '#444',
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 13,
    color: '#444',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowText: {
    fontSize: 15,
    color: '#111',
  },
  rowTextDisabled: {
    opacity: 0.5,
  },
  footer: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 20,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: '#111',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnPressed: {
    opacity: 0.88,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
