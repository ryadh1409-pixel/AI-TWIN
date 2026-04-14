import { DailyCheckInSettingsBlock } from '@/components/DailyCheckInSettings';
import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  saveUserProfileMemory,
  subscribeUserDoc,
  type UserMemory,
  type UserProfile,
} from '@/services/userFirestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const emptyProfile: UserProfile = { name: '', age: '', goals: '' };
const emptyMemory: UserMemory = {
  mood: '',
  preferences: '',
  importantFacts: '',
  emotionalState: '',
  behaviorPatterns: '',
};

export default function ProfileScreen() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [memory, setMemory] = useState<UserMemory>(emptyMemory);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !isFirebaseConfigured()) return;
    const unsub = subscribeUserDoc(user.uid, ({ profile: p, memory: m }) => {
      setProfile(p);
      setMemory(m);
    });
    return () => unsub();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveUserProfileMemory(user.uid, profile, memory);
      Alert.alert('Saved', 'Your profile and memory are updated.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const showProfileForm = isFirebaseConfigured() && user;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <DailyCheckInSettingsBlock />

      {showProfileForm ? (
        <>
          <Text style={[styles.title, styles.titleSpaced]}>Profile & memory</Text>
          <Text style={styles.sub}>
            Stored in Firestore and shared with Mom, Dad, Maher, and Mjeed as
            context (including Family mode).
          </Text>

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
            placeholder="e.g. 32"
            placeholderTextColor="#999"
            keyboardType="numbers-and-punctuation"
          />

          <Text style={styles.label}>Goals</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={profile.goals}
            onChangeText={(goals) => setProfile((p) => ({ ...p, goals }))}
            placeholder="What you are working toward"
            placeholderTextColor="#999"
            multiline
          />

          <Text style={styles.section}>Memory</Text>

          <Text style={styles.label}>Mood (lately)</Text>
          <TextInput
            style={styles.input}
            value={memory.mood}
            onChangeText={(mood) => setMemory((m) => ({ ...m, mood }))}
            placeholder="e.g. stressed but hopeful"
            placeholderTextColor="#999"
          />

          <Text style={styles.label}>Preferences</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={memory.preferences}
            onChangeText={(preferences) =>
              setMemory((m) => ({ ...m, preferences }))
            }
            placeholder="Things you like, communication style, etc."
            placeholderTextColor="#999"
            multiline
          />

          <Text style={styles.label}>Important facts</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={memory.importantFacts}
            onChangeText={(importantFacts) =>
              setMemory((m) => ({ ...m, importantFacts }))
            }
            placeholder="People, dates, things the AIs should remember"
            placeholderTextColor="#999"
            multiline
          />

          <Text style={styles.label}>Emotional state patterns</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={memory.emotionalState}
            onChangeText={(emotionalState) =>
              setMemory((m) => ({ ...m, emotionalState }))
            }
            placeholder="How your emotions usually show up"
            placeholderTextColor="#999"
            multiline
          />

          <Text style={styles.label}>Behavior patterns</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={memory.behaviorPatterns}
            onChangeText={(behaviorPatterns) =>
              setMemory((m) => ({ ...m, behaviorPatterns }))
            }
            placeholder="Habits, routines, triggers, tendencies"
            placeholderTextColor="#999"
            multiline
          />

          <Pressable
            style={[styles.saveBtn, saving && styles.saveDisabled]}
            onPress={() => void save()}
            disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </Pressable>
        </>
      ) : (
        <Text style={styles.helpSpaced}>
          Configure Firebase in .env to sync profile and memory to the cloud.
          Daily reminders above still work on this device.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
    paddingTop: 48,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  titleSpaced: {
    marginTop: 20,
  },
  sub: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  section: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveBtn: {
    marginTop: 24,
    backgroundColor: '#111',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  helpSpaced: {
    marginTop: 16,
    textAlign: 'center',
    color: '#666',
    fontSize: 15,
    lineHeight: 22,
  },
});
