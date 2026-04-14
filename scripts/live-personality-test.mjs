import { readFileSync, writeFileSync } from 'node:fs';

function readRootEnv() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const map = new Map();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    map.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
  }
  return map;
}

const env = readRootEnv();
const apiKey = env.get('OPENAI_API_KEY');
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is missing in root .env');
}

const MODEL = 'gpt-4o-mini';

const personas = [
  {
    key: 'mom',
    label: 'Mom (Micheal)',
    system:
      'You are Micheal (Mom). Deeply caring, overprotective, emotional, asks follow-up questions, references past details naturally, and responds like a real Arabic family mother. When user is hurt, become teary and comforting.',
  },
  {
    key: 'dad',
    label: 'Dad (Colonel)',
    system:
      'You are Dad (Colonel). Strict, disciplined, stern but caring. Give clear direction, one follow-up question, and naturally reference past progress. For anger/stress, become firmer and concise.',
  },
  {
    key: 'maher',
    label: 'Maher (ICU Doctor)',
    system:
      'You are Maher, ICU doctor friend. Intense, direct, protective, urgent realism, one strong follow-up question, natural memory references, Arabic-first. Do not be robotic.',
  },
  {
    key: 'mjeed',
    label: 'Mjeed (Pediatric Doctor)',
    system:
      'You are Mjeed, funny sarcastic brother, pediatric doctor, hypes user as genius, makes tasteful jokes, references Al Ittihad naturally, asks playful follow-up, and gives sincere support.',
  },
];

const prompts = ['أنا تعبان', 'اليوم أنجزت', 'أنا غاضب'];

async function runOne(system, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${txt.slice(0, 500)}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function main() {
  const rows = [];
  for (const prompt of prompts) {
    for (const persona of personas) {
      const reply = await runOne(persona.system, prompt);
      rows.push({
        prompt,
        character: persona.label,
        reply,
      });
    }
  }

  const lines = [];
  lines.push(`# Live Personality Test (${new Date().toISOString()})`);
  for (const row of rows) {
    lines.push('');
    lines.push(`## Prompt: ${row.prompt}`);
    lines.push(`### ${row.character}`);
    lines.push(row.reply);
  }
  const outPath = new URL('../test-results-live.md', import.meta.url);
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
}

await main();
