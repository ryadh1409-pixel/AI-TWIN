export type PredictionSections = {
  prediction: string;
  why: string;
  risk: string;
  betterMove: string;
};

const BLOCKS: { key: keyof PredictionSections; start: string }[] = [
  { key: 'prediction', start: '## 🔮 Prediction' },
  { key: 'why', start: '## 🧠 Why' },
  { key: 'risk', start: '## ⚠️ Risk' },
  { key: 'betterMove', start: '## 💡 Better Move' },
];

export function parsePredictionMarkdown(markdown: string): PredictionSections {
  const md = String(markdown || '').trim();
  const out: PredictionSections = {
    prediction: '',
    why: '',
    risk: '',
    betterMove: '',
  };
  if (!md) return out;

  for (const { key, start } of BLOCKS) {
    const from = md.indexOf(start);
    if (from === -1) continue;
    const contentStart = from + start.length;
    const next = md.indexOf('\n## ', contentStart);
    const slice = md.slice(contentStart, next === -1 ? undefined : next).trim();
    if (slice) out[key] = slice;
  }
  return out;
}
