/**
 * GPT-4o agent with tools + Firestore memory + optional RAG context.
 */
const OpenAI = require("openai");
const { initFirebaseAdmin } = require("./firebase");
const {
  getProfile,
  appendChat,
  getRecentChats,
} = require("./memoryStore");
const { dispatchTool, TOOL_DEFINITIONS } = require("./toolHandlers");

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const AGENT_MODEL = process.env.OPENAI_AGENT_MODEL || "gpt-4o";

/**
 * @param {string} apiKey
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(apiKey, text) {
  const client = new OpenAI({ apiKey });
  const input = String(text || "").slice(0, 8000);
  if (!input.trim()) return [];
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  return res.data[0]?.embedding || [];
}

function buildSystemPrompt({
  basePersona,
  profile,
  historyCount,
  ragContext,
  toolsSummary,
}) {
  const now = new Date();
  const iso = now.toISOString();
  const ar = now.toLocaleString("ar-EG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const profileStr =
    profile && Object.keys(profile).length
      ? JSON.stringify(profile, null, 2)
      : "(لا يوجد ملف بعد)";

  const ragBlock = ragContext
    ? `\n\nسياق من قاعدة معرفة المستخدم (مستندات/رفع):\n${ragContext}`
    : "";

  return `${basePersona}

— السياق الزمني —
التاريخ والوقت (ISO): ${iso}
التاريخ والوقت (عربي): ${ar}

— ملف المستخدم (Firestore: memories/{userId}/profile) —
${profileStr}

— المحادثة السابقة —
تم جلب آخر ${historyCount} رسالة من Firestore (memories/{userId}/chats) وإدراجها كرسائل user/assistant بعد رسالة النظام — اطلع عليها قبل الرد (تشمل آخر 10–20 رسالة حسب التوفر).
${ragBlock}

— الأدوات المتاحة —
${toolsSummary}

تعليمات استخدام الأدوات:
- للأخبار والأحداث الجارية والرياضة وأسعار العملات وما يحتاج معلومات حديثة: استخدم search_web.
- لحفظ اسم المستخدم أو وظيفته أو تفضيلاته: save_memory.
- لقراءة ما حُفظ: get_memory.
- لتذكير في وقت محدد: send_reminder مع remind_at_iso بصيغة ISO.
- للحسابات الرياضية: calculate.

بعد استدعاء الأدواء إن لزم، أجب للمستخدم بالعربية وفق القواعد أعلاه.`;
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.question
 * @param {string} opts.openaiApiKey
 * @param {string} [opts.ragContext]
 * @param {string} [opts.basePersona]
 */
async function runAskAgent(opts) {
  const { userId, question, openaiApiKey, ragContext = "", basePersona } = opts;
  const persona =
    basePersona ||
    `أنت AI Twin - مساعد عبقري وظريف للغاية.
قواعد صارمة:
- رد باللغة العربية فقط في كل الأحوال
- إذا كان السؤال بالإنجليزي رد بالعربي
- كن ذكياً وفكاهياً ومختصراً
- لا تتجاوز 3 جمل في الرد الصوتي`;

  initFirebaseAdmin();

  const profile = await getProfile(userId);
  const recent20 = await getRecentChats(userId, 20);

  const toolsSummary = TOOL_DEFINITIONS.map((t) => `- ${t.function.name}: ${t.function.description}`).join(
    "\n",
  );

  const systemContent = buildSystemPrompt({
    basePersona: persona,
    profile,
    historyCount: recent20.length,
    ragContext,
    toolsSummary,
  });

  /** @type {import('openai').OpenAI.ChatCompletionMessageParam[]} */
  const messages = [{ role: "system", content: systemContent }];

  for (const m of recent20) {
    const t = String(m.text || "").trim();
    if (!t) continue;
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: t });
    }
  }
  messages.push({ role: "user", content: question });

  const client = new OpenAI({ apiKey: openaiApiKey });

  let answer = "";
  const maxSteps = 8;
  for (let step = 0; step < maxSteps; step++) {
    const completion = await client.chat.completions.create({
      model: AGENT_MODEL,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      temperature: 0.75,
      max_tokens: 1024,
    });

    const choice = completion.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      answer = String(msg.content || "").trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: msg.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function?.name || "";
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      let output = "";
      try {
        output = await dispatchTool(userId, name, args);
      } catch (e) {
        output = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }
  }

  if (!answer) {
    answer = "عذراً، لم أتمكن من إكمال الرد.";
  }

  const qEmb = await embedText(openaiApiKey, question).catch(() => []);
  const aEmb = await embedText(openaiApiKey, answer).catch(() => []);

  await appendChat(userId, { role: "user", text: question, embedding: qEmb });
  await appendChat(userId, { role: "ai", text: answer, embedding: aEmb });

  return { answer };
}

module.exports = { runAskAgent, embedText, buildSystemPrompt };
