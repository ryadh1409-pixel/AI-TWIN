const SECTIONS: { key: string; start: string; next?: string }[] = [
  { key: 'summary', start: '## 🧠 Decision Summary', next: '## 📊' },
  { key: 'options', start: '## 📊 Options & Scores', next: '## ✅' },
  { key: 'recommendation', start: '## ✅ Recommendation', next: '## 💡' },
  { key: 'reasoning', start: '## 💡 Reasoning', next: '## 🎯' },
  { key: 'confidence', start: '## 🎯 Confidence', next: '## 🚀' },
  { key: 'actionPlan', start: '## 🚀 Action Plan', next: '## 📈' },
  { key: 'pmf', start: '## 📈 PMF Insight' },
];

export type DecisionSections = Record<
  'summary' | 'options' | 'recommendation' | 'reasoning' | 'confidence' | 'actionPlan' | 'pmf',
  string
>;

export function parseDecisionMarkdown(markdown: string): DecisionSections {
  const md = String(markdown || '').trim();
  const out: DecisionSections = {
    summary: '',
    options: '',
    recommendation: '',
    reasoning: '',
    confidence: '',
    actionPlan: '',
    pmf: '',
  };
  if (!md) return out;

  for (let i = 0; i < SECTIONS.length; i++) {
    const { key, start, next } = SECTIONS[i];
    const from = md.indexOf(start);
    if (from === -1) continue;
    const contentStart = from + start.length;
    let end = md.length;
    if (next) {
      const j = md.indexOf(next, contentStart);
      if (j !== -1) end = j;
    }
    const slice = md.slice(contentStart, end).trim();
    if (slice) {
      out[key as keyof DecisionSections] = slice;
    }
  }
  return out;
}
