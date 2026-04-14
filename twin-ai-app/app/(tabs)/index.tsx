/**
 * My Family AI — set EXPO_PUBLIC_* URLs and Firebase keys in .env.
 * Restart Expo: npx expo start -c
 */

import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  CHAT_URL,
  sendChatMessage,
  synthesizeSpeech,
  transcribeAudio,
  TTS_URL,
  TRANSCRIBE_URL,
} from '@/services/api';
import { playBase64Mp3 } from '@/services/audioPlayback';
import type { Character } from '@/services/userFirestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';

const PERSONA_CARDS: {
  key: Exclude<Character, 'family'>;
  label: string;
  title: string;
  image: any;
}[] = [
  {
    key: 'mom',
    label: 'Micheal (Mom)',
    title: 'أمك دايم معاك 🤍',
    image: require('../../assets/avatars/mom.jpg'),
  },
  {
    key: 'dad',
    label: 'Colonel (Dad)',
    title: 'العقيد - وزارة الداخلية 🎖️',
    image: require('../../assets/avatars/dad.jpeg'),
  },
  {
    key: 'maher',
    label: 'Maher (Friend)',
    title: 'دكتور ICU - صاحبك الصريح 💪',
    image: require('../../assets/avatars/maher.png'),
  },
  {
    key: 'mjeed',
    label: 'Mjeed (Brother)',
    title: 'دكتور أطفال - أخوك المجنون ⚽',
    image: require('../../assets/avatars/mjeed.png'),
  },
];

