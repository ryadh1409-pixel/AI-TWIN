import { Audio } from 'expo-av';

export type VoicePlaybackCallbacks = {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
};

/**
 * Play MP3 (or other) returned from POST /tts as base64 using a data URI.
 */
export async function playAudioFromBase64(
  audioBase64: string,
  mimeType: string,
  callbacks: VoicePlaybackCallbacks = {},
): Promise<Audio.Sound> {
  const { onPlaybackStart, onPlaybackEnd } = callbacks;
  const uri = `data:${mimeType};base64,${audioBase64}`;

  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });

  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, volume: 1, rate: 1, isMuted: false },
  );
  await sound.setVolumeAsync(1);

  sound.setOnPlaybackStatusUpdate((status) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish) {
      onPlaybackEnd?.();
      void sound.unloadAsync().catch(() => {});
    }
  });

  onPlaybackStart?.();
  await sound.playAsync();
  return sound;
}
