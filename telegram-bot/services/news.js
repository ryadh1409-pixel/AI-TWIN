const RssParser = require("rss-parser");

const parser = new RssParser({
  timeout: 25000,
  headers: {
    "User-Agent": "X7-AI-Twin-Telegram/1.0",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
});

const GOOGLE_NEWS_SA_RSS =
  "https://news.google.com/rss?hl=ar&gl=SA&ceid=SA:ar";

/**
 * @returns {Promise<string>} Text blob for OpenAI summarization
 */
async function fetchSaudiNewsText() {
  const feed = await parser.parseURL(GOOGLE_NEWS_SA_RSS);
  const items = (feed.items || []).slice(0, 22);
  if (!items.length) {
    throw new Error("RSS: no items returned");
  }
  const lines = items.map((it, i) => {
    const title = (it.title || "").trim();
    const snip = (it.contentSnippet || it.content || "").trim().slice(0, 240);
    return `${i + 1}. ${title}${snip ? `\n   ${snip}` : ""}`;
  });
  return [`# ${feed.title || "أخبار"}`, ...lines].join("\n");
}

module.exports = {
  fetchSaudiNewsText,
  GOOGLE_NEWS_SA_RSS,
};
