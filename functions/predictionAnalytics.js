"use strict";

const { analyzeUserBehavior } = require("./behaviorAnalytics");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function tokenizeForRepeat(s) {
  return norm(s)
    .split(/[^a-z0-9\u0600-\u06ff]+/i)
    .filter((w) => w.length > 3)
    .slice(0, 12);
}

/**
 * Pattern model for prediction — from user_behavior events + recent decisions docs.
 * @param {{ events: object[], decisions: object[] }} input
 */
function predictUserBehavior(input) {
  const events = Array.isArray(input?.events) ? input.events : [];
  const decisions = Array.isArray(input?.decisions) ? input.decisions : [];

  const behavior = analyzeUserBehavior(events);

  const themes = new Map();
  for (const d of decisions) {
    const q = norm(d.userInput || d.messageText || "");
    if (!q) continue;
    const key = q.slice(0, 80);
    themes.set(key, (themes.get(key) || 0) + 1);
  }
  const repeatedDecisions = [...themes.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  let pendingFollowUps = 0;
  let completedOutcomes = 0;
  let skippedOutcomes = 0;
  const recent = decisions.slice(-14);
  for (const d of recent) {
    const st = String(d.followUpStatus || "pending");
    if (st !== "done") pendingFollowUps += 1;
    if (st === "done") {
      if (d.executed === true) completedOutcomes += 1;
      else if (d.executed === false) skippedOutcomes += 1;
    }
  }

  const avoidancePatterns = [];
  if (pendingFollowUps >= 3) {
    avoidancePatterns.push("Several decisions still open for follow-through");
  }
  if (skippedOutcomes >= 2 && completedOutcomes < skippedOutcomes) {
    avoidancePatterns.push("More recorded non-execution than completion on past choices");
  }

  const execRate = behavior.decisionConsistency;
  let riskLevel = "medium";
  if (execRate != null) {
    if (execRate < 0.35) riskLevel = "higher";
    else if (execRate > 0.65) riskLevel = "lower";
  } else if (decisions.length < 2) {
    riskLevel = "unknown";
  }

  const executionConsistency =
    execRate != null
      ? execRate
      : decisions.length
        ? completedOutcomes / Math.max(1, completedOutcomes + skippedOutcomes)
        : null;

  const overlapHints = [];
  for (const d of decisions.slice(0, 8)) {
    for (const t of tokenizeForRepeat(d.userInput || "")) {
      overlapHints.push(t);
    }
  }
  const freq = new Map();
  for (const w of overlapHints) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const recurringTopics = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w, c]) => ({ w, c }));

  return {
    behaviorSummary: behavior,
    repeatedDecisions,
    recurringTopics,
    avoidancePatterns,
    riskLevel,
    executionConsistency,
    decisionStats: {
      totalRecent: decisions.length,
      pendingFollowUps,
      completedOutcomes,
      skippedOutcomes,
    },
  };
}

/**
 * Strong enough signal to auto-run prediction (server-side gate).
 */
function hasStrongPredictionSignal(events, decisions, predictionModel) {
  const dm = events.filter((e) => e.eventType === "decision_made").length;
  const msg = events.filter((e) => e.eventType === "message").length;
  if (decisions.length >= 3) return true;
  if (dm >= 2) return true;
  if (msg >= 5 && decisions.length >= 1) return true;
  if (predictionModel.repeatedDecisions.length >= 1) return true;
  if (predictionModel.avoidancePatterns.length >= 1 && decisions.length >= 2) return true;
  return false;
}

module.exports = { predictUserBehavior, hasStrongPredictionSignal };
