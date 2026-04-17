/**
 * Web search: Google Custom Search JSON API or SerpAPI (set env accordingly).
 */

async function searchGoogleCse(query, num = 5) {
  const key = process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) {
    throw new Error(
      "Google CSE not configured: set GOOGLE_CSE_API_KEY (or GOOGLE_API_KEY) and GOOGLE_CSE_ID",
    );
  }
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(num, 10)));

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Google CSE HTTP ${res.status}`);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((it) => ({
    title: it.title || "",
    link: it.link || "",
    snippet: it.snippet || "",
  }));
}

async function searchSerpApi(query, num = 5) {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    throw new Error("SerpAPI not configured: set SERPAPI_KEY");
  }
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("api_key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(num, 10)));

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `SerpAPI HTTP ${res.status}`);
  }
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
  return organic.slice(0, num).map((it) => ({
    title: it.title || "",
    link: it.link || "",
    snippet: it.snippet || "",
  }));
}

/**
 * @param {string} query
 * @returns {Promise<string>} Human-readable results for GPT context
 */
async function searchWeb(query) {
  const q = String(query || "").trim();
  if (!q) return "No search query provided.";

  let rows = [];
  try {
    if (process.env.SERPAPI_KEY) {
      rows = await searchSerpApi(q, 5);
    } else {
      rows = await searchGoogleCse(q, 5);
    }
  } catch (e) {
    return `Search failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (!rows.length) {
    return "No search results found.";
  }

  return rows
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`)
    .join("\n\n");
}

module.exports = { searchWeb, searchGoogleCse, searchSerpApi };
