import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { invitationStatus } from './JudgesPage';
import type { UserInvitation } from '@/lib/types';

const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const authPages = readFileSync(new URL('../auth/AuthPages.tsx', import.meta.url), 'utf8');
const edgeFunction = readFileSync(new URL('../../../supabase/functions/admin-user-invitations/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260928000008_admin_user_invitations.sql', import.meta.url), 'utf8');
const temporaryMigration = readFileSync(new URL('../../../supabase/migrations/20260928000009_temporary_password_accounts.sql', import.meta.url), 'utf8');

const invitation = (overrides: Partial<UserInvitation> = {}): UserInvitation => ({
  id: '1', auth_user_id: '2', email: 'judge@example.com', full_name: 'Judge', status: 'pending', invited_by: '3',
  invited_at: '2026-01-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z', accepted_at: null, revoked_at: null,
  last_sent_at: '2026-01-01T00:00:00Z', send_count: 1, ...overrides,
});

describe('administrator-controlled user management', () => {
  it('removes every public signup route and client signup call', () => {
    expect(app).not.toContain('path="/signup"');
    expect(app).not.toContain('SignupPage');
    expect(authPages).not.toContain('auth.signUp');
    expect(authPages).not.toContain('Create an account');
  });

  it('derives pending, expired, accepted and revoked invitation states', () => {
    expect(invitationStatus(invitation())).toBe('pending');
    expect(invitationStatus(invitation({ expires_at: '2020-01-01T00:00:00Z' }))).toBe('expired');
    expect(invitationStatus(invitation({ status: 'accepted' }))).toBe('accepted');
    expect(invitationStatus(invitation({ status: 'revoked' }))).toBe('revoked');
  });

  it('keeps privileged Auth administration exclusively in the Edge Function', () => {
    expect(edgeFunction).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(edgeFunction).toContain("profile.role !== 'admin'");
    expect(edgeFunction).toContain('admin.auth.admin.inviteUserByEmail');
    expect(edgeFunction).toContain('admin.auth.admin.createUser');
    expect(edgeFunction).toContain('admin.auth.admin.updateUserById');
    expect(edgeFunction).toContain('admin.auth.admin.deleteUser');
    expect(authPages).not.toContain('SERVICE_ROLE');
  });

  it('handles CORS preflight before authentication and exposes configuration errors', () => {
    expect(edgeFunction.indexOf("request.method === 'OPTIONS'")).toBeLessThan(edgeFunction.indexOf("request.headers.get('authorization')"));
    expect(edgeFunction).toContain("Deno.env.get('ALLOWED_ORIGINS')");
    expect(edgeFunction).toContain('Access-Control-Max-Age');
  });

  it('enforces temporary-password onboarding in both routing and database authorization', () => {
    expect(app).toContain('profile.password_change_required');
    expect(authPages).toContain('completeRequiredPasswordChange');
    expect(temporaryMigration).toContain('and not password_change_required');
    expect(temporaryMigration).toContain('grant execute on function public.service_complete_password_change(uuid) to service_role');
    expect(temporaryMigration).toContain("'account.temporary_created'");
  });

  it('blocks non-invited Auth users and protects the last administrator', () => {
    expect(migration).toContain('if new.invited_at is null');
    expect(migration).toContain('Public registration is disabled');
    expect(migration).toContain('Cannot remove or disable the last active administrator');
    expect(migration).toContain("if not public.is_admin()");
  });
});
