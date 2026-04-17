const OpenAI = require("openai");

const MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

const TWIN_SYSTEM = `أنت X7 AI Twin على تيليغرام.
شخصية:
- ذكي ومباشر، مع لمسة فكاهة خفيفة أحيانًا.
- داعم ومحفّز؛ تتحدث كـ coach لروّاد الأعمال.
- عربي طبيعي (فصحى مبسطة أو خليجي حسب سياق المستخدم)؛ يمكنك خلط إنجليزي قليلًا إذا المستخدم يخلط.
- لا تبالغ في الإيموجي. لا تذكر أنك نموذج ذكاء اصطناعي إلا إذا سُئلت.
- قصير إلى متوسط في الردود ما لم يطلب المستخدم التفصيل.`;

const NEWS_SYSTEM = `أنت X7. لخّص الأخبار التالية بالعربية في 3–5 جمل كحد أقصى.
- واضح، بدون مبالغة.
- لمسة شخصية خفيفة (ذكي، غير رسمي قليلًا).
لا تخترع أخبارًا؛ اعتمد على النص المعطى فقط.`;

const SLEEP_SYSTEM = `أنت X7. اكتب قصة نوم هادئة من أجواء العصر العباسي (بغداد/الليل/السوق/النهر).
- عربية فصحى مريحة، إيقاع بطيء.
- قصيرة (قراءة دقيقة أو دقيقتين كحد أقصى).
- بدون عنف أو نهاية مفزعة. اختم بلطف.`;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  return new OpenAI({ apiKey: key });
}

/**
 * @param {string} userMessage
 * @param {{ role: string, content: string }[]} [history]
 */
async function chatTwin(userMessage, history = []) {
  const openai = getClient();
  const messages = [
    { role: "system", content: TWIN_SYSTEM },
    ...history.slice(-12),
    { role: "user", content: userMessage },
  ];
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.75,
    max_tokens: 900,
    messages,
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty chat reply from OpenAI");
  return text;
}

/**
 * @param {string} rawNewsText
 */
async function summarizeNewsArabic(rawNewsText) {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.5,
    max_tokens: 600,
    messages: [
      { role: "system", content: NEWS_SYSTEM },
      {
        role: "user",
        content: `ملخص أخبار اليوم من Google News (السعودية):\n\n${rawNewsText.slice(0, 12000)}`,
      },
    ],
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty news summary from OpenAI");
  return text;
}

async function generateSleepStory() {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.8,
    max_tokens: 1000,
    messages: [
      { role: "system", content: SLEEP_SYSTEM },
      {
        role: "user",
        content:
          "اكتب قصة نوم واحدة الآن. لا تذكر أنك ذكاء اصطناعي.",
      },
    ],
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty sleep story from OpenAI");
  return text;
}

module.exports = {
  chatTwin,
  summarizeNewsArabic,
  generateSleepStory,
  MODEL,
};
