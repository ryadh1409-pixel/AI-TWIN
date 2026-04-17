import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { NearbyPlaceChips } from '@/components/NearbyPlaceChips';
import { getForegroundCoords, type LatLng } from '@/services/location';
import {
  API_BASE_URL,
  askTwinRag,
  askTwinVision,
  CHAT_AUDIO_URL,
  type NearbyPlaceSuggestion,
} from '@/services/api';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const LOCAL_USER_ID = 'local-user';
const MAX_MSG = 20;

type AppMessage = {
  id: string;
  role: 'user' | 'ai';
  text: string;
  imageUri?: string;
};

type PendingImage = {
  uri: string;
  mimeType: string;
  fileName: string;
};

export default function App() {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const locationRef = useRef<LatLng | null>(null);
  const listRef = useRef<FlatList<AppMessage>>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [memoryHint, setMemoryHint] = useState('');
  const [status, setStatus] = useState('Tap to start recording');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [locationLabel, setLocationLabel] = useState('Location: not yet');
  const [nearbySuggestions, setNearbySuggestions] = useState<NearbyPlaceSuggestion[]>([]);
  const [nearbySource, setNearbySource] = useState<string | undefined>();

  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);

  const pushPair = (userText: string, aiText: string, imageUri?: string) => {
    const t = Date.now();
    const userMsg: AppMessage = imageUri
      ? { id: `u-${t}`, role: 'user', text: userText, imageUri }
      : { id: `u-${t}`, role: 'user', text: userText };
    const aiMsg: AppMessage = { id: `a-${t}`, role: 'ai', text: aiText };
    setMessages((prev) => [...prev, userMsg, aiMsg].slice(-MAX_MSG));
  };

  const pushUser = (text: string, imageUri?: string) => {
    const userMsg: AppMessage = imageUri
      ? { id: `u-${Date.now()}`, role: 'user', text, imageUri }
      : { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((prev) => [...prev, userMsg].slice(-MAX_MSG));
  };

  const pushAi = (text: string) => {
    const aiMsg: AppMessage = { id: `a-${Date.now()}`, role: 'ai', text };
    setMessages((prev) => [...prev, aiMsg].slice(-MAX_MSG));
  };

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const coords = await getForegroundCoords();
      if (cancelled) return;
      if (coords) {
        locationRef.current = coords;
        setLocationLabel(`Location: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
      } else {
        setLocationLabel('Location: off or unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const playBase64Audio = async (audioBase64: string, mimeType: string) => {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    const { sound } = await Audio.Sound.createAsync({
      uri: `data:${mimeType};base64,${audioBase64}`,
    });
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((playbackStatus) => {
      if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  };

  const startRecording = async () => {
    const permission = await Audio.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      throw new Error('Microphone permission is required.');
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
    setStatus('Recording... tap again to stop');
  };

  const stopRecordingAndSend = async () => {
    const recording = recordingRef.current;
    if (!recording) throw new Error('No active recording.');

    setIsLoading(true);
    setStatus('Stopping recording...');
    await recording.stopAndUnloadAsync();
    recordingRef.current = null;
    setIsRecording(false);

    const uri = recording.getURI();
    if (!uri) throw new Error('Failed to read recording file.');

    setStatus('Uploading audio...');
    const fresh = await getForegroundCoords();
    if (fresh) {
      locationRef.current = fresh;
      setLocationLabel(`Location: ${fresh.lat.toFixed(4)}, ${fresh.lng.toFixed(4)}`);
    }

    const formData = new FormData();
    formData.append('file', {
      uri,
      name: 'recording.m4a',
      type: 'audio/m4a',
    } as any);
    formData.append('person', 'X');
    formData.append('userId', LOCAL_USER_ID);
    const coords = locationRef.current;
    if (coords) {
      formData.append('location', JSON.stringify({ lat: coords.lat, lng: coords.lng }));
    }

    const response = await fetch(CHAT_AUDIO_URL, {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Backend request failed.');
    }

    const t = String(payload.transcript || '');
    const r = String(payload.reply || '');
    setTranscript(t);
    setReply(r);
    setMemoryHint(payload.memoryHint || '');
    setNearbySuggestions(
      Array.isArray(payload.nearbySuggestions) ? payload.nearbySuggestions : [],
    );
    setNearbySource(
      typeof payload.nearbySource === 'string' ? payload.nearbySource : undefined,
    );

    if (t || r) {
      pushPair(t || '(voice)', r || '…', undefined);
    }

    if (!payload.audioBase64) {
      throw new Error('Backend did not return audio.');
    }

    setStatus('Playing AI voice...');
    await playBase64Audio(payload.audioBase64, payload.mimeType || 'audio/mpeg');
    setStatus('Done. Tap to record again.');
  };

  const onRecordPress = async () => {
    if (isLoading) return;
    try {
      if (!isRecording) {
        await startRecording();
      } else {
        await stopRecordingAndSend();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log('[voice-flow] error:', message);
      setStatus('Error. Tap to try again.');
      setIsRecording(false);
      Alert.alert('Voice Flow Error', message);
    } finally {
      setIsLoading(false);
    }
  };

  const openImageSource = (source: 'library' | 'camera') => {
    void (async () => {
      try {
        if (source === 'library') {
          const { status } =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Photos', 'Allow photo library access to attach images.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
          });
          if (result.canceled || !result.assets[0]) return;
          const a = result.assets[0];
          setPendingImage({
            uri: a.uri,
            mimeType: a.mimeType ?? 'image/jpeg',
            fileName: a.fileName ?? 'photo.jpg',
          });
        } else {
          const { status } =
            await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Camera', 'Allow camera access to take a photo.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            quality: 0.85,
          });
          if (result.canceled || !result.assets[0]) return;
          const a = result.assets[0];
          setPendingImage({
            uri: a.uri,
            mimeType: a.mimeType ?? 'image/jpeg',
            fileName: a.fileName ?? 'photo.jpg',
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert('Image', msg);
      }
    })();
  };

  const showImageOptions = () => {
    Alert.alert('Add image', 'Choose a source', [
      { text: 'Photo library', onPress: () => openImageSource('library') },
      { text: 'Take photo', onPress: () => openImageSource('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const sendComposer = async () => {
    const q = textDraft.trim();
    const img = pendingImage;
    if (!q && !img) return;
    setTextDraft('');
    setPendingImage(null);
    setIsLoading(true);
    setStatus('Sending…');
    try {
      if (img) {
        pushUser(q, img.uri);
        const { answer } = await askTwinVision(
          LOCAL_USER_ID,
          {
            uri: img.uri,
            mimeType: img.mimeType,
            name: img.fileName,
          },
          q || undefined,
        );
        pushAi(answer);
      } else {
        pushUser(q);
        const { answer } = await askTwinRag(LOCAL_USER_ID, q);
        pushAi(answer);
      }
      setStatus('Done.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Send failed', msg);
      setStatus('Error');
    } finally {
      setIsLoading(false);
    }
  };

  const canSend = textDraft.trim().length > 0 || pendingImage != null;
  const sendDisabled = !canSend || isLoading;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={64}>
      <View style={styles.header}>
        <Text style={styles.title}>X Companion</Text>
        <Text style={styles.companion}>Talking to X</Text>
        <Text style={styles.subtitle}>{status}</Text>
        <Text style={styles.url}>API: {API_BASE_URL}</Text>
        <Text style={styles.urlSmall}>Voice: {CHAT_AUDIO_URL}</Text>
        <Text style={styles.locationHint}>{locationLabel}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        style={styles.msgList}
        contentContainerStyle={styles.msgListContent}
        ListEmptyComponent={
          <Text style={styles.empty}>No chat yet — type below or use voice.</Text>
        }
        renderItem={({ item }) => {
          if (item.role === 'user') {
            return (
              <View style={styles.rowUser}>
                <View style={[styles.bubble, styles.bubbleUser]}>
                  {item.imageUri ? (
                    <Image
                      source={{ uri: item.imageUri }}
                      style={styles.thumb}
                      resizeMode="cover"
                    />
                  ) : null}
                  {item.text ? (
                    <Text
                      style={[
                        styles.bubbleTextUser,
                        item.imageUri ? { marginTop: 8 } : null,
                      ]}>
                      {item.text}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          }
          return (
            <View style={styles.rowAi}>
              <View style={[styles.bubble, styles.bubbleAi]}>
                <Text style={styles.bubbleTextAi}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />

      {pendingImage ? (
        <View style={styles.previewRow}>
          <Image
            source={{ uri: pendingImage.uri }}
            style={styles.previewThumb}
            resizeMode="cover"
          />
          <Pressable onPress={() => setPendingImage(null)} style={styles.previewClear}>
            <Text style={styles.previewClearText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          style={[styles.camBtn, isLoading && styles.btnDisabled]}
          onPress={showImageOptions}
          disabled={isLoading}
          accessibilityLabel="Image picker">
          <Text style={styles.camBtnText}>📷</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={textDraft}
          onChangeText={setTextDraft}
          placeholder="Message (optional with image)…"
          placeholderTextColor="#999"
          editable={!isLoading}
          multiline
          maxLength={4000}
        />
        <Pressable
          style={[styles.sendBtn, sendDisabled && styles.btnDisabled]}
          onPress={() => void sendComposer()}
          disabled={sendDisabled}>
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        style={[
          styles.button,
          isRecording ? styles.buttonStop : styles.buttonStart,
          isLoading && styles.btnDisabled,
        ]}
        onPress={() => void onRecordPress()}
        disabled={isLoading}>
        <Text style={styles.buttonText}>
          {isLoading
            ? 'Working...'
            : isRecording
              ? 'Stop Recording'
              : 'Start Recording'}
        </Text>
      </Pressable>

      <View style={styles.box}>
        <Text style={styles.boxLabel}>Last voice transcript</Text>
        <Text style={styles.boxText}>{transcript || '—'}</Text>
      </View>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>Last voice reply</Text>
        <Text style={styles.boxText}>{reply || '—'}</Text>
      </View>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>Memory</Text>
        <Text style={styles.boxText}>{memoryHint || '—'}</Text>
      </View>

      <NearbyPlaceChips places={nearbySuggestions} nearbySource={nearbySource} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    paddingTop: 48,
  },
  header: {
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  companion: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f4f8f',
  },
  subtitle: {
    fontSize: 14,
    color: '#444',
    marginTop: 4,
  },
  url: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
  },
  urlSmall: {
    fontSize: 10,
    color: '#aaa',
  },
  locationHint: {
    fontSize: 11,
    color: '#2e7d32',
    marginTop: 2,
  },
  msgList: {
    flex: 1,
    maxHeight: 280,
  },
  msgListContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },
  empty: {
    color: '#999',
    textAlign: 'center',
    marginTop: 16,
  },
  rowUser: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  rowAi: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  bubble: {
    maxWidth: '88%',
    padding: 12,
    borderRadius: 16,
  },
  bubbleUser: {
    backgroundColor: '#111',
    borderBottomRightRadius: 4,
  },
  bubbleAi: {
    backgroundColor: '#e8eef9',
    borderBottomLeftRadius: 4,
  },
  bubbleTextUser: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 21,
  },
  bubbleTextAi: {
    fontSize: 15,
    color: '#111',
    lineHeight: 21,
  },
  thumb: {
    width: 160,
    height: 130,
    borderRadius: 12,
    backgroundColor: '#333',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  previewClear: {
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  previewClearText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '700',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
  },
  camBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  camBtnText: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: '#111',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  button: {
    minWidth: 220,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  buttonStart: {
    backgroundColor: '#111',
  },
  buttonStop: {
    backgroundColor: '#b00020',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  box: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  boxLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  boxText: {
    fontSize: 15,
    color: '#222',
  },
});
