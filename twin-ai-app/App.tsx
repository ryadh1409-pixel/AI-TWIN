import * as DocumentPicker from 'expo-document-picker';
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GeniusAvatar, type GeniusAvatarMode } from '@/components/GeniusAvatar';
import { ThinkingIndicator } from '@/components/ThinkingIndicator';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
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
import type { VoicePerson } from '@/services/api';
import {
  askTwinRag,
  askTwinVision,
  postVoicePersonChat,
  textToSpeech,
  transcribeAudio,
  uploadTwinPdf,
} from '@/services/api';
import { playAudioFromBase64 } from '@/services/voicePlayback';

const USER_ID = 'local-user';
const MAX_MESSAGES = 20;
/** Persona for voice: record → /transcribe → /chat → /tts (server ElevenLabs). */
const VOICE_CHAT_PERSON: VoicePerson = 'twin';

type ChatMessage = {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
  imageUri?: string;
};

type PendingImage = {
  uri: string;
  mimeType: string;
  fileName: string;
};

export default function App() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pressScaleAnim = useRef(new Animated.Value(1)).current;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isPdfUploading, setIsPdfUploading] = useState(false);
  const [micAllowed, setMicAllowed] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, isTyping, isSpeaking]);

  useEffect(() => {
    void (async () => {
      try {
        const permission = await getRecordingPermissionsAsync();
        setMicAllowed(Boolean(permission.granted));
      } catch {
        setMicAllowed(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (recorderState.isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
    }
  }, [recorderState.isRecording, pulseAnim]);

  useEffect(() => {
    return () => {
      void (async () => {
        try {
          if (audioRecorder.getStatus().isRecording) {
            await audioRecorder.stop();
          }
        } catch {
          /* ignore */
        }
      })();
    };
  }, [audioRecorder]);

  const pushMessage = (role: 'user' | 'ai', text: string, imageUri?: string) => {
    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      timestamp: Date.now(),
      ...(imageUri ? { imageUri } : {}),
    };
    setMessages((prev) => [...prev, message].slice(-MAX_MESSAGES));
  };

  const arTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ar-EG', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
    [],
  );

  const formatTime = (timestamp: number) => {
    try {
      return arTimeFormatter.format(new Date(timestamp));
    } catch {
      return '';
    }
  };

  const lastAiMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'ai') return messages[i].id;
    }
    return null;
  }, [messages]);

  const pickImage = async (source: 'library' | 'camera') => {
    try {
      if (source === 'library') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Permission', 'Photo library access is required.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.9,
        });
        if (result.canceled || !result.assets[0]) return;
        const file = result.assets[0];
        setPendingImage({
          uri: file.uri,
          mimeType: file.mimeType ?? 'image/jpeg',
          fileName: file.fileName ?? 'photo.jpg',
        });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Permission', 'Camera access is required.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
        if (result.canceled || !result.assets[0]) return;
        const file = result.assets[0];
        setPendingImage({
          uri: file.uri,
          mimeType: file.mimeType ?? 'image/jpeg',
          fileName: file.fileName ?? 'photo.jpg',
        });
      }
    } catch (error) {
      Alert.alert('Image', error instanceof Error ? error.message : String(error));
    }
  };

  const showImagePicker = () => {
    Alert.alert('Attach image', 'Choose source', [
      { text: 'Photo Library', onPress: () => void pickImage('library') },
      { text: 'Take Photo', onPress: () => void pickImage('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const sendMessage = async () => {
    const q = input.trim();
    const img = pendingImage;
    if (!q && !img) return;

    setInput('');
    setPendingImage(null);
    pushMessage('user', q, img?.uri);
    setIsLoading(true);
    setIsTyping(true);

    try {
      if (img) {
        const { answer } = await askTwinVision(
          USER_ID,
          { uri: img.uri, mimeType: img.mimeType, name: img.fileName },
          q || undefined,
        );
        pushMessage('ai', answer);
      } else {
        const { answer } = await askTwinRag(USER_ID, q);
        pushMessage('ai', answer);
      }
    } catch (error) {
      pushMessage('ai', 'حدث خطأ.');
      Alert.alert('Send failed', error instanceof Error ? error.message : String(error));
    } finally {
      setIsTyping(false);
      setIsLoading(false);
      setIsSpeaking(false);
    }
  };

  const animateMicPress = (toValue: number) => {
    Animated.spring(pressScaleAnim, {
      toValue,
      speed: 20,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  };

  const startRecording = async () => {
    if (isLoading || isPdfUploading || audioRecorder.getStatus().isRecording) return;
    try {
      if (!micAllowed) {
        const permission = await requestRecordingPermissionsAsync();
        const granted = Boolean(permission.granted);
        setMicAllowed(granted);
        if (!granted) {
          Alert.alert('Microphone', 'Microphone permission is required.');
          return;
        }
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (error) {
      Alert.alert('Recording error', error instanceof Error ? error.message : String(error));
    }
  };

  const stopRecordingAndAsk = async () => {
    if (!audioRecorder.getStatus().isRecording) return;

    setIsLoading(true);
    setIsTyping(true);

    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri ?? recorderState.url ?? undefined;
      if (!uri) throw new Error('Failed to read recording file.');

      const { text } = await transcribeAudio(uri, VOICE_CHAT_PERSON);
      const transcript = text.trim();
      if (!transcript) {
        setIsTyping(false);
        setIsLoading(false);
        return;
      }

      pushMessage('user', transcript);
      const { reply } = await postVoicePersonChat(transcript, VOICE_CHAT_PERSON);
      pushMessage('ai', reply);
      setIsTyping(false);
      setIsLoading(false);
      const tts = await textToSpeech(reply, VOICE_CHAT_PERSON);
      await playAudioFromBase64(tts.audioBase64, tts.audioMimeType, {
        onPlaybackStart: () => setIsSpeaking(true),
        onPlaybackEnd: () => setIsSpeaking(false),
      });
    } catch (error) {
      Alert.alert('Voice failed', error instanceof Error ? error.message : String(error));
      setIsSpeaking(false);
    } finally {
      setIsTyping(false);
      setIsLoading(false);
    }
  };

  const uploadPdf = async () => {
    if (isLoading || isPdfUploading) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file?.uri) return;

      setIsPdfUploading(true);
      const out = await uploadTwinPdf(USER_ID, {
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType ?? 'application/pdf',
      });
      Alert.alert('PDF Uploaded', `Indexed ${out.chunks} chunk(s).`);
    } catch (error) {
      Alert.alert('PDF upload failed', error instanceof Error ? error.message : String(error));
    } finally {
      setIsPdfUploading(false);
    }
  };

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.16],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.85],
  });

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>AI Twin</Text>
          <Text style={styles.subtitle}>Your Genius AI</Text>
        </View>
        <Pressable
          onPress={() => void uploadPdf()}
          style={({ pressed }) => [styles.pdfButton, pressed && styles.glow]}
          disabled={isPdfUploading || isLoading}>
          {isPdfUploading ? (
            <ActivityIndicator color="#FF6B00" size="small" />
          ) : (
            <Text style={styles.pdfText}>📄</Text>
          )}
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>ابدأ المحادثة...</Text>}
        ListFooterComponent={isTyping ? <ThinkingIndicator /> : null}
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          if (isUser) {
            return (
              <View style={[styles.row, styles.rowUser]}>
                <View style={[styles.bubble, styles.userBubble]}>
                  {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.thumb} /> : null}
                  <Text style={styles.message}>{item.text}</Text>
                  <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                </View>
              </View>
            );
          }
          let avatarMode: GeniusAvatarMode = 'breathing';
          if (item.id === lastAiMessageId && isSpeaking) {
            avatarMode = 'speaking';
          }
          return (
            <View style={[styles.row, styles.rowAi]}>
              <View style={styles.aiRow}>
                <GeniusAvatar mode={avatarMode} size={45} showLabel />
                <View style={[styles.bubble, styles.aiBubble, styles.aiBubbleFlex]}>
                  {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.thumb} /> : null}
                  <Text style={styles.message}>{item.text}</Text>
                  <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {pendingImage ? (
          <View style={styles.previewRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.previewThumb} />
            <Pressable onPress={() => setPendingImage(null)} style={styles.clearBtn}>
              <Text style={styles.clearText}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.inputBar}>
          <Pressable onPress={showImagePicker} style={styles.cameraBtn} disabled={isLoading}>
            <Text style={styles.cameraIcon}>📷</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="اكتب رسالتك..."
            placeholderTextColor="#888888"
            onSubmitEditing={() => void sendMessage()}
            editable={!isLoading}
            multiline
          />
          <Pressable
            onPress={() => void sendMessage()}
            style={({ pressed }) => [
              styles.sendBtn,
              pressed && styles.glow,
              isLoading && styles.disabled,
            ]}
            disabled={isLoading || (!input.trim() && !pendingImage)}>
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.sendIcon}>➤</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.micWrap}>
          <Pressable
            onPressIn={() => {
              animateMicPress(0.96);
              void startRecording();
            }}
            onPressOut={() => {
              animateMicPress(1);
              void stopRecordingAndAsk();
            }}
            disabled={isLoading || isPdfUploading}
            style={styles.micPress}>
            <Animated.View
              style={[
                styles.micShell,
                styles.glow,
                {
                  transform: [{ scale: pressScaleAnim }],
                },
              ]}>
              {recorderState.isRecording ? (
                <Animated.View
                  style={[
                    styles.recordPulse,
                    {
                      transform: [{ scale: pulseScale }],
                      opacity: pulseOpacity,
                    },
                  ]}
                />
              ) : null}
              <LinearGradient
                colors={['#FF6B00', '#FF8C3A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.micBtn}>
                <Text style={styles.micIcon}>🎤</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>
          <Text style={[styles.holdLabel, recorderState.isRecording && styles.recordingLabel]}>
            {recorderState.isRecording ? 'جاري التسجيل...' : 'اضغط مطولاً للتسجيل'}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    backgroundColor: '#0A0A0A',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    color: '#FF6B00',
    fontSize: 14,
    marginTop: 2,
    fontWeight: '600',
  },
  pdfButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfText: {
    fontSize: 20,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    paddingBottom: 8,
  },
  empty: {
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 15,
  },
  row: {
    marginBottom: 10,
  },
  rowUser: {
    alignItems: 'flex-end',
  },
  rowAi: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: '#FF6B00',
    borderBottomRightRadius: 5,
  },
  aiBubble: {
    backgroundColor: '#1A1A1A',
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    maxWidth: '96%',
    gap: 8,
  },
  aiBubbleFlex: {
    flexShrink: 1,
    maxWidth: '78%',
  },
  message: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
  },
  time: {
    color: '#FFFFFF',
    fontSize: 11,
    marginTop: 6,
    alignSelf: 'flex-end',
    opacity: 0.82,
  },
  thumb: {
    width: 170,
    height: 130,
    borderRadius: 10,
    marginBottom: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#141414',
  },
  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  clearText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  cameraBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIcon: {
    color: '#FFFFFF',
    fontSize: 18,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    backgroundColor: '#0A0A0A',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FF6B00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  micWrap: {
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    paddingBottom: 16,
    paddingTop: 8,
  },
  micPress: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  micShell: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    fontSize: 34,
    color: '#FFFFFF',
  },
  recordPulse: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EF4444',
  },
  holdLabel: {
    marginTop: 6,
    fontSize: 12,
    color: '#FF6B00',
    fontWeight: '600',
  },
  recordingLabel: {
    color: '#EF4444',
  },
  glow: {
    shadowColor: '#FF6B00',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  disabled: {
    opacity: 0.55,
  },
});
