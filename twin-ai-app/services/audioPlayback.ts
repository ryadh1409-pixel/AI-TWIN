import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system';

let activePlayer: ReturnType<typeof createAudioPlayer> | null = null;

export async function playBase64Mp3(audioBase64: string): Promise<void> {
  if (!audioBase64) return;
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;

  const fileUri = `${dir}my-family-ai-tts-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, audioBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
  });

  if (activePlayer) {
    try {
      activePlayer.pause();
      activePlayer.remove();
    } catch {
      /* ignore */
    }
    activePlayer = null;
  }

  const player = createAudioPlayer({ uri: fileUri }, { updateInterval: 250 });
  activePlayer = player;

  const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    if (!status.didJustFinish) return;
    sub.remove();
    try {
      player.remove();
    } catch {
      /* ignore */
    }
    if (activePlayer === player) {
      activePlayer = null;
    }
    void FileSystem.deleteAsync(fileUri, { idempotent: true });
  });

  player.volume = 1;
  player.play();
}
