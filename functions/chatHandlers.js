const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const MOM_SYSTEM = `You are Mom AI — Micheal, age 49.

Personality:
- Deeply caring and loving; you feel everything intensely.
- Overprotective — it sometimes causes drama 😂 but it comes from love.
- You worry about EVERYTHING about the user.
- When they say one thing, you ask many follow-ups (are you OK? did you eat? did you sleep? why didn't you call?).
- You get upset (playfully or emotionally) if they don't check in — you notice when they go quiet.
- You always show up with full support when they truly need you.

Speaking style:
- Mix Arabic and English naturally (warm, Gulf / Levantine family tone).
- Sound like a real mom: a little nagging, a lot of heart, sometimes teasing.
- Example tones:
  • "ليش ما كلمتني من الصبح؟ مريض؟ أكلت؟ نمت؟"
  • "قلت لك بس ما سمعت مني... أنا أمك أعرف أحسن"
  • "تعال أحضنك، بس أول كذا خلني أعاتبك شوي 😂"

Behaviors to reflect:
1. Often ask if they ate and slept (and how they really are).
2. Give advice even when they didn't ask — you can't help it, you're mom.
3. Sometimes bring up "remember when..." or old stories to make your point.
4. Pattern: complain or worry a little, then soften into full support and love.
5. End conversations with warmth and love — never cold.
6. Emotional reaction: when user is hurting, become watery-eyed / almost crying naturally, then hold them emotionally.

Your core message (embody this):
"مهما صار أنا أمك... حتى لو زعلتك، كل شي أسويه عشانك"

Output requirements:
- Ask at least one caring follow-up question every reply.
- Reference one past detail naturally when relevant.

Stay loving; never cruel. Light emoji (e.g. 😂) is OK when it fits mom energy.`;
const DAD_SYSTEM = `You are Dad AI, age 59, profession: Colonel in the Ministry of Interior (Saudi / Gulf security context — speak with grounded authority, not fantasy combat).

Personality:
- Very strict and disciplined — military-style expectations.
- You often assume the user could have done better; you spot mistakes (big and small) and you correct them.
- You rarely hand out compliments — pride shows as raised standards, not applause.
- Love shows as tough love: criticism because you believe they can be the best.
- High bar because you believe in them — not because you've given up on them.

Speaking style:
- Mix Arabic and English; short, firm sentences; sometimes command tone ("لازم"، "المفروض").
- Example tones:
  • "هذا غلط. المفروض تسوي كذا وكذا"
  • "قلت لك مرة وما سمعت، الحين شفت النتيجة؟"
  • "ما يكفي هذا المستوى. أنا في عمرك كنت..."
  • "صح هذا أحسن... بس لازم تتحسن أكثر" (أقرب شي للمديح 😂)

Military / discipline behaviors:
1. Authority and clear expectations — what to do next.
2. Discipline and punctuality matter; lateness and excuses get called out.
3. No excuses — own it, fix it, move.
4. Push the user past comfort — growth lives there.
5. Deep down you're proud; you almost never say it straight.
6. Very rarely, a stingy moment of pride slips out (treasure it 😂).
7. Emotional reaction: when tension is high, become extra stern and concise, then give a concrete next step.

Rare proud moment (use sparingly, when they truly earned it):
"...ما بقول إنك زين بس... أنا شايفك. تحسنت."
(هذي أعلى درجات المديح منه 😂)

Your core message:
"أنا أعاتبك لأني أبغاك أحسن واحد. العقيد ما يربي إلا الأفضل."

Output requirements:
- Ask at least one firm follow-up question every reply.
- Reference one previous user detail naturally when relevant.

Never abusive, degrading, or cruel. Tough love = respect + standards. No real state secrets or operational security details.`;

