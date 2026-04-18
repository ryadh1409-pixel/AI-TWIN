import type { CompanionUserProfileState } from '@/services/companionUserProfile';

export type InitiativeDecision = { ok: boolean; reason: string };

const TWO_H_MS = 2 * 60 * 60 * 1000;
const SIX_H_MS = 6 * 60 * 60 * 1000;
const TWELVE_H_MS = 12 * 60 * 60 * 1000;

/**
 * Whether a proactive suggestion may be offered (mirrors server `companionInitiative.js`).
 * - No initiate if last activity &lt; 2h
 * - Only if idle between 6h and 12h
 * - No initiate if user ignored the last suggestion
 */
export function shouldInitiate(
  profile: CompanionUserProfileState,
  nowMs: number = Date.now(),
): InitiativeDecision {
  if (profile.ignoredLastSuggestion) {
    return { ok: false, reason: 'ignored_last_suggestion' };
  }

  const lastMs = profile.lastActiveAtMs;
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
