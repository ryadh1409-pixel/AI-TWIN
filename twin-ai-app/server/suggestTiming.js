'use strict';

/** User sent another message within this window → treat as "just interacted" unless they show clear need. */
const RAPID_CHAT_MS = 90 * 1000;
/** Minimum quiet time between user messages to allow a follow-up chip without a strong signal. */
const IDLE_MS = 3 * 60 * 1000;
/** When client does not send a session id, enforce a minimum gap between any two suggestions. */
const COOLDOWN_NO_SESSION_MS = 50 * 60 * 1000;

function userShowsNeed(message, mood) {
  const m = String(message || '').toLowerCase();
  if (mood === 'tired' || mood === 'stressed') return true;
  if (
    /(bored|boring|طفشان|زهقان|مطفش|can't sleep|cant sleep|insomnia|نعسان|ما نمت|تعب|تعبان|lonely|alone|sad|قلق|ضغط|anxious|help me|ساعدني)/i.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Bias examples for the suggestion model (not a hard filter).
 * @param {'morning'|'afternoon'|'evening'|'night'} timeOfDay
 */
function buildTimeOfDaySuggestHint(timeOfDay) {
  if (timeOfDay === 'night') {
    return 'Time band: night — prefer a soft sleep story / wind-down over news or chores.';
  }
  if (timeOfDay === 'evening') {
    return 'Time band: evening — sleep story or calm wind-down is more fitting than morning-style news.';
  }
  if (timeOfDay === 'morning') {
    return 'Time band: morning — light news or “plan the day” nudge fits better than a bedtime story.';
  }
  return 'Time band: afternoon — stay proportional; no pushy tone.';
}

/**
 * Gate follow-up UI suggestions: avoid spam, respect session cap, reward idle or clear need.
 *
 * @param {{
 *   gapMsSincePreviousUserMessage: number,
 *   lastSuggestionAtISO: string|null|undefined,
 *   suggestionSessionId: string,
 *   sessionSuggestionCount: number,
 *   message: string,
 *   mood: string,
 * }} args — time-of-day is applied in the model hint, not in this gate.
 * @returns {{ allow: boolean, reason: string }}
 */
function shouldSuggest(args) {
  const {
    gapMsSincePreviousUserMessage,
    lastSuggestionAtISO,
    suggestionSessionId,
    sessionSuggestionCount,
    message,
    mood,
  } = args;

  const need = userShowsNeed(message, mood);
  const gap = Number.isFinite(gapMsSincePreviousUserMessage)
    ? gapMsSincePreviousUserMessage
    : Infinity;
  const rapid = gap < RAPID_CHAT_MS;
  if (rapid && !need) {
    return { allow: false, reason: 'rapid_chat' };
  }

  const idleEnough = gap >= IDLE_MS;
  if (!idleEnough && !need) {
    return { allow: false, reason: 'not_idle_no_need' };
  }

  const sid = String(suggestionSessionId || '').trim();
  if (sid && sessionSuggestionCount >= 1) {
    return { allow: false, reason: 'session_cap' };
  }

  if (!sid && lastSuggestionAtISO) {
    const last = new Date(lastSuggestionAtISO).getTime();
    if (!Number.isNaN(last) && Date.now() - last < COOLDOWN_NO_SESSION_MS) {
      return { allow: false, reason: 'cooldown_no_session' };
    }
  }

  return { allow: true, reason: need ? 'user_need' : 'idle_ok' };
}

module.exports = {
  shouldSuggest,
  buildTimeOfDaySuggestHint,
  userShowsNeed,
  RAPID_CHAT_MS,
  IDLE_MS,
  COOLDOWN_NO_SESSION_MS,
};
