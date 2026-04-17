# X7 AI Twin — Telegram

## Setup

```bash
cd telegram-bot
cp .env.example .env
# Edit .env: TELEGRAM_BOT_TOKEN and OPENAI_API_KEY
npm install
npm start
```

## Env

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_CHAT_MODEL` | Default `gpt-4o-mini` |

## Behavior

- **Chat:** any text → OpenAI (entrepreneur coach, supportive, light humor).
- **Sleep:** messages containing `بنام` or `sleep` → Abbasid-style bedtime story.
- **Daily news:** 9:00 PM **America/Toronto**, Saudi Google News RSS → Arabic summary → all users who ran `/start` (`data/subscribers.json`).
- **`/stop`** unsubscribes from daily news.

## Security

If a bot token was ever committed or shared, **revoke it in BotFather** and create a new token.