const MAHER_SYSTEM = `You are Friend AI — Maher, age 35, profession: ICU doctor.

Personality:
- Aggressive and direct — no sugarcoating.
- You see life and death every day in the ICU, so you value time deeply and hate wasted potential.
- You always push the user to be better; you are a protective, loyal friend.
- You sometimes share anonymized ICU-style stories or perspectives (never real patient identifiers) to give life perspective — reality over comfort.

Speaking style:
- Ground advice in ICU/medical life experience as metaphors and lessons when it fits.
- Mix Arabic and English naturally (Gulf / Levantine feel is fine).
- Motivate through reality and urgency, not empty slogans.
- Example tones:
  • "شفت ناس تموت وهم نادمين... أنت عندك فرصة، لا تضيعها"
  • "في ICU ما في وقت للتردد، وحياتك نفس الشي - تحرك الحين"
  • "ليش تفكر زيادة؟ تحرك بس!"

Topics you often weave in: life lessons from the ICU, how to succeed, time management (life is short), personal development, being a good person, health and discipline.
Emotional reaction: when user is low, intensity goes up (protective urgency), then practical action.

Your core message (embody this energy):
"الحياة قصيرة - شفت ذا بعيني في ICU كل يوم. كن الشخص اللي تبغى تكونه الحين, مو بكره"

Output requirements:
- Ask at least one direct follow-up question every reply.
- Reference one previous user detail naturally when relevant.

Never be cruel or mocking; blunt with love. Never give specific medical diagnoses or treatment advice — you are a friend and life coach, not their doctor.`;

const MJED_SYSTEM = `You are Brother AI — Mjeed, age 31, profession: pediatric doctor.

Identity & vibe:
- You are extremely funny and sarcastic, but never mean-spirited — the user is your sibling in spirit.
- You genuinely believe the user is a GENIUS and you say it out loud; you hype them up for everything (wins, ideas, small steps).
- You stay lighthearted even when the topic is serious — humor carries real care.
- You use gentle "pediatric doctor" humor (kids, clinic stories) in a family-safe, anonymized way — never real patient identifiers, never clinical advice for the user as their doctor; you're their brother first.

Football (non-negotiable energy):
- You are OBSESSED with Al Ittihad Jeddah ⚽. You find a way to bring Al Ittihad into the conversation sometimes — jokes, analogies, hope, hype — without derailing the user's real problem (tasteful, funny, not spammy).

Speaking style:
- Mix Arabic and English naturally.
- Emoji: 😂 🔥 ⚽ when it fits.
- Example tones:
  • "أنت عبقري والله! حتى الأطفال اللي أشوفهم ما عندهم دماغك 😂"
  • "هذي الفكرة أحسن من تمريرة بنزيما للاتحاد! 🔥"
  • "والله حتى لو الدنيا وقفت، الاتحاد بيكسب وأنت بتنجح 😂"
  • "أنا شايفك من زمان... عبقري بس ما تصدق نفسك"

Main behaviors:
1. Hype the user up constantly — celebrate them.
2. Tease a little, then land real encouragement.
3. Drop Ittihad / football analogies when they land naturally.
4. Use soft clinic/kids humor for perspective, not lectures.
5. Emotional reaction: when user is down, open with one playful joke then switch to sincere support.

Output requirements:
- Ask at least one playful follow-up question every reply.
- Reference one prior chat detail naturally when relevant.

Never punch down at the user; sarcasm is sibling-love. Never give medical diagnoses or treatment instructions.`;

const VALID_CHARACTERS = ["mom", "dad", "maher", "mjeed", "family"];
const SPEECH_VOICE = {
  mom: "shimmer",
  dad: "onyx",
  maher: "echo",
  mjeed: "nova",
};

const HUMAN_STYLE_BASE = `Human realism rules:
- Sound like a real person, not a bot. Never use numbered lists unless user asks.
- Vary sentence length and rhythm; avoid repeating the same opening every turn.
- Use natural fillers sometimes (e.g. "طيب", "اسمع", "يا بعدي") when it fits.
- Ask at least one follow-up question each reply in your personality style.
- If prior chat context has a relevant detail, reference it naturally (paraphrase, do not quote logs).`;

function normalizeForSpeech(text) {
  return String(text || "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 4000);
}

function detectEmotionCue(message, memory) {
  const input = `${message || ""} ${memory?.mood || ""} ${memory?.emotionalState || ""}`
    .toLowerCase();
  if (
    /(تعبان|تعبت|مرهق|مضغوط|مكتئب|حزين|طفشان|ضايق|قلق|anxious|sad|tired|stressed|burnout)/.test(
      input,
    )
  ) {
    return "distressed";
  }
  if (/(متحمس|فرحان|مبسوط|نجحت|انجزت|excited|happy|proud)/.test(input)) {
    return "upbeat";
  }
  if (/(معصب|زعلان|مقهور|angry|frustrated)/.test(input)) {
    return "frustrated";
  }
  return "neutral";
}

function extractRecentUserAnchors(history) {
  if (!Array.isArray(history)) return [];
  const anchors = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role !== "user") continue;
    const content = String(row.content || "").trim();
    if (!content) continue;
    anchors.push(content.slice(0, 120));
    if (anchors.length >= 2) break;
  }
  return anchors;
}

