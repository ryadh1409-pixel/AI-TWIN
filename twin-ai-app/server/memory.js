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
    };
  }
  return memory[userId];
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

loadMemoryFromDisk();

module.exports = {
  getUserMemory,
  updateUserMemory,
  appendConversation,
  getRecentConversations,
  recordProactiveSent,
};
