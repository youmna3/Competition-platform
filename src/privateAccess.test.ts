import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('./pages/auth/AuthPages.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./components/Layout.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260929000001_make_platform_private.sql', import.meta.url), 'utf8');

describe('private platform access', () => {
  it('places every application route, including leaderboard, behind RequireAuth', () => {
    expect(app).toContain('<Route element={<RequireAuth><Layout /></RequireAuth>}>');
    expect(app).toContain('path="/leaderboard" element={<LeaderboardPage />}');
    expect(app.indexOf('<Route element={<RequireAuth><Layout /></RequireAuth>}>')).toBeLessThan(app.indexOf('path="/leaderboard"'));
    expect(app).toContain('path="/login"');
    expect(app).toContain('path="/forgot-password"');
    expect(app).toContain('path="/reset-password"');
  });

  it('removes public leaderboard links while retaining it for approved navigation', () => {
    expect(auth).not.toContain('to="/leaderboard"');
    expect(auth).toContain('<Brand inverted to="/login" />');
    expect(layout).toContain("if (isApproved) items.push({ to: '/leaderboard'");
  });

  it('revokes anonymous database and RPC access and gates published results', () => {
    expect(migration).toContain('from anon');
    expect(migration).toContain('revoke execute on function public.get_leaderboard');
    expect(migration).toContain('revoke execute on function public.get_competitions');
    expect(migration).toContain("if not public.is_approved_user()");
    expect(migration).toContain('and (v_admin or r.is_published)');
    expect(migration).toContain('public.is_approved_user() and exists');
  });
});
