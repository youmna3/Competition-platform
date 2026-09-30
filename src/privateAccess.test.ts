import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('./pages/auth/AuthPages.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./components/Layout.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260929000001_make_platform_private.sql', import.meta.url), 'utf8');
const judgeLibraryMigration = readFileSync(new URL('../supabase/migrations/20260930000002_judge_rubric_library_and_admin_leaderboard.sql', import.meta.url), 'utf8');

describe('private platform access', () => {
  it('places every application route, including leaderboard, behind RequireAuth', () => {
    expect(app).toContain('<Route element={<RequireAuth><Layout /></RequireAuth>}>');
    expect(app).toContain('path="/leaderboard" element={<RequireAuth admin><LeaderboardPage /></RequireAuth>}');
    expect(app.indexOf('<Route element={<RequireAuth><Layout /></RequireAuth>}>')).toBeLessThan(app.indexOf('path="/leaderboard"'));
    expect(app).toContain('path="/login"');
    expect(app).toContain('path="/forgot-password"');
    expect(app).toContain('path="/reset-password"');
  });

  it('removes leaderboard links for judges while retaining administrator navigation', () => {
    expect(auth).not.toContain('to="/leaderboard"');
    expect(auth).toContain('<Brand inverted to="/login" />');
    expect(layout).toContain("if (isAdmin) items.push({ to: '/leaderboard'");
    expect(layout).not.toContain("if (isApproved) items.push({ to: '/leaderboard'");
  });

  it('revokes anonymous database and RPC access and gates published results', () => {
    expect(migration).toContain('from anon');
    expect(migration).toContain('revoke execute on function public.get_leaderboard');
    expect(migration).toContain('revoke execute on function public.get_competitions');
    expect(migration).toContain("if not public.is_approved_user()");
    expect(migration).toContain('and (v_admin or r.is_published)');
    expect(migration).toContain('public.is_approved_user() and exists');
  });

  it('makes the leaderboard RPC administrator-only', () => {
    expect(judgeLibraryMigration).toContain("if not public.is_admin()");
    expect(judgeLibraryMigration).toContain("raise exception 'Administrator access required'");
  });
});
