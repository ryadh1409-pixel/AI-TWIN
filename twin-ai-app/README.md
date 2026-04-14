# My Family AI (Expo app)

Personal AI family app with four personalities:
- Mom (Micheal) — loving, overprotective
- Dad (Colonel) — strict, disciplined tough-love
- Maher (ICU doctor) — direct, urgency and life perspective
- Mjeed (pediatric doctor) — funny, sarcastic, Al Ittihad energy

Includes:
- Voice input (record + Whisper transcription)
- Character chat and family mode
- Voice output (TTS, character-specific voice)
- Firestore memory/profile context injection
- Personality learning updates after every conversation
- Daily check-in notifications (5:00 PM default, per-character toggles)

## Frontend architecture

- `app/setup.tsx`
  - First-time setup (name, age, goals, reminder time, enabled characters)
  - Saves profile + notification preferences
- `app/(tabs)/index.tsx`
  - Voice-first flow: record -> transcribe -> chat -> auto-play AI audio
- `app/(tabs)/chat.tsx`
  - Text chat view + family mode list rendering
- `app/(tabs)/profile.tsx`
  - Profile + memory editor and daily check-in settings block
- `services/api.ts`
  - Calls `/transcribe`, `/chat`, `/tts`
- `services/dailyNotifications.ts`
  - Expo notifications scheduling and character payload routing
- `services/userFirestore.ts`
  - User profile/memory/notification pref read-write

## Backend architecture (Firebase Functions + Express)

- `functions/index.js`
  - `exports.transcribe`: Whisper-compatible transcription endpoint
  - `exports.chat`: chat endpoint supporting single character and `/family-chat`
  - `exports.tts`: character voice synthesis endpoint
- `functions/chatHandlers.js`
  - Character system prompts
  - Context injection from Firestore profile/memory/history
  - Memory learning extraction (`mood`, `preferences`, `importantFacts`, `emotionalState`, `behaviorPatterns`)
  - TTS payload inclusion in single-character chat responses

## Firestore data shape

`users/{uid}` document:
- `profile`: `{ name, age, goals }`
- `memory`: `{ mood, preferences, importantFacts, emotionalState, behaviorPatterns }`
- `notificationPrefs`: `{ enabled, hour, minute, characters: { mom, dad, maher, mjeed } }`
- `updatedAt`

Subcollections:
- `momMessages`
- `dadMessages`
- `maherMessages`
- `mjeedMessages`
- `familyMessages`

## Environment variables

In app `.env`:
- `EXPO_PUBLIC_TRANSCRIBE_URL`
- `EXPO_PUBLIC_CHAT_URL`
- `EXPO_PUBLIC_TTS_URL`
- Firebase `EXPO_PUBLIC_FIREBASE_*` values

In functions secret manager:
- `OPENAI_API_KEY`

Optional function env overrides:
- `OPENAI_CHAT_MODEL` (default: `gpt-4o-mini`)
- `OPENAI_TRANSCRIBE_MODEL` (default: `gpt-4o-mini-transcribe`, fallback `whisper-1`)
- `OPENAI_TTS_MODEL` (default: `gpt-4o-mini-tts`)

## API examples

### POST `/transcribe`
Multipart form with field `audio`.

Response:
```json
{ "text": "انا تعبان اليوم" }
```

### POST `/chat`
Headers:
- `Authorization: Bearer <firebase-id-token>`

Body (single character):
```json
{
  "character": "mom",
  "message": "اليوم كان متعب"
}
```

Response:
```json
{
  "reply": "يا قلبي ليش ما كلمتني بدري؟ أكلت؟ نمت؟ أنا هنا معك 🤍",
  "audio": {
    "audioBase64": "<base64-mp3>",
    "audioMimeType": "audio/mpeg",
    "voice": "shimmer"
  }
}
```

### POST `/family-chat`
Headers:
- `Authorization: Bearer <firebase-id-token>`

Body:
```json
{
  "message": "أنا تعبان"
}
```

Response:
```json
{
  "mom": "تعال أحضنك 🤍",
  "dad": "وش السبب؟ حل المشكلة",
  "maher": "تحرك، الحياة قصيرة 💪",
  "mjeed": "أنت تعبان؟ والاتحاد كسب الليلة 😂⚽"
}
```

### POST `/tts`
Headers:
- `Authorization: Bearer <firebase-id-token>`

Body:
```json
{
  "character": "dad",
  "text": "ركز وخلك منضبط"
}
```

Response:
```json
{
  "audioBase64": "<base64-mp3>",
  "audioMimeType": "audio/mpeg",
  "voice": "onyx"
}
```
