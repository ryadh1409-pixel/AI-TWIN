import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';

export type VoicePlaybackCallbacks = {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
};

/**
 * Play MP3 (or other) returned from POST /tts as base64 using a data URI (expo-audio).
 */
export async function playAudioFromBase64(
  audioBase64: string,
  mimeType: string,
  callbacks: VoicePlaybackCallbacks = {},
): Promise<void> {
  const { onPlaybackStart, onPlaybackEnd } = callbacks;
  const uri = `data:${mimeType};base64,${audioBase64}`;

  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
  });

  const player = createAudioPlayer({ uri }, { updateInterval: 250 });
  const sub = player.addListener(
    'playbackStatusUpdate',
    (status: AudioStatus) => {
      if (status.didJustFinish) {
        onPlaybackEnd?.();
        sub.remove();
        player.remove();
      }
    },
  );

  onPlaybackStart?.();
  player.play();
}