export default function HomeScreen() {
  const { user, loading: authLoading, idToken, refreshIdToken } = useAuth();
  const [mode, setMode] = useState<Character>('mom');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('Idle');
  const [transcript, setTranscript] = useState('');
  const [replyMomDad, setReplyMomDad] = useState('');
  const [replyFamily, setReplyFamily] = useState<{
    mom: string;
    dad: string;
    maher: string;
    mjeed: string;
  } | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    return () => {
      void (async () => {
        try {
          if (recordingRef.current) {
            await recordingRef.current.stopAndUnloadAsync();
          }
        } catch {
          /* ignore */
        }
      })();
    };
  }, []);

  const startRecording = async () => {
    if (isLoading || authLoading) return;
    if (!isFirebaseConfigured() || !user) {
      Alert.alert(
        'Firebase',
        'Add Firebase config to .env and restart Expo (see .env.example).',
      );
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert(
          'Permission denied',
          'Microphone access is required to record audio.',
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setStatusText('Recording...');
      setReplyMomDad('');
      setReplyFamily(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start recording';
      Alert.alert('Recording error', message);
      setIsRecording(false);
      setStatusText('Idle');
    }
  };

  const stopAndSend = async () => {
    const recording = recordingRef.current;
    if (!recording || !isRecording) {
      Alert.alert('Not recording', 'Tap Start Recording first.');
      return;
    }
    if (!user || !idToken) {
      Alert.alert('Sign-in', 'Wait for Firebase to finish signing you in.');
      return;
    }
    if (!TRANSCRIBE_URL || !CHAT_URL) {
      Alert.alert(
        'Config',
        'Set EXPO_PUBLIC_TRANSCRIBE_URL and EXPO_PUBLIC_CHAT_URL in .env.',
      );
      return;
    }

    setIsLoading(true);
    setIsRecording(false);
    setStatusText('Uploading audio...');

    try {
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;

      const uri = recording.getURI();
      if (!uri) {
        Alert.alert('Error', 'Could not read recording file.');
        setStatusText('Idle');
        return;
      }

      const { text } = await transcribeAudio(uri);
      setTranscript(text);
      setStatusText('Getting reply...');

      let token = idToken;
      try {
        token = (await refreshIdToken()) ?? idToken;
      } catch {
        /* use previous */
      }

      const result = await sendChatMessage(token, mode, text);
      if (
        mode === 'family' &&
        'mom' in result &&
        'maher' in result &&
        'mjeed' in result
      ) {
        setReplyFamily({
          mom: result.mom,
          dad: result.dad,
          maher: result.maher,
          mjeed: result.mjeed,
        });
        setReplyMomDad('');
      } else if ('reply' in result) {
        setReplyMomDad(result.reply);
        setReplyFamily(null);
        if (mode !== 'family') {
          const ttsPayload =
            result.audio ??
            (TTS_URL
              ? await synthesizeSpeech(
                  token,
                  mode as Exclude<Character, 'family'>,
                  result.reply,
                )
              : null);
          if (ttsPayload?.audioBase64) {
            await playBase64Mp3(ttsPayload.audioBase64);
          }
        }
      }
      setStatusText('Done');
    } catch (error) {
      console.error('stopAndSend failed:', error);
      const raw =
        error instanceof Error ? error.message : String(error ?? 'Unknown error');
      Alert.alert('Something went wrong', raw);
      setStatusText('Idle');
    } finally {
      setIsLoading(false);
    }
  };

  const startDisabled = isRecording || isLoading || authLoading;
  const stopDisabled = !isRecording || isLoading || authLoading;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Family AI</Text>
      <Text style={styles.tagline}>
        Mom · Dad · Maher · Mjeed · Family chat
      </Text>

      <Text style={styles.sectionLabel}>Who answers</Text>
      <View style={styles.cardGrid}>
        {PERSONA_CARDS.map((m) => (
          <Pressable
            key={m.key}
            style={[
              styles.personaCard,
              mode === m.key && styles.modeChipActive,
            ]}
            onPress={() => setMode(m.key)}>
            <Image source={m.image} style={styles.personaImage} />
            <Text style={[styles.personaName, mode === m.key && styles.modeChipTextActive]}>
              {m.label}
            </Text>
            <Text style={styles.personaTitle}>{m.title}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        style={[styles.familyCard, mode === 'family' && styles.modeChipActive]}
        onPress={() => setMode('family')}>
        <Text style={[styles.familyTitle, mode === 'family' && styles.modeChipTextActive]}>
          👨‍👩‍👧 Family mode
        </Text>
      </Pressable>

      <Text style={styles.hint} numberOfLines={2}>
        {!TRANSCRIBE_URL || !CHAT_URL
          ? 'Set EXPO_PUBLIC_TRANSCRIBE_URL and EXPO_PUBLIC_CHAT_URL'
          : !TTS_URL
            ? 'Optional: set EXPO_PUBLIC_TTS_URL for explicit TTS endpoint'
          : 'Ready'}
      </Text>
      <Text style={styles.subtitle}>{statusText}</Text>
      {isLoading ? (
        <ActivityIndicator style={styles.spinner} size="small" />
      ) : null}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.buttonPrimary,
          startDisabled && styles.buttonDisabled,
          pressed && !startDisabled && styles.buttonPressed,
        ]}
        onPress={startRecording}
        disabled={startDisabled}>
        <Text style={styles.buttonText}>🎙️ Start Recording</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.buttonSecondary,
          stopDisabled && styles.buttonDisabled,
          pressed && !stopDisabled && styles.buttonPressed,
        ]}
        onPress={stopAndSend}
        disabled={stopDisabled}>
        <Text style={styles.buttonTextDark}>⏹️ Stop & send to AI</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Transcript</Text>
      <ScrollView
        style={styles.transcriptBox}
        contentContainerStyle={styles.transcriptContent}>
        <Text style={styles.transcriptText}>
          {transcript || 'Your speech-to-text will show here.'}
        </Text>
      </ScrollView>

      <Text style={styles.sectionLabel}>Reply</Text>
      <ScrollView
        style={styles.replyBox}
        contentContainerStyle={styles.transcriptContent}>
        {replyFamily ? (
          <>
            <Text style={styles.familyLabel}>Mom</Text>
            <Text style={styles.transcriptText}>{replyFamily.mom}</Text>
            <Text style={[styles.familyLabel, { marginTop: 12 }]}>Dad</Text>
            <Text style={styles.transcriptText}>{replyFamily.dad}</Text>
            <Text style={[styles.familyLabel, { marginTop: 12 }]}>Maher</Text>
            <Text style={styles.transcriptText}>{replyFamily.maher}</Text>
            <Text style={[styles.familyLabel, { marginTop: 12 }]}>Mjeed</Text>
            <Text style={styles.transcriptText}>{replyFamily.mjeed}</Text>
          </>
        ) : (
          <Text style={styles.transcriptText}>
            {replyMomDad || 'AI replies will show here after you record.'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 24,
    paddingTop: 48,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 8,
  },
  personaCard: {
    width: '47%',
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  modeChipActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  personaImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  personaName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  personaTitle: {
    marginTop: 2,
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    lineHeight: 16,
  },
  modeChipTextActive: {
    color: '#fff',
  },
  familyCard: {
    alignSelf: 'stretch',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
  },
  familyTitle: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  hint: {
    fontSize: 11,
    color: '#888',
    marginBottom: 4,
    maxWidth: '100%',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 12,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 12,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    minWidth: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  buttonPrimary: {
    backgroundColor: '#111',
  },
  buttonSecondary: {
    backgroundColor: '#e8e8e8',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextDark: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  transcriptBox: {
    alignSelf: 'stretch',
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#fafafa',
  },
  replyBox: {
    alignSelf: 'stretch',
    maxHeight: 260,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#f6f9ff',
  },
  transcriptContent: {
    padding: 12,
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
  familyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#445',
    marginBottom: 4,
  },
});
