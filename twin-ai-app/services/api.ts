/** Full HTTPS URL of the deployed `transcribe` function (no trailing slash). */
export const TRANSCRIBE_URL = (process.env.EXPO_PUBLIC_TRANSCRIBE_URL ?? '')
  .trim()
  .replace(/\/$/, '');

console.log(
  'EXPO_PUBLIC_TRANSCRIBE_URL →',
  TRANSCRIBE_URL ? '(set)' : '(unset)',
);

export type TranscribeResult = {
  text: string;
};

export const transcribeAudio = async (
  uri: string,
): Promise<TranscribeResult> => {
  if (!uri) {
    throw new Error('Missing recording URI.');
  }
  if (!TRANSCRIBE_URL) {
    throw new Error(
      'Set EXPO_PUBLIC_TRANSCRIBE_URL in .env to your function URL (e.g. https://us-central1-PROJECT.cloudfunctions.net/transcribe), then restart Expo: npx expo start -c',
    );
  }

  const formData = new FormData();
  formData.append('audio', {
    uri,
    name: 'audio.m4a',
    type: 'audio/m4a',
  } as any);

  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as { error?: string };
      detail = errJson?.error || '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 400);
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as TranscribeResult;
  if (typeof data?.text !== 'string') {
    throw new Error('Invalid response: expected JSON { text: string }.');
  }
  return data;
};
