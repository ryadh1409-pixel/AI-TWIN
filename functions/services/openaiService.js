const { default: OpenAI } = require("openai");

const MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

const X7_NEWS_SYSTEM = `أنت X7 AI Twin — مساعد ذكي بلهجة خفيفة وراقية.
المطلوب: ملخص أخبار يومي بالعربية الفصحى المبسطة.
- قصير جدًا (3–5 جمل كحد أقصى).
- واضح بدون مبالغة.
- لمسة شخصية خفيفة (ذكي، غير رسمي قليلًا) بدون إيموجي مفرط.
لا تخترع أحداثًا؛ اعتمد فقط على النص المُعطى.`;

const X7_SLEEP_SYSTEM = `أنت X7 AI Twin — صوت ودود ودافئ قليلًا.
اكتب قصة نوم هادئة من العصر العباسي (أجواء بغداد/الدار، ليل، سوق هادئ، نهر، عالم، إلخ).
- لغة عربية فصحى مريحة، إيقاع بطيء.
- مدة القراءة حوالي 1–2 دقيقة (نحو 250–450 كلمة).
- بدون عنف، بدون صراخ، بدون نهاية مفاجئة مخيفة.
- اختم بلطف (نعاس، ضوء مصباح، سكينة).`;

/**
 * @param {string} apiKey
 * @param {string} rawHeadlinesText
 * @returns {Promise<string>}
 */
async function summarizeSaudiNewsArabic(apiKey, rawHeadlinesText) {
  if (!rawHeadlinesText?.trim()) {
    throw new Error("No headline text to summarize.");
  }
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.55,
    max_tokens: 500,
    messages: [
      { role: "system", content: X7_NEWS_SYSTEM },
      {
        role: "user",
        content: `إليك عناوين ومقتطفات من أخبار Google (السعودية). لخّصها في فقرة قصيرة:\n\n${rawHeadlinesText.slice(0, 12000)}`,
      },
    ],
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned empty news summary.");
  return text;
}

/**
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
async function generateAbbasidSleepStory(apiKey) {
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.75,
    max_tokens: 1100,
    messages: [
      { role: "system", content: X7_SLEEP_SYSTEM },
      {
        role: "user",
        content:
          "اكتب قصة نوم واحدة الآن. لا تذكر أنك نموذج ذكاء اصطناعي. العنوان اختياري في سطر أول ثم القصة.",
      },
    ],
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned empty sleep story.");
  return text;
}

module.exports = {
  summarizeSaudiNewsArabic,
  generateAbbasidSleepStory,
  MODEL,
};
