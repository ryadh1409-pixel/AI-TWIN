import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  loadUserProfile,
  updateStreakOnAppOpen,
  type CompanionUserProfileState,
} from '@/services/companionUserProfile';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type RetentionContextValue = {
  /** Companion slice of `user_profile` (streak, topics, initiative flags). */
  profile: CompanionUserProfileState | null;
  streakLabel: string | null;
  refresh: () => Promise<void>;
};

const RetentionContext = createContext<RetentionContextValue>({
  profile: null,
  streakLabel: null,
  refresh: async () => {},
});

export function RetentionProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<CompanionUserProfileState | null>(null);
  const [streakLabel, setStreakLabel] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.uid || !isFirebaseConfigured()) {
      setProfile(null);
      setStreakLabel(null);
      return;
    }
    const p = await loadUserProfile(user.uid);
    setProfile(p);
    setStreakLabel(`Day ${Math.max(1, p.streakDays)} streak`);
  }, [user?.uid]);

  useEffect(() => {
    if (loading || !user?.uid || !isFirebaseConfigured()) {
      setProfile(null);
      setStreakLabel(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { profile: p, streakLabel: label } = await updateStreakOnAppOpen(user.uid);
      if (!cancelled) {
        setProfile(p);
        setStreakLabel(label);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user?.uid]);

  const value = useMemo(
    () => ({
      profile,
      streakLabel,
      refresh,
    }),
    [profile, streakLabel, refresh],
  );

  return <RetentionContext.Provider value={value}>{children}</RetentionContext.Provider>;
}

export function useRetention() {
  return useContext(RetentionContext);
}
