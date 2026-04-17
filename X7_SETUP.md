# X7 AI Twin — setup

## Layout

```
functions/
  index.js                 # exports: transcribe, chat, tts, dailyNewsDigest, sleepStory
  services/
    openaiService.js       # gpt-4o-mini: news summary + sleep story
    newsService.js         # Google News RSS (Saudi Arabia)
    pushService.js         # push placeholder (wire FCM/Expo later)
```

## Firestore

- `daily_reports/{docId}` — `{ type: "news", content: string, createdAt: timestamp }`
- `users/{uid}` — e.g. `{ displayName, email?, createdAt, preferences? }` (owner read/write per rules)

## Secrets (production)

```bash
cd functions && npm install
firebase login
firebase use <project-id>
firebase functions:secrets:set OPENAI_API_KEY
```

## Deploy

```bash
firebase deploy --only functions:dailyNewsDigest,functions:sleepStory,firestore:rules
```

## HTTP

- **Sleep story:** `POST https://<region>-<project>.cloudfunctions.net/sleepStory/sleep-story`  
  Body: `{}`  
  Response: `{ story, model }`

## Schedule

- **dailyNewsDigest:** cron `0 21 * * *`, timezone `America/Toronto` (9 PM Toronto).

## Local check (syntax)

```bash
node --check functions/index.js
```
