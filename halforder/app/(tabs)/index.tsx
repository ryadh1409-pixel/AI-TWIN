/**
 * Twin AI uses your dev machine IP (from Expo) + port 3000.
 * Backend must listen on 0.0.0.0. Fallback IP is in services/api.ts if Expo cannot infer the host.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import {
  cacheDirectory,
  documentDirectory,
  writeAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';

import { API_URL, uploadVoiceAudio } from '@/services/api';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function HomeScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('Idle');
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

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
        try {
          if (soundRef.current) {
            await soundRef.current.unloadAsync();
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

      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch {
          /* ignore */
        }
        soundRef.current = null;
      }

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

      console.log('Twin AI API base:', API_URL);

      const arrayBuffer = await uploadVoiceAudio(uri);
      const base64 = arrayBufferToBase64(arrayBuffer);

      const baseDir = cacheDirectory ?? documentDirectory;
      if (!baseDir) {
        Alert.alert('Error', 'No writable cache directory available.');
        return;
      }

      const outPath = `${baseDir}twin_ai_response_${Date.now()}.mp3`;
      await writeAsStringAsync(outPath, base64, {
        encoding: EncodingType.Base64,
      });

      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch {
          /* ignore */
        }
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: outPath },
        { shouldPlay: true },
      );
      soundRef.current = sound;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Network or playback failed';
      console.error('stopAndSend failed:', error);
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
      setStatusText('Idle');
    }
  };

  const startDisabled = isRecording || isLoading;
  const stopDisabled = !isRecording || isLoading;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Twin AI 🎤</Text>
      <Text style={styles.hint} numberOfLines={1}>
        {API_URL}
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
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
    maxWidth: '100%',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 24,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 16,
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
});
