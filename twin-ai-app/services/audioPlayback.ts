import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

let activeSound: Audio.Sound | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fadeIn(sound: Audio.Sound) {
  const steps = [0.2, 0.4, 0.6, 0.8, 1];
  for (const v of steps) {
    await sleep(45);
    try {
      await sound.setVolumeAsync(v);
    } catch {
      break;
    }
  }
}

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
    { shouldPlay: true, volume: 0 },
  );
  activeSound = sound;
  void fadeIn(sound);
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
