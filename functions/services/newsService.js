const RssParser = require("rss-parser");

const parser = new RssParser({
  timeout: 20000,
  headers: {
    "User-Agent": "X7-AI-Twin/1.0 (Firebase; news digest)",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
});

/** Google News RSS — Saudi Arabia, Arabic */
const GOOGLE_NEWS_SA_RSS =
  "https://news.google.com/rss?hl=ar&gl=SA&ceid=SA:ar";

/**
 * Fetch headlines + short descriptions from Google News RSS.
 * @returns {Promise<string>} Concatenated text for the LLM
 */
async function fetchSaudiGoogleNewsText() {
  const feed = await parser.parseURL(GOOGLE_NEWS_SA_RSS);
  const items = (feed.items || []).slice(0, 25);
  if (!items.length) {
    throw new Error("RSS feed returned no items.");
  }
  const lines = items.map((it, i) => {
    const title = (it.title || "").trim();
    const summary = (it.contentSnippet || it.content || "").trim();
    return `${i + 1}. ${title}${summary ? `\n   ${summary.slice(0, 280)}` : ""}`;
  });
  return [`# ${feed.title || "أخبار"}`, ...lines].join("\n");
}

module.exports = {
  fetchSaudiGoogleNewsText,
  GOOGLE_NEWS_SA_RSS,
};