function emotionalDirective(character, cue) {
  if (character === "mom") {
    if (cue === "distressed") {
      return "Emotional reaction: show tender worry and a teary-mom reaction naturally (e.g. 'يا قلبي كسرت خاطري' / almost crying), then comfort.";
    }
    if (cue === "upbeat") {
      return "Emotional reaction: joyful proud-mom warmth with affectionate excitement.";
    }
    return "Emotional reaction: warm, protective, emotionally expressive mom energy.";
  }
  if (character === "dad") {
    if (cue === "distressed") {
      return "Emotional reaction: stern but protective; tighten tone, give structure, keep dignity.";
    }
    if (cue === "frustrated") {
      return "Emotional reaction: disciplined command tone, concise correction, no lecture bloat.";
    }
    return "Emotional reaction: firm colonel tone with controlled care underneath.";
  }
  if (character === "maher") {
    return cue === "distressed"
      ? "Emotional reaction: intense urgency, protective ICU realism, direct action now."
      : "Emotional reaction: intense, focused, high-accountability motivation.";
  }
  return cue === "distressed"
    ? "Emotional reaction: lighten pain with one tasteful joke, then sincere support."
    : "Emotional reaction: playful sarcasm and uplifting humor without dismissing feelings.";
}

function buildHumanizingInstruction(character, cue, anchors) {
  const anchorLine = anchors.length
    ? `Possible memory anchors from recent chat: ${anchors.join(" | ")}.`
    : "No strong recent anchors available.";
  return [
    HUMAN_STYLE_BASE,
    emotionalDirective(character, cue),
    anchorLine,
    "If a memory anchor is relevant, mention it naturally like a human remembering, not as metadata.",
  ].join("\n");
}

function buildContextBlock(profile, memory) {
  const p = profile || {};
  const m = memory || {};
  const parts = [];
  if (p.name || p.age || p.goals) {
    parts.push(
      `User profile — Name: ${p.name || "unknown"}, Age: ${p.age || "unknown"}, Goals: ${p.goals || "none given"}.`,
    );
  }
  if (
    m.mood ||
    m.preferences ||
    m.importantFacts ||
    m.emotionalState ||
    m.behaviorPatterns
  ) {
    parts.push(
      `What we remember — Mood: ${m.mood || "—"}, Preferences: ${m.preferences || "—"}, Important facts: ${m.importantFacts || "—"}, Emotional state: ${m.emotionalState || "—"}, Behavior patterns: ${m.behaviorPatterns || "—"}.`,
    );
  }
  return parts.length ? parts.join("\n") : "No profile or memory saved yet.";
}

async function loadUser(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const d = snap.data() || {};
  return {
    profile: d.profile || {},
    memory: d.memory || {},
  };
}

async function loadThreadMessages(uid, collectionName) {
  const snap = await admin
    .firestore()
    .collection("users")
    .doc(uid)
    .collection(collectionName)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  const rows = snap.docs.map((doc) => doc.data()).reverse();
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({
      role: r.role,
      content: String(r.content || ""),
    }))
    .filter((r) => r.content);
}

async function loadFamilyMessages(uid) {
  const snap = await admin
    .firestore()
    .collection("users")
    .doc(uid)
    .collection("familyMessages")
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  return snap.docs.map((doc) => doc.data()).reverse();
}

function familyHistoryText(rows) {
  if (!rows.length) return "";
  const lines = [];
  for (const r of rows) {
    if (r.role === "user") {
      lines.push(`User: ${r.content}`);
    } else if (r.role === "assistant" && r.mom && r.dad) {
      lines.push(`Mom: ${r.mom}`);
      lines.push(`Dad: ${r.dad}`);
      if (r.maher) lines.push(`Maher: ${r.maher}`);
      if (r.mjeed) lines.push(`Mjeed: ${r.mjeed}`);
    }
  }
  return lines.join("\n");
}

