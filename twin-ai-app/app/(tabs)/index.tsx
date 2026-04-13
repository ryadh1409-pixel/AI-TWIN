/**
 * Set EXPO_PUBLIC_TRANSCRIBE_URL in twin-ai-app/.env to your Firebase function URL.
 * Restart Expo: npx expo start -c
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';

import { TRANSCRIBE_URL, transcribeAudio } from '@/services/api';

export default function HomeScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('Idle');
  const [transcript, setTranscript] = useState('');
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
    if (isLoading) return;
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

    setIsLoading(true);
    setIsRecording(false);
    setStatusText('Uploading...');

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
      setStatusText('Done');
    } catch (error) {
      console.error('stopAndSend failed:', error);
      const raw =
        error instanceof Error ? error.message : String(error ?? 'Unknown error');
      Alert.alert('Upload failed', raw);
      setStatusText('Idle');
    } finally {
      setIsLoading(false);
    }
  };

  const startDisabled = isRecording || isLoading;
  const stopDisabled = !isRecording || isLoading;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Twin AI 🎤</Text>
      <Text style={styles.hint} numberOfLines={2}>
        {TRANSCRIBE_URL || 'Set EXPO_PUBLIC_TRANSCRIBE_URL in .env'}
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
        <Text style={styles.buttonTextDark}>⏹️ Stop & Send</Text>
      </Pressable>
      <Text style={styles.sectionLabel}>Transcript</Text>
      <ScrollView
        style={styles.transcriptBox}
        contentContainerStyle={styles.transcriptContent}>
        <Text style={styles.transcriptText}>
          {transcript || 'Transcribed text will appear here.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  hint: {
    fontSize: 11,
    color: '#888',
    marginBottom: 8,
    maxWidth: '100%',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 16,
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
  sectionLabel: {
    alignSelf: 'flex-start',
    marginTop: 20,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  transcriptBox: {
    alignSelf: 'stretch',
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#fafafa',
  },
  transcriptContent: {
    padding: 12,
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
});
