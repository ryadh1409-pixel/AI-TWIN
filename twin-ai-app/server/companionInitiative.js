'use strict';

function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6);
  }
  return 0;
}

const TWO_H_MS = 2 * 60 * 60 * 1000;
const SIX_H_MS = 6 * 60 * 60 * 1000;
const TWELVE_H_MS = 12 * 60 * 60 * 1000;

/**
 * @param {Record<string, unknown>|null|undefined} userProfile — Firestore `user_profile/{uid}` snapshot data
 * @param {number} [nowMs]
 * @returns {{ ok: boolean, reason: string }}
 */
function shouldInitiate(userProfile, nowMs = Date.now()) {
  if (!userProfile || typeof userProfile !== 'object') {
    return { ok: false, reason: 'no_profile' };
  }

  if (userProfile.ignoredLastSuggestion === true) {
    return { ok: false, reason: 'ignored_last_suggestion' };
  }

  const lastMs = toMillis(userProfile.lastActiveAt);
  if (!lastMs) {
    return { ok: true, reason: 'no_prior_activity' };
  }

  const gap = nowMs - lastMs;
  if (gap < TWO_H_MS) {
    return { ok: false, reason: 'recent_interaction' };
  }
  if (gap < SIX_H_MS || gap > TWELVE_H_MS) {
    return { ok: false, reason: 'idle_not_in_window' };
  }

  return { ok: true, reason: 'idle_window_ok' };
}

module.exports = { shouldInitiate, toMillis, TWO_H_MS, SIX_H_MS, TWELVE_H_MS };
