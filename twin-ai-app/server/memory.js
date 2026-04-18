const fs = require('fs');
const path = require('path');

const memory = {};
const MEMORY_FILE = path.resolve(__dirname, 'memory.json');
const MAX_HISTORY = 30;

function loadMemoryFromDisk() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return;
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8').trim();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.assign(memory, parsed);
    }
  } catch (error) {
    console.error('[memory] load failed:', error);
  }
}

function persistMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
  } catch (error) {
    console.error('[memory] persist failed:', error);
  }
}

function ensureUser(userId) {
  if (!memory[userId]) {
    memory[userId] = {
      name: '',
      city: '',
      preferences: [],
      pastInteractions: [],
      lastProactiveAt: null,
      moodCounts: { tired: 0, stressed: 0, happy: 0, neutral: 0 },
      lastMood: 'neutral',
      lastMoodAt: null,
      frequentTopics: [],
      lastInteractionAt: null,
      lastSuggestionAt: null,
      suggestionSessionCounts: {},
      lastInitiativeAt: null,
      initiativeSessionCounts: {},
    };
  }
  const u = memory[userId];
  if (!u.moodCounts) u.moodCounts = { tired: 0, stressed: 0, happy: 0, neutral: 0 };
  if (u.lastMood === undefined) u.lastMood = 'neutral';
  if (!Array.isArray(u.frequentTopics)) u.frequentTopics = [];
  if (u.lastInteractionAt === undefined) u.lastInteractionAt = null;
  if (u.lastSuggestionAt === undefined) u.lastSuggestionAt = null;
  if (!u.suggestionSessionCounts || typeof u.suggestionSessionCounts !== 'object') {
    u.suggestionSessionCounts = {};
  }
  if (u.lastInitiativeAt === undefined) u.lastInitiativeAt = null;
  if (!u.initiativeSessionCounts || typeof u.initiativeSessionCounts !== 'object') {
    u.initiativeSessionCounts = {};
  }
  return u;
}

function getUserMemory(userId) {
  const user = ensureUser(userId);
  if (user.lastProactiveAt === undefined) user.lastProactiveAt = null;
  return user;
}

function recordProactiveSent(userId) {
  const user = ensureUser(userId);
  user.lastProactiveAt = new Date().toISOString();
  persistMemory();
}

function updateUserMemory(userId, data) {
  const user = ensureUser(userId);

  if (typeof data.name === 'string' && data.name.trim()) {
    user.name = data.name.trim();
  }
  if (typeof data.city === 'string' && data.city.trim()) {
    user.city = data.city.trim();
  }
  if (Array.isArray(data.preferences) && data.preferences.length > 0) {
    const merged = new Set([...user.preferences, ...data.preferences.map(String)]);
    user.preferences = Array.from(merged).slice(0, 10);
  }

  persistMemory();
  return user;
}

function appendConversation(userId, message) {
  const user = ensureUser(userId);
  user.pastInteractions.push({
    role: message.role || 'user',
    message: String(message.message || ''),
    at: new Date().toISOString(),
  });
  user.pastInteractions = user.pastInteractions.slice(-MAX_HISTORY);
  persistMemory();
  return user.pastInteractions;
}

function getRecentConversations(userId, limit = 3) {
  const user = ensureUser(userId);
  return user.pastInteractions.slice(-Math.max(1, limit));
}

/** Milliseconds since last user message started (Infinity if first time). Call before markInteractionStart. */
function getInteractionGapMs(userId) {
  const user = ensureUser(userId);
  const prev = user.lastInteractionAt;
  if (!prev || typeof prev !== 'string') return Infinity;
  const t = new Date(prev).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, Date.now() - t);
}

/** Mark the start of a new user turn (for suggestion timing). */
function markInteractionStart(userId) {
  const user = ensureUser(userId);
  user.lastInteractionAt = new Date().toISOString();
  persistMemory();
}

function getSuggestionSessionCount(userId, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return 0;
  const k = sessionId.trim().slice(0, 128);
  if (!k) return 0;
  const user = ensureUser(userId);
  return Number(user.suggestionSessionCounts[k]) || 0;
}

/** After returning a non-null next-action suggestion to the client. */
function recordSuggestionDelivered(userId, sessionId) {
  const user = ensureUser(userId);
  user.lastSuggestionAt = new Date().toISOString();
  if (sessionId && typeof sessionId === 'string') {
    const k = sessionId.trim().slice(0, 128);
    if (k) {
      user.suggestionSessionCounts[k] = (Number(user.suggestionSessionCounts[k]) || 0) + 1;
    }
  }
  const keys = Object.keys(user.suggestionSessionCounts);
  if (keys.length > 24) {
    keys.slice(0, keys.length - 24).forEach((key) => {
      delete user.suggestionSessionCounts[key];
    });
  }
  persistMemory();
}

function getInitiativeSessionCount(userId, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return 0;
  const k = sessionId.trim().slice(0, 128);
  if (!k) return 0;
  const user = ensureUser(userId);
  return Number(user.initiativeSessionCounts[k]) || 0;
}

function recordInitiativeDelivered(userId, sessionId) {
  const user = ensureUser(userId);
  user.lastInitiativeAt = new Date().toISOString();
  if (sessionId && typeof sessionId === 'string') {
    const k = sessionId.trim().slice(0, 128);
    if (k) {
      user.initiativeSessionCounts[k] = (Number(user.initiativeSessionCounts[k]) || 0) + 1;
    }
  }
  const keys = Object.keys(user.initiativeSessionCounts);
  if (keys.length > 24) {
    keys.slice(0, keys.length - 24).forEach((key) => {
      delete user.initiativeSessionCounts[key];
    });
  }
  persistMemory();
}

/**
 * Update mood tallies + topic hints from one classification pass per user turn.
 * @param {string} userId
 * @param {{ mood?: string, topicHints?: string[] }} signals
 */
function recordCompanionSignals(userId, signals) {
  const user = ensureUser(userId);
  const allowed = new Set(['tired', 'stressed', 'happy', 'neutral']);
  const mood = allowed.has(String(signals?.mood || '').toLowerCase())
    ? String(signals.mood).toLowerCase()
    : 'neutral';
  user.moodCounts[mood] = (user.moodCounts[mood] || 0) + 1;
  user.lastMood = mood;
  user.lastMoodAt = new Date().toISOString();

  const hints = Array.isArray(signals?.topicHints) ? signals.topicHints : [];
  const freq = Array.isArray(user.frequentTopics) ? [...user.frequentTopics] : [];
  for (const raw of hints.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)) {
    const label = raw.slice(0, 48);
    const idx = freq.findIndex((t) => String(t.label || '').toLowerCase() === label.toLowerCase());
    if (idx >= 0) {
      freq[idx] = { label: freq[idx].label, count: (freq[idx].count || 1) + 1 };
    } else {
      freq.push({ label, count: 1 });
    }
  }
  user.frequentTopics = freq.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 14);
  persistMemory();
  return user;
}

loadMemoryFromDisk();

module.exports = {
  getUserMemory,
  updateUserMemory,
  appendConversation,
  getRecentConversations,
  recordProactiveSent,
  recordCompanionSignals,
  getInteractionGapMs,
  markInteractionStart,
  getSuggestionSessionCount,
  recordSuggestionDelivered,
  getInitiativeSessionCount,
  recordInitiativeDelivered,
};
