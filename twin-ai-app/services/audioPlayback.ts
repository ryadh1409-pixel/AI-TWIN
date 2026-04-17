import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

let activeSound: Audio.Sound | null = null;

export async function playBase64Mp3(audioBase64: string): Promise<void> {
  if (!audioBase64) return;
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;

  const fileUri = `${dir}my-family-ai-tts-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, audioBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: Audio.InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: Audio.InterruptionModeAndroid.DuckOthers,
  });

  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch {
      // ignore best-effort cleanup
    }
    activeSound = null;
  }

  const { sound } = await Audio.Sound.createAsync(
    { uri: fileUri },
    {
      shouldPlay: true,
      volume: 1.0,
      rate: 1.0,
      isMuted: false,
    },
  );
  activeSound = sound;
  await sound.setVolumeAsync(1.0);
  await sound.setRateAsync(1.0, true);
  await sound.setIsMutedAsync(false);

  sound.setOnPlaybackStatusUpdate((status) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish) {
      void sound.unloadAsync();
      if (activeSound === sound) {
        activeSound = null;
      }
      void FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
  });
}
