import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Used when Expo cannot infer the dev machine host (e.g. custom clients). */
const FALLBACK_DEV_IP = '192.168.1.5';

/**
 * Resolve the machine running Metro / the dev server (works in Expo Go on a real device).
 * Replace FALLBACK_DEV_IP if needed when debugger host is unavailable.
 */
export function resolveApiHost(): string {
  if (Platform.OS === 'web') {
    return 'localhost';
  }

  const debuggerHost =
    Constants.expoGoConfig?.debuggerHost ??
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ??
    (
      Constants as {
        manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
      }
    ).manifest2?.extra?.expoGo?.debuggerHost;

  if (debuggerHost && typeof debuggerHost === 'string') {
    const host = debuggerHost.split(':')[0]?.trim();
    if (host) {
      return host;
    }
  }

  return FALLBACK_DEV_IP;
}

export const API_URL = `http://${resolveApiHost()}:3000`;

/**
 * POST recorded audio to the Twin AI backend. Returns raw MPEG audio bytes.
 */
export async function uploadVoiceAudio(localFileUri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    console.error('uploadVoiceAudio: not supported on web');
    throw new Error('Use the Expo Go app on a physical device or simulator.');
  }

  console.log('Sending audio to:', API_URL + '/upload');
  console.log('Request start — POST /upload');

  const formData = new FormData();
  formData.append('file', {
    uri: localFileUri,
    name: 'recording.wav',
    type: 'audio/wav',
  } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
  } catch (error) {
    console.error('Upload network failure:', error);
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  console.log('Upload response:', {
    ok: response.ok,
    status: response.status,
    contentType,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error('Upload error body:', errText.slice(0, 600));
    throw new Error(
      `Upload failed (${response.status}): ${errText.slice(0, 240) || 'no body'}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  console.log('Upload success, audio byteLength:', arrayBuffer.byteLength);
  return arrayBuffer;
}
