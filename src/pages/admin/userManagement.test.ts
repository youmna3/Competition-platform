import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { invitationStatus } from './JudgesPage';
import type { UserInvitation } from '@/lib/types';

const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const authPages = readFileSync(new URL('../auth/AuthPages.tsx', import.meta.url), 'utf8');
const edgeFunction = readFileSync(new URL('../../../supabase/functions/admin-user-invitations/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260928000008_admin_user_invitations.sql', import.meta.url), 'utf8');
const temporaryMigration = readFileSync(new URL('../../../supabase/migrations/20260928000009_temporary_password_accounts.sql', import.meta.url), 'utf8');
const provisioningMigration = readFileSync(new URL('../../../supabase/migrations/20260928000010_secure_auth_provisioning.sql', import.meta.url), 'utf8');
const bulkMigration = readFileSync(new URL('../../../supabase/migrations/20261001000004_bulk_user_upload_governorate.sql', import.meta.url), 'utf8');
const bulkModal = readFileSync(new URL('./BulkUsersModal.tsx', import.meta.url), 'utf8');

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
    expect(edgeFunction).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(edgeFunction).toContain('profile.role !== "admin"');
    expect(edgeFunction).toContain('admin.auth.admin.inviteUserByEmail');
    expect(edgeFunction).toContain('admin.auth.admin.createUser');
    expect(edgeFunction).toContain('admin.auth.admin.updateUserById');
    expect(edgeFunction).toContain('admin.auth.admin.deleteUser');
    expect(authPages).not.toContain('SERVICE_ROLE');
  });

  it('handles CORS preflight before authentication and exposes configuration errors', () => {
    expect(edgeFunction.indexOf('request.method === "OPTIONS"')).toBeLessThan(edgeFunction.indexOf('request.headers.get("authorization")'));
    expect(edgeFunction).toContain('ALLOWED_ORIGINS');
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

  it('authorizes Auth Admin inserts with one-use server-issued provisioning tokens', () => {
    expect(edgeFunction).toContain("admin_begin_account_provisioning");
    expect(edgeFunction).toContain('p_method: "invitation"');
    expect(edgeFunction).toContain('p_method: "temporary_password"');
    expect(edgeFunction).toContain('provisioning_token: provisioned.data');
    expect(provisioningMigration).toContain("if not public.is_admin()");
    expect(provisioningMigration).toContain("digest(v_token::text,'sha256')");
    expect(provisioningMigration).toContain('and consumed_at is null');
    expect(provisioningMigration).toContain("raise exception 'Public registration is disabled; administrator provisioning is required'");
    expect(provisioningMigration).toContain('revoke all on public.account_provisioning_requests from public, anon, authenticated');
  });

  it('bulk creates temporary-password judges through the protected Edge Function',()=>{
    expect(edgeFunction).toContain('body.action === "bulk-create-users"');
    expect(edgeFunction).toContain('body.action === "bulk-check-users"');
    expect(edgeFunction).toContain("admin.auth.admin.createUser");
    expect(edgeFunction).toContain("admin_record_bulk_user");
    expect(bulkMigration).toContain("role='judge', status='approved'");
    expect(bulkMigration).toContain('password_change_required=true');
    expect(bulkMigration).not.toContain('p_password');
  });

  it('shows a governorate-aware preview and clears plaintext rows after processing',()=>{
    expect(bulkModal).toContain('Full Name, Email, Password, Governorate');
    expect(bulkModal).toContain('setRows([])');
    expect(bulkModal).toContain('password: ""');
    expect(bulkModal).not.toContain('localStorage');
    expect(bulkMigration).toContain('profile.governorate_changed');
    expect(bulkMigration).toContain("p.governorate_code=p_filters->>'governorate'");
  });
});
