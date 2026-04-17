require("dotenv").config();

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");

const { chatTwin, summarizeNewsArabic, generateSleepStory } = require("./services/openai");
const { fetchSaudiNewsText } = require("./services/news");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN?.trim()) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const SUBSCRIBERS_FILE = path.join(DATA_DIR, "subscribers.json");

function loadSubscribers() {
  try {
    const raw = fs.readFileSync(SUBSCRIBERS_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((id) => typeof id === "number"));
  } catch {
    return new Set();
  }
}

function saveSubscribers(set) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      SUBSCRIBERS_FILE,
      JSON.stringify([...set], null, 2),
      "utf8",
    );
  } catch (e) {
    console.error("saveSubscribers:", e?.message || e);
  }
}

let subscribers = loadSubscribers();

const bot = new TelegramBot(TOKEN, { polling: true });

function isSleepIntent(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim().toLowerCase();
  if (t === "sleep" || /\bsleep\b/i.test(text)) return true;
  if (/بنام|بدي أنام|بدي انام|نوم|قصة نوم/i.test(text)) return true;
  return false;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  subscribers.add(chatId);
  saveSubscribers(subscribers);
  void bot.sendMessage(
    chatId,
    [
      "أهلًا، أنا X7 AI Twin 🤝",
      "اكتب لي أي شيء نتناقش فيه (عمل، فكرة، تخطيط…).",
      "أو اكتب «بنام» أو sleep لقصة نوم هادئة.",
      "تلقّى ملخص أخبار يومي تقريبًا الساعة 9 مساءً بتوقيت تورنتو إذا ضغطت /start (مشتركين في القائمة).",
    ].join("\n"),
  );
});

bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  subscribers.delete(chatId);
  saveSubscribers(subscribers);
  void bot.sendMessage(
    chatId,
    "تم إيقاف ملخص الأخبار اليومي لهذا الحساب. /start للاشتراك مجددًا.",
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  try {
    if (isSleepIntent(text)) {
      await bot.sendChatAction(chatId, "typing");
      const story = await generateSleepStory();
      await bot.sendMessage(chatId, story, { disable_web_page_preview: true });
      return;
    }

    await bot.sendChatAction(chatId, "typing");
    const reply = await chatTwin(text);
    await bot.sendMessage(chatId, reply, { disable_web_page_preview: true });
  } catch (err) {
    console.error("message handler:", err?.message || err);
    await bot.sendMessage(
      chatId,
      "صار خطأ مؤقت. جرّب بعد شوي أو تحقق من المفتاح والشبكة.",
    ).catch(() => {});
  }
});

bot.on("polling_error", (err) => {
  console.error("polling_error:", err?.message || err);
});

/** 9 PM America/Toronto — daily news digest */
cron.schedule(
  "0 21 * * *",
  async () => {
    if (subscribers.size === 0) {
      console.log("[cron] no subscribers; skip news");
      return;
    }
    let raw;
    try {
      raw = await fetchSaudiNewsText();
    } catch (e) {
      console.error("[cron] RSS:", e?.message || e);
      return;
    }
    let summary;
    try {
      summary = await summarizeNewsArabic(raw);
    } catch (e) {
      console.error("[cron] OpenAI summary:", e?.message || e);
      return;
    }

    const header = "📰 X7 — ملخص أخبار اليوم (السعودية)\n\n";
    const body = summary.slice(0, 3900);

    for (const chatId of subscribers) {
      try {
        await bot.sendMessage(chatId, header + body, {
          disable_web_page_preview: true,
        });
      } catch (e) {
        console.error(`[cron] send ${chatId}:`, e?.message || e);
      }
    }
    console.log("[cron] daily news sent to", subscribers.size, "chats");
  },
  { timezone: "America/Toronto" },
);

console.log("X7 AI Twin bot polling… (daily news 21:00 America/Toronto)");