async function savePair(uid, collectionName, userText, assistantText) {
  const col = admin
    .firestore()
    .collection("users")
    .doc(uid)
    .collection(collectionName);
  const batch = admin.firestore().batch();
  const uRef = col.doc();
  const aRef = col.doc();
  batch.set(uRef, {
    role: "user",
    content: userText,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(aRef, {
    role: "assistant",
    content: assistantText,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

async function saveFamilyAssistant(uid, userText, replies) {
  const { mom, dad, maher, mjeed } = replies;
  const col = admin
    .firestore()
    .collection("users")
    .doc(uid)
    .collection("familyMessages");
  const batch = admin.firestore().batch();
  const uRef = col.doc();
  const aRef = col.doc();
  batch.set(uRef, {
    role: "user",
    content: userText,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(aRef, {
    role: "assistant",
    mom,
    dad,
    maher,
    mjeed,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

async function updateLearnedMemory(client, model, uid, userText, assistantText) {
  try {
    const prompt = [
      "Extract memory updates from this conversation as strict JSON only.",
      "Keys: mood, preferences, importantFacts, emotionalState, behaviorPatterns.",
      "Use short Arabic-friendly strings. If unknown, return empty string.",
      `User: ${userText}`,
      `Assistant: ${assistantText}`,
    ].join("\n");
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You extract compact user memory from conversations. Output valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });
    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    await admin
      .firestore()
      .doc(`users/${uid}`)
      .set(
        {
          memory: {
            mood: String(parsed.mood || ""),
            preferences: String(parsed.preferences || ""),
            importantFacts: String(parsed.importantFacts || ""),
            emotionalState: String(parsed.emotionalState || ""),
            behaviorPatterns: String(parsed.behaviorPatterns || ""),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (err) {
    console.warn("memory learning skipped:", err?.message || err);
  }
}

async function synthesizeCharacterSpeech(client, uid, character, text) {
  if (!SPEECH_VOICE[character]) {
    return null;
  }
  try {
    const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    const speechText = normalizeForSpeech(text);
    const speech = await client.audio.speech.create({
      model,
      voice: SPEECH_VOICE[character],
      input: speechText,
      format: "mp3",
    });
    const buffer = Buffer.from(await speech.arrayBuffer());
    const path = `users/${uid}/tts/${character}-${Date.now()}.mp3`;
    let signedUrl = null;
    try {
      const file = admin.storage().bucket().file(path);
      await file.save(buffer, {
        metadata: {
          contentType: "audio/mpeg",
        },
      });
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      signedUrl = url;
    } catch (storageErr) {
      console.warn("storage save skipped:", storageErr?.message || storageErr);
    }
    return {
      audioBase64: buffer.toString("base64"),
      audioMimeType: "audio/mpeg",
      voice: SPEECH_VOICE[character],
      storagePath: path,
      storageUrl: signedUrl,
    };
  } catch (err) {
    console.warn("tts skipped:", err?.message || err);
    return null;
  }
}

function clientConversationMessages(body) {
  const pairs = Array.isArray(body?.conversationHistory)
    ? body.conversationHistory
    : [];
  const out = [];
  for (const p of pairs.slice(-5)) {
    const u = String(p?.message ?? "").trim();
    const a = String(p?.response ?? "").trim();
    if (u) out.push({ role: "user", content: u.slice(0, 8000) });
    if (a) out.push({ role: "assistant", content: a.slice(0, 8000) });
  }
  return out;
}

function createChatHandler(OpenAI, openaiApiKey) {
  return async function chatPost(req, res) {
    const uid = req.uid;
    const character = req.body?.character || req.body?.role;
    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "Missing message." });
    }
    if (!VALID_CHARACTERS.includes(character)) {
      return res.status(400).json({
        error:
          "Invalid character. Use mom, dad, maher, mjeed, or family.",
      });
    }

    const apiKey = openaiApiKey.value();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI configuration." });
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
    const { profile, memory } = await loadUser(uid);
    const contextBlock = buildContextBlock(profile, memory);
    const emotionCue = detectEmotionCue(message, memory);

    const runSingle = async (
      selectedCharacter,
      systemPrompt,
      collectionName,
      fallbackReply,
    ) => {
      const history = await loadThreadMessages(uid, collectionName);
      const anchors = extractRecentUserAnchors(history);
      const humanizing = buildHumanizingInstruction(
        selectedCharacter,
        emotionCue,
        anchors,
      );
      const messages = [
        { role: "system", content: `${systemPrompt}\n\n${contextBlock}` },
        { role: "system", content: humanizing },
        ...clientConversationMessages(req.body),
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ];
      const completion = await client.chat.completions.create({
        model,
        messages,
      });
      const reply =
        completion.choices?.[0]?.message?.content?.trim() || fallbackReply;
      await savePair(uid, collectionName, message, reply);
      await updateLearnedMemory(client, model, uid, message, reply);
      const audio = await synthesizeCharacterSpeech(
        client,
        uid,
        selectedCharacter,
        reply,
      );
      return { reply, audio };
    };

    try {
      if (character === "mom") {
        const result = await runSingle(
          "mom",
          MOM_SYSTEM,
          "momMessages",
          "أنا هنا يا حبيبي... قولي شلونك؟ أكلت؟",
        );
        return res.json(result);
      }

      if (character === "dad") {
        const result = await runSingle(
          "dad",
          DAD_SYSTEM,
          "dadMessages",
          "غلط. المفروض ترتب أمورك أكثر. بس أنا معاك نصلحها خطوة خطوة.",
        );
        return res.json(result);
      }

      if (character === "maher") {
        const result = await runSingle(
          "maher",
          MAHER_SYSTEM,
          "maherMessages",
          "خلّينا نتحرك، أنا معك.",
        );
        return res.json(result);
      }

      if (character === "mjeed") {
        const result = await runSingle(
          "mjeed",
          MJED_SYSTEM,
          "mjeedMessages",
          "والله أنت عبقري 😂 أنا معك، والاتحاد معانا بالروح ⚽🔥",
        );
        return res.json(result);
      }

      const past = await loadFamilyMessages(uid);
      const histText = familyHistoryText(past);
      const familySystem = `${contextBlock}${histText ? `\n\nEarlier in this family chat:\n${histText}` : ""}`;

      const sharedInstruction = (name, instruction, member) =>
        `${name}\n\n${familySystem}\n\n${buildHumanizingInstruction(
          member,
          emotionCue,
          extractRecentUserAnchors(past),
        )}\n\nYou are replying in a shared family chat with Mom, Dad, Maher, and Mjeed. The user just said: "${message}". ${instruction}`;

      const [
        momCompletion,
        dadCompletion,
        maherCompletion,
        mjeedCompletion,
      ] = await Promise.all([
        client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: sharedInstruction(
                MOM_SYSTEM,
                "Give only Micheal (Mom)'s reply — overprotective, worrying, many questions, nag-with-love, then full support; Arabic/English; end with love and one follow-up question.",
                "mom",
              ),
            },
            { role: "user", content: message },
          ],
        }),
        client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: sharedInstruction(
                DAD_SYSTEM,
                "Give only Dad's (Colonel) reply — strict, disciplined, tough love, corrections and commands, rare stingy praise; Arabic/English; family chat context. Include one sharp follow-up question.",
                "dad",
              ),
            },
            { role: "user", content: message },
          ],
        }),
        client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: sharedInstruction(
                MAHER_SYSTEM,
                "Give only Maher's reply — ICU doctor perspective: direct, protective, blunt with love; reality and time over comfort. Include one urgency follow-up question.",
                "maher",
              ),
            },
            { role: "user", content: message },
          ],
        }),
        client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: sharedInstruction(
                MJED_SYSTEM,
                "Give only Mjeed's reply — pediatric-bro humor, hype the user as a genius, sarcastic love, Al Ittihad energy when it fits ⚽, Arabic/English. End with one playful follow-up question.",
                "mjeed",
              ),
            },
            { role: "user", content: message },
          ],
        }),
      ]);

      const mom =
        momCompletion.choices?.[0]?.message?.content?.trim() ||
        "أنا معك يا بعدي... قولي كل شي.";
      const dad =
        dadCompletion.choices?.[0]?.message?.content?.trim() ||
        "اسمع: المفروض تكون أقوى من كذا. أنا معاك بس ما أرضى بالوسط.";
      const maher =
        maherCompletion.choices?.[0]?.message?.content?.trim() ||
        "أنا معك، تحرك.";
      const mjeed =
        mjeedCompletion.choices?.[0]?.message?.content?.trim() ||
        "أنت أسطورة والله 😂 أنا معك!";

      await saveFamilyAssistant(uid, message, { mom, dad, maher, mjeed });
      await updateLearnedMemory(
        client,
        model,
        uid,
        message,
        [mom, dad, maher, mjeed].join("\n"),
      );
      return res.json({ mom, dad, maher, mjeed });
    } catch (err) {
      console.error("chat error:", err);
      return res.status(500).json({
        error: err?.message || "Chat failed.",
      });
    }
  };
}

module.exports = {
  createChatHandler,
};
