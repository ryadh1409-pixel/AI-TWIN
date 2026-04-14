import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { playBase64Mp3 } from '@/services/audioPlayback';
import { sendChatMessage, CHAT_URL, synthesizeSpeech, TTS_URL } from '@/services/api';
import {
  subscribeMessages,
  type FamilyMessage,
  type MomDadMessage,
} from '@/services/chatFirestore';
import type { Character } from '@/services/userFirestore';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

const MODES: { key: Character; label: string }[] = [
  { key: 'mom', label: 'Mom' },
  { key: 'dad', label: 'Dad' },
  { key: 'maher', label: 'Maher' },
  { key: 'mjeed', label: 'Mjeed' },
  { key: 'family', label: 'Family' },
];

type SoloCharacter = Exclude<Character, 'family'>;

const AVATAR_META: Record<
  SoloCharacter,
  { name: string; image: any }
> = {
  mom: {
    name: 'Micheal',
    image: require('../../assets/avatars/mom.jpg'),
  },
  dad: {
    name: 'Colonel',
    image: require('../../assets/avatars/dad.jpeg'),
  },
  maher: {
    name: 'Maher',
    image: require('../../assets/avatars/maher.png'),
  },
  mjeed: {
    name: 'Mjeed',
    image: require('../../assets/avatars/mjeed.png'),
  },
};

function CharacterAvatar({
  character,
  size = 34,
  showBadge = false,
}: {
  character: SoloCharacter;
  size?: number;
  showBadge?: boolean;
}) {
  const meta = AVATAR_META[character];
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={[
          styles.avatarCircle,
          { width: size, height: size, borderRadius: size / 2 },
        ]}>
        <Image
          source={meta.image}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      </View>
      {character === 'dad' && showBadge ? <Text style={styles.badge}>🎖️</Text> : null}
    </View>
  );
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ character?: string }>();
  const { user, loading: authLoading, idToken, refreshIdToken } = useAuth();
  const [character, setCharacter] = useState<Character>('mom');
  const [messages, setMessages] = useState<(MomDadMessage | FamilyMessage)[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const c = params.character;
    if (
      c === 'mom' ||
      c === 'dad' ||
      c === 'maher' ||
      c === 'mjeed' ||
      c === 'family'
    ) {
      setCharacter(c);
    }
  }, [params.character]);

  useEffect(() => {
    if (!user || !isFirebaseConfigured()) {
      setMessages([]);
      return;
    }
    const unsub = subscribeMessages(user.uid, character, setMessages);
    return () => unsub();
  }, [user, character]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !user || !idToken) return;
    if (!CHAT_URL) {
      Alert.alert('Config', 'Set EXPO_PUBLIC_CHAT_URL in .env.');
      return;
    }
    setSending(true);
    setInput('');
    try {
      let token = idToken;
      try {
        token = (await refreshIdToken()) ?? idToken;
      } catch {
        /* keep */
      }
      const result = await sendChatMessage(token, character, text);
      if (character !== 'family' && 'reply' in result) {
        const payload =
          result.audio ??
          (TTS_URL
            ? await synthesizeSpeech(
                token,
                character as Exclude<Character, 'family'>,
                result.reply,
              )
            : null);
        if (payload?.audioBase64) {
          await playBase64Mp3(payload.audioBase64);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Send failed', msg);
    } finally {
      setSending(false);
    }
  }, [input, user, idToken, character, refreshIdToken]);

  if (authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isFirebaseConfigured() || !user) {
    return (
      <View style={styles.centered}>
        <Text style={styles.help}>
          Add Firebase keys to .env (see .env.example) and restart Expo.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}>
      <View style={styles.topAvatarWrap}>
        {character === 'family' ? (
          <View style={[styles.avatarCircle, styles.familyTopAvatar]}>
            <Text style={styles.familyTopAvatarText}>👨‍👩‍👧</Text>
          </View>
        ) : (
          <CharacterAvatar character={character} size={60} showBadge />
        )}
        <Text style={styles.title}>
          {character === 'family' ? 'Family chat' : AVATAR_META[character].name}
        </Text>
      </View>
      <View style={styles.modeRow}>
        {MODES.map((m) => (
          <Pressable
            key={m.key}
            style={[
              styles.modeChip,
              character === m.key && styles.modeChipActive,
            ]}
            onPress={() => setCharacter(m.key)}>
            <Text
              style={[
                styles.modeChipText,
                character === m.key && styles.modeChipTextActive,
              ]}>
              {m.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        style={styles.list}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          if (character === 'family' && item.role === 'assistant' && 'mom' in item) {
            const rows: { c: SoloCharacter; text: string }[] = [
              { c: 'mom', text: item.mom },
              { c: 'dad', text: item.dad },
              { c: 'maher', text: item.maher },
              { c: 'mjeed', text: item.mjeed },
            ];
            return (
              <View>
                {rows.map((row) => (
                  <View key={`${item.id}-${row.c}`} style={styles.aiRow}>
                    <CharacterAvatar character={row.c} size={40} showBadge={row.c === 'dad'} />
                    <View style={[styles.bubble, styles.bubbleAssistant, styles.bubbleFamily]}>
                      <Text style={styles.familyTag}>{AVATAR_META[row.c].name}</Text>
                      <Text style={styles.bubbleText}>{row.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            );
          }
          const m = item as MomDadMessage;
          const isUser = m.role === 'user';
          if (isUser) {
            return (
              <View style={styles.userRow}>
                <View style={[styles.bubble, styles.bubbleUser]}>
                  <Text style={styles.bubbleTextUser}>{m.content}</Text>
                </View>
              </View>
            );
          }
          return (
            <View style={styles.aiRow}>
              <CharacterAvatar
                character={character as SoloCharacter}
                size={40}
                showBadge={character === 'dad'}
              />
              <View style={[styles.bubble, styles.bubbleAssistant]}>
                <Text style={styles.bubbleText}>{m.content}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No messages yet. Say hello below.</Text>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor="#999"
          editable={!sending}
          multiline
          maxLength={4000}
        />
        <Pressable
          style={[styles.sendBtn, sending && styles.sendDisabled]}
          onPress={() => void send()}
          disabled={sending || !input.trim()}>
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 48,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  help: {
    textAlign: 'center',
    color: '#666',
    fontSize: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 10,
  },
  topAvatarWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  modeChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#eee',
  },
  modeChipActive: {
    backgroundColor: '#111',
  },
  modeChipText: {
    fontWeight: '600',
    color: '#333',
  },
  modeChipTextActive: {
    color: '#fff',
  },
  list: {
    flex: 1,
  },
  empty: {
    color: '#999',
    textAlign: 'center',
    marginTop: 24,
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 10,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  bubble: {
    maxWidth: '88%',
    padding: 12,
    borderRadius: 18,
  },
  bubbleUser: {
    backgroundColor: '#111',
    borderBottomRightRadius: 6,
  },
  bubbleAssistant: {
    backgroundColor: '#e9effc',
    borderBottomLeftRadius: 6,
  },
  bubbleFamily: {
    maxWidth: '83%',
  },
  familyTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#456',
    marginBottom: 4,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
  bubbleTextUser: {
    fontSize: 16,
    lineHeight: 22,
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: '#111',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  avatarCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#ddd',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  badge: {
    fontSize: 12,
    marginTop: -2,
  },
  familyTopAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ececec',
  },
  familyTopAvatarText: {
    fontSize: 28,
  },
});
