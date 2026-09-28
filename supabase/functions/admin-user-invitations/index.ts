import { createClient } from 'npm:@supabase/supabase-js@^2';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const appUrls = (Deno.env.get('APP_URL') ?? '').split(',').map(normalizeOrigin).filter(Boolean);
const allowedOrigins = new Set([...appUrls, ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(normalizeOrigin).filter(Boolean)]);
const expirySeconds = Math.max(300, Number(Deno.env.get('INVITE_EXPIRY_SECONDS') ?? '3600'));

function normalizeOrigin(value: string): string { return value.trim().replace(/\/$/, ''); }
function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function json(body: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) } });
}

function temporaryPassword(): string {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*_-+='];
  const all = groups.join('');
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const values = [...groups.map(pick), ...Array.from({ length: 16 }, () => pick(all))];
  for (let i = values.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values.join('');
}

type RequestBody = { action?: string; invitationId?: string; fullName?: string; email?: string; teamIds?: string[]; password?: string };

Deno.serve(async (request) => {
  const origin = normalizeOrigin(request.headers.get('origin') ?? '');
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  // Handle preflight before credentials or body parsing. Echoing a rejected
  // origin exposes the useful 403 message but never authorizes an operation.
  if (request.method === 'OPTIONS') {
    if (origin && !localOrigin && !allowedOrigins.has(origin)) return json({ error: `Origin ${origin} is not listed in ALLOWED_ORIGINS` }, 403, origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (origin && !localOrigin && !allowedOrigins.has(origin)) return json({ error: `Origin ${origin} is not listed in ALLOWED_ORIGINS` }, 403, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (!url || !serviceKey || !anonKey) return json({ error: 'The Edge Function is missing its server-side Supabase credentials' }, 500, origin);

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const authorization = request.headers.get('authorization') ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Authentication required' }, 401, origin);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'Invalid or expired session' }, 401, origin);

    let body: RequestBody;
    try { body = await request.json() as RequestBody; }
    catch { return json({ error: 'Request body must be valid JSON' }, 400, origin); }

    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('role,status,password_change_required').eq('id', userData.user.id).single();
    if (profileError) return json({ error: `Account profile could not be loaded: ${profileError.message}` }, 500, origin);

    if (body.action === 'complete-password-change') {
      if (!profile.password_change_required) return json({ error: 'Password change is not required for this account' }, 409, origin);
      const password = body.password ?? '';
      if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        return json({ error: 'Use at least 12 characters with uppercase, lowercase, a number and a symbol' }, 400, origin);
      }
      if (!userData.user.email) return json({ error: 'The account has no sign-in e-mail' }, 400, origin);
      const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const unchanged = await verifier.auth.signInWithPassword({ email: userData.user.email, password });
      if (!unchanged.error) {
        await verifier.auth.signOut();
        return json({ error: 'The new password must be different from the temporary password' }, 400, origin);
      }
      const changed = await admin.auth.admin.updateUserById(userData.user.id, { password });
      if (changed.error) return json({ error: `Password could not be changed: ${changed.error.message}` }, 400, origin);
      const completed = await admin.rpc('service_complete_password_change', { p_user_id: userData.user.id });
      if (completed.error) return json({ error: `Password changed, but account activation failed: ${completed.error.message}` }, 500, origin);
      return json({ changed: true }, 200, origin);
    }

    if (profile.role !== 'admin' || profile.status !== 'approved' || profile.password_change_required) {
      return json({ error: 'Administrator access required' }, 403, origin);
    }

    const caller = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    if (body.action === 'invite') {
      if (!appUrls[0]) return json({ error: 'APP_URL is not configured for invitation redirects' }, 500, origin);
      const fullName = body.fullName?.trim() ?? '';
      const email = body.email?.trim().toLowerCase() ?? '';
      const teamIds = Array.isArray(body.teamIds) ? body.teamIds : [];
      if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'A valid name and e-mail are required' }, 400, origin);
      const redirectTo = `${appUrls[0]}/reset-password?invitation=1`;
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
      if (error || !data.user) return json({ error: error?.message ?? 'Invitation could not be created' }, error?.status ?? 400, origin);
      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
      const recorded = await caller.rpc('admin_record_invitation', {
        p_invitation_id: null, p_auth_user_id: data.user.id, p_email: email, p_full_name: fullName,
        p_expires_at: expiresAt, p_team_ids: teamIds,
      });
      if (recorded.error) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: recorded.error.message }, 400, origin);
      }
      return json({ invitationId: recorded.data, email, expiresAt }, 201, origin);
    }

    if (body.action === 'create-temporary') {
      const fullName = body.fullName?.trim() ?? '';
      const email = body.email?.trim().toLowerCase() ?? '';
      const teamIds = Array.isArray(body.teamIds) ? body.teamIds : [];
      if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'A valid name and e-mail are required' }, 400, origin);
      const password = temporaryPassword();
      const created = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { account_creation: 'temporary_password' },
      });
      if (created.error || !created.data.user) {
        const duplicate = /already|registered|exists/i.test(created.error?.message ?? '');
        return json({ error: duplicate ? 'An account with this e-mail already exists' : (created.error?.message ?? 'Account could not be created') }, created.error?.status ?? 400, origin);
      }
      const recorded = await caller.rpc('admin_record_temporary_user', {
        p_auth_user_id: created.data.user.id, p_email: email, p_full_name: fullName, p_team_ids: teamIds,
      });
      if (recorded.error) {
        await admin.auth.admin.deleteUser(created.data.user.id);
        return json({ error: recorded.error.message }, 400, origin);
      }
      return json({ userId: created.data.user.id, email, temporaryPassword: password }, 201, origin);
    }

    if (body.action === 'resend') {
      if (!appUrls[0]) return json({ error: 'APP_URL is not configured for invitation redirects' }, 500, origin);
      if (!body.invitationId) return json({ error: 'Invitation ID is required' }, 400, origin);
      const { data: invitation } = await admin.from('user_invitations').select('*').eq('id', body.invitationId).single();
      if (!invitation || invitation.status !== 'pending') return json({ error: 'Only pending or expired invitations can be resent' }, 400, origin);
      const { data: assignments } = await admin.from('team_judges').select('team_id').eq('judge_id', invitation.auth_user_id);
      const removed = await admin.auth.admin.deleteUser(invitation.auth_user_id);
      if (removed.error) return json({ error: removed.error.message }, 400, origin);
      const redirectTo = `${appUrls[0]}/reset-password?invitation=1`;
      const invited = await admin.auth.admin.inviteUserByEmail(invitation.email, { data: { full_name: invitation.full_name }, redirectTo });
      if (invited.error || !invited.data.user) return json({ error: invited.error?.message ?? 'Invitation could not be resent' }, 400, origin);
      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
      const recorded = await caller.rpc('admin_record_invitation', {
        p_invitation_id: invitation.id, p_auth_user_id: invited.data.user.id, p_email: invitation.email,
        p_full_name: invitation.full_name, p_expires_at: expiresAt, p_team_ids: (assignments ?? []).map((row) => row.team_id),
      });
      if (recorded.error) return json({ error: recorded.error.message }, 400, origin);
      return json({ invitationId: invitation.id, email: invitation.email, expiresAt }, 200, origin);
    }

    if (body.action === 'revoke') {
      if (!body.invitationId) return json({ error: 'Invitation ID is required' }, 400, origin);
      const { data: invitation } = await admin.from('user_invitations').select('auth_user_id,status').eq('id', body.invitationId).single();
      if (!invitation || invitation.status !== 'pending') return json({ error: 'Pending invitation not found' }, 400, origin);
      const removed = await admin.auth.admin.deleteUser(invitation.auth_user_id);
      if (removed.error) return json({ error: removed.error.message }, 400, origin);
      const revoked = await caller.rpc('admin_revoke_invitation', { p_invitation_id: body.invitationId });
      if (revoked.error) return json({ error: revoked.error.message }, 400, origin);
      return json({ revoked: true }, 200, origin);
    }

    return json({ error: 'Unsupported action' }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected account service error' }, 500, origin);
  }
});
