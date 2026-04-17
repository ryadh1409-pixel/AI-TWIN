import { Audio } from 'expo-av';
import { textToSpeech } from './api';

/** Antoni — smooth, confident male (ElevenLabs) */
const ELEVENLABS_VOICE_ID = 'ErXwobaYiN019PkySvjV';

function toBase64(buffer) {
  const binary = new Uint8Array(buffer).reduce(
    (data, byte) => data + String.fromCharCode(byte),
    '',
  );
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(binary);
  }

  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = binary;
  let output = '';
  for (
    let block = 0, charCode, i = 0, map = chars;
    str.charAt(i | 0) || ((map = '='), i % 1);
    output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))
  ) {
    charCode = str.charCodeAt((i += 3 / 4));
    block = (block << 8) | charCode;
  }
  return output;
}

async function playFromUri(uri) {
  const { sound } = await Audio.Sound.createAsync({ uri });
  await sound.playAsync();
}

async function playFromElevenLabsBlob(blob) {
  let uri = '';
  if (
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    uri = URL.createObjectURL(blob);
  } else {
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = toBase64(arrayBuffer);
    uri = `data:audio/mpeg;base64,${base64}`;
  }
  await playFromUri(uri);
}

/**
 * Speak text: ElevenLabs (Antoni) first, then backend POST /tts via `textToSpeech`.
 */
export async function speak(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return;

  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY?.trim();

  if (apiKey) {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: trimmed,
            model_id: 'eleven_multilingual_v2',
          }),
        },
      );

      if (response.ok) {
        const blob = await response.blob();
        await playFromElevenLabsBlob(blob);
        return;
      }
      const detail = await response.text();
      console.warn('[elevenlabs] HTTP', response.status, detail);
    } catch (error) {
      console.warn('[elevenlabs] error', error);
    }
  }

  try {
    const payload = await textToSpeech(trimmed, 'X');
    const uri = `data:${payload.audioMimeType};base64,${payload.audioBase64}`;
    await playFromUri(uri);
  } catch (error) {
    console.error('[tts] fallback failed', error);
    throw error;
  }
}
