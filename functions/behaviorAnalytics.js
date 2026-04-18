"use strict";

const STRESSED = /stress|قلق|تعب|مشغول|ضغط|خايف|worried|anxious|burnout|overwhelmed/i;
const FOCUSED = /ركز|هدف|خطة|مشروع|launch|focus|deep work|priority|deadline/i;

function hourFromTs(ts) {
  if (!ts) return null;
  const ms = typeof ts.toMillis === "function" ? ts.toMillis() : ts._seconds ? ts._seconds * 1000 : 0;
  if (!ms) return null;
  return new Date(ms).getUTCHours();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06ff]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length > 2)
    .slice(0, 80);
}

/**
 * Pattern detection from normalized behavior events (plain objects).
 * @param {Array<Record<string, unknown>>} events newest first or any order
 */
function analyzeUserBehavior(events) {
  const list = Array.isArray(events) ? events : [];
  const hourCounts = Array(24).fill(0);
  const wordFreq = new Map();
  let messageCount = 0;
  let decisionsMade = 0;
  let decisionsCompleted = 0;
  let executedYes = 0;
  let executedNo = 0;
  let sessionEvents = 0;
  let totalSessionSec = 0;
  let appOpenCount = 0;
  let moodStressed = 0;
  let moodFocused = 0;
  let moodNeutral = 0;
  const days = new Set();

  for (const e of list) {
    const type = String(e.eventType || "");
    const ts = e.createdAt;
    const h = hourFromTs(ts);
    if (h != null) hourCounts[h] += 1;
    const ms =
      ts && typeof ts.toMillis === "function"
        ? ts.toMillis()
        : ts && typeof ts._seconds === "number"
          ? ts._seconds * 1000
          : 0;
    if (ms) days.add(String(Math.floor(ms / 86400000)));

    if (type === "message") {
      messageCount += 1;
      const txt = String(e.messageText || "");
      if (STRESSED.test(txt)) moodStressed += 1;
      else if (FOCUSED.test(txt)) moodFocused += 1;
      else moodNeutral += 1;
      for (const w of tokenize(txt)) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    } else if (type === "decision_made") {
      decisionsMade += 1;
    } else if (type === "decision_completed") {
      decisionsCompleted += 1;
      if (e.executed === true) executedYes += 1;
      else if (e.executed === false) executedNo += 1;
    } else if (type === "session") {
      sessionEvents += 1;
      const sec = Number(e.sessionDurationSec) || 0;
      totalSessionSec += Math.min(sec, 8 * 3600);
    } else if (type === "app_open" || type === "usage_ping") {
      appOpenCount += 1;
    }
  }

  const topTopics = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w, c]) => ({ word: w, count: c }));

  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const activeHours = hourCounts
    .map((c, i) => ({ hour: i, count: c }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const denom = executedYes + executedNo;
  const decisionConsistency = denom
    ? Math.round((executedYes / denom) * 100) / 100
    : null;

  let moodTrend = "neutral";
  const mmax = Math.max(moodStressed, moodFocused, moodNeutral);
  if (mmax === 0) moodTrend = "neutral";
  else if (moodStressed === mmax) moodTrend = "stressed";
  else if (moodFocused === mmax) moodTrend = "focused";
  else moodTrend = "neutral";

  const usageSignals = {
    messageCount,
    decisionsMade,
    decisionsCompleted,
    executedYes,
    executedNo,
    sessionSamples: sessionEvents,
    avgSessionSec: sessionEvents ? Math.round(totalSessionSec / sessionEvents) : 0,
    appOpenCount,
    distinctDays: days.size,
  };

  return {
    topTopics,
    activeHours,
    peakHourUtc: peakHour >= 0 ? peakHour : null,
    decisionConsistency,
    moodTrend,
    usageSignals,
    sampleSize: list.length,
  };
}

/**
 * Eligibility for generating a new insight (before daily cap).
 */
function shouldTriggerInsight(patterns) {
  const u = patterns.usageSignals || {};
  const msg = Number(u.messageCount) || 0;
  const dm = Number(u.decisionsMade) || 0;
  const dc = Number(u.decisionsCompleted) || 0;
  const opens = Number(u.appOpenCount) || 0;
  const distinct = Number(u.distinctDays) || 0;

  const usageHits = msg + opens;
  if (usageHits >= 3) return { ok: true, reason: "usage_3plus" };
  if (dm >= 2) return { ok: true, reason: "decisions_2plus" };
  if (dm >= 1 && dc >= 2) return { ok: true, reason: "decisions_tracked" };
  if (msg >= 5 && distinct >= 2) return { ok: true, reason: "pattern_messages" };
  return { ok: false, reason: "not_enough_signal" };
}

module.exports = { analyzeUserBehavior, shouldTriggerInsight };
