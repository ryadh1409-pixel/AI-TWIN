const BLOCKS: { key: keyof InsightSections; start: string }[] = [
  { key: 'insight', start: '## 🧠 Behavioral Insight' },
  { key: 'pattern', start: '## 📊 Pattern Detected' },
  { key: 'risk', start: '## ⚠️ Risk / Weakness' },
  { key: 'recommendation', start: '## 💡 Recommendation' },
  { key: 'opportunity', start: '## 🎯 Opportunity' },
];

export type InsightSections = {
  insight: string;
  pattern: string;
  risk: string;
  recommendation: string;
  opportunity: string;
};

export function parseInsightMarkdown(markdown: string): InsightSections {
  const md = String(markdown || '').trim();
  const out: InsightSections = {
    insight: '',
    pattern: '',
    risk: '',
    recommendation: '',
    opportunity: '',
  };
  if (!md) return out;

  for (let i = 0; i < BLOCKS.length; i++) {
    const { key, start } = BLOCKS[i];
    const from = md.indexOf(start);
    if (from === -1) continue;
    const contentStart = from + start.length;
    const nextHeading = md.indexOf('\n## ', contentStart);
    const slice = md.slice(contentStart, nextHeading === -1 ? undefined : nextHeading).trim();
    if (slice) out[key] = slice;
  }
  return out;
}
