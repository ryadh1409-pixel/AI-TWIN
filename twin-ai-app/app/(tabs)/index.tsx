import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  askTwinRag,
  askTwinVision,
  sendAudio,
  uploadTwinPdf,
  type VoicePerson,
} from '@/services/api';
import { speak } from '@/services/elevenlabs';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
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
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

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

const MAX_MESSAGES = 20;

export default function HomeScreen() {
  const { user, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPdfUploading, setIsPdfUploading] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      void (async () => {
        try {
          if (recordingRef.current) await recordingRef.current.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
      })();
    };
  }, []);

  const pushMessage = (role: 'user' | 'ai', text: string, imageUri?: string) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      timestamp: Date.now(),
      ...(imageUri ? { imageUri } : {}),
    };
    setMessages((prev) => [...prev, msg].slice(-MAX_MESSAGES));
  };

  const formatTime = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const speakWithFallback = async (text: string, _person: VoicePerson) => {
    try {
      await speak(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert('Voice error', msg);
    }
  };

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
        const a = result.assets[0];
        setPendingImage({
          uri: a.uri,
          mimeType: a.mimeType ?? 'image/jpeg',
          fileName: a.fileName ?? 'photo.jpg',
        });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Permission', 'Camera access is required.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
        if (result.canceled || !result.assets[0]) return;
        const a = result.assets[0];
        setPendingImage({
          uri: a.uri,
          mimeType: a.mimeType ?? 'image/jpeg',
          fileName: a.fileName ?? 'photo.jpg',
        });
      }
    } catch (error) {
      Alert.alert('Image', error instanceof Error ? error.message : String(error));
    }
  };

  const openImagePicker = () => {
    Alert.alert('Attach image', 'Choose source', [
      { text: 'Photo Library', onPress: () => void pickImage('library') },
      { text: 'Take Photo', onPress: () => void pickImage('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pickAndUploadPdf = async () => {
    if (authLoading || !user || !isFirebaseConfigured()) {
      Alert.alert('Firebase', 'Firebase is not ready yet.');
      return;
    }
    if (isPdfUploading || isLoading) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file?.uri) return;

      setIsPdfUploading(true);
      const out = await uploadTwinPdf(user.uid, {
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

  const sendMessage = async () => {
    const q = textDraft.trim();
    const img = pendingImage;
    if (!user || authLoading) return;
    if (!q && !img) return;
    if (!isFirebaseConfigured()) {
      Alert.alert('Firebase', 'Add Firebase config to .env and restart Expo.');
      return;
    }

    setTextDraft('');
    setPendingImage(null);
    pushMessage('user', q, img?.uri);
    setIsLoading(true);
    try {
      if (img) {
        const { answer } = await askTwinVision(
          user.uid,
          { uri: img.uri, name: img.fileName, mimeType: img.mimeType },
          q || undefined,
        );
        pushMessage('ai', answer);
      } else {
        const { answer } = await askTwinRag(user.uid, q);
        pushMessage('ai', answer);
      }
    } catch (error) {
      Alert.alert('Send failed', error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const startRecording = async () => {
    if (isLoading || authLoading || isPdfUploading) return;
    if (!isFirebaseConfigured() || !user) {
      Alert.alert('Firebase', 'Firebase is not ready yet.');
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission', 'Microphone access is required.');
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
    } catch (error) {
      Alert.alert('Recording error', error instanceof Error ? error.message : String(error));
    }
  };

  const stopAndSendVoice = async () => {
    const recording = recordingRef.current;
    if (!recording || !isRecording || !user) return;

    setIsRecording(false);
    setIsLoading(true);
    try {
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;
      const uri = recording.getURI();
      if (!uri) return;

      const formData = new FormData();
      formData.append('file', {
        uri,
        name: 'audio.m4a',
        type: 'audio/m4a',
      } as any);

      const { text } = await sendAudio(formData, 'X');
      const transcript = text.trim();
      if (!transcript) return;

      pushMessage('user', transcript);
      const { answer } = await askTwinRag(user.uid, transcript);
      pushMessage('ai', answer);
      await speakWithFallback(answer, 'X');
    } catch (error) {
      Alert.alert('Voice ask failed', error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>AI Twin</Text>
            <Text style={styles.headerSubtitle}>Your Genius AI</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.pdfButton, pressed && styles.glowOrange]}
            onPress={() => void pickAndUploadPdf()}
            disabled={isPdfUploading || isLoading}>
            {isPdfUploading ? (
              <ActivityIndicator color="#FF6B00" size="small" />
            ) : (
              <Text style={styles.pdfButtonText}>📄</Text>
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
          ListEmptyComponent={
            <Text style={styles.emptyText}>Start chatting with your AI Twin</Text>
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View style={[styles.row, isUser ? styles.rowUser : styles.rowAi]}>
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  {item.imageUri ? (
                    <Image source={{ uri: item.imageUri }} style={styles.imageThumb} />
                  ) : null}
                  {item.text ? <Text style={styles.messageText}>{item.text}</Text> : null}
                  <Text style={styles.timestampText}>{formatTime(item.timestamp)}</Text>
                </View>
              </View>
            );
          }}
        />

        <View style={styles.inputArea}>
          {pendingImage ? (
            <View style={styles.previewRow}>
              <Image source={{ uri: pendingImage.uri }} style={styles.previewThumb} />
              <Pressable
                onPress={() => setPendingImage(null)}
                style={({ pressed }) => [styles.clearImageButton, pressed && styles.glowOrange]}>
                <Text style={styles.clearImageText}>✕</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.inputBar}>
            <Pressable
              onPress={openImagePicker}
              style={({ pressed }) => [styles.cameraButton, pressed && styles.glowOrange]}
              disabled={isLoading}>
              <Text style={styles.cameraText}>📷</Text>
            </Pressable>

            <TextInput
              style={styles.input}
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder="Type your message..."
              placeholderTextColor="#888888"
              editable={!isLoading}
              multiline
              maxLength={4000}
            />

            <Pressable
              onPress={() => void sendMessage()}
              disabled={isLoading || (!textDraft.trim() && !pendingImage)}
              style={({ pressed }) => [
                styles.sendButton,
                (pressed || isLoading) && styles.glowOrange,
                (!textDraft.trim() && !pendingImage) && styles.disabled,
              ]}>
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.sendText}>➤</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            onPressIn={() => void startRecording()}
            onPressOut={() => void stopAndSendVoice()}
            disabled={isLoading || isPdfUploading}
            style={({ pressed }) => [styles.micWrap, (pressed || isRecording) && styles.glowOrange]}>
            <LinearGradient
              colors={['#FF6B00', '#FF8C3A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.micButton}>
              <Text style={styles.micIcon}>🎤</Text>
            </LinearGradient>
          </Pressable>
          <Text style={styles.holdText}>Hold to Record</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  header: {
    backgroundColor: '#0A0A0A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#FF6B00',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
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
  pdfButtonText: {
    fontSize: 20,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 14,
    paddingBottom: 20,
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 28,
  },
  row: {
    marginBottom: 12,
    maxWidth: '100%',
  },
  rowUser: {
    alignItems: 'flex-end',
  },
  rowAi: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: '84%',
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
  messageText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
  },
  timestampText: {
    color: '#FFFFFF',
    fontSize: 11,
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  imageThumb: {
    width: 165,
    height: 128,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#1A1A1A',
  },
  inputArea: {
    backgroundColor: '#141414',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  previewThumb: {
    width: 58,
    height: 58,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  clearImageButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  clearImageText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  inputBar: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cameraButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraText: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 38,
    maxHeight: 110,
    paddingVertical: 8,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FF6B00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 1,
  },
  disabled: {
    opacity: 0.45,
  },
  micWrap: {
    alignSelf: 'center',
    marginTop: 14,
    borderRadius: 999,
  },
  micButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    fontSize: 30,
    color: '#FFFFFF',
  },
  holdText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  glowOrange: {
    shadowColor: '#FF6B00',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
});
