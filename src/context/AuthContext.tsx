import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { fetchMyProfile } from '@/lib/api';
import type { Profile } from '@/lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    try {
      // the profile row is created by a database trigger right after sign-up;
      // retry briefly in case the first read races the trigger
      for (let i = 0; i < 3; i++) {
        const p = await fetchMyProfile(s.user.id);
        if (p) {
          setProfile(p);
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      setProfile(null);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // defer to avoid calling Supabase inside the auth callback (deadlock guard)
        setTimeout(() => void loadProfile(s), 0);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // react to approval changes made by an admin while the user is waiting
  useEffect(() => {
    if (!session || profile?.status === 'approved') return;
    const t = setInterval(() => void loadProfile(session), 15000);
    return () => clearInterval(t);
  }, [session, profile?.status, loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      isAdmin: profile?.role === 'admin' && profile.status === 'approved' && !profile.password_change_required,
      isApproved: profile?.status === 'approved' && !profile.password_change_required,
      refreshProfile: () => loadProfile(session),
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
      },
    }),
    [session, profile, loading, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
