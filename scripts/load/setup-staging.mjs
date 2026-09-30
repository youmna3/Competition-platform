import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const productionProjectRef = 'kdkwctsqfpwreebhftyn';
const url = required('STAGING_SUPABASE_URL').replace(/\/$/, '');
const anonKey = required('STAGING_SUPABASE_ANON_KEY');
const serviceRoleKey = required('STAGING_SUPABASE_SERVICE_ROLE_KEY');
const adminEmail = required('STAGING_ADMIN_EMAIL');
const adminPassword = required('STAGING_ADMIN_PASSWORD');
const projectRef = new URL(url).hostname.split('.')[0];

if (projectRef === productionProjectRef || process.env.CONFIRM_STAGING_SEED !== projectRef) {
  throw new Error(`Refusing to seed ${projectRef}. Set CONFIRM_STAGING_SEED to the non-production staging project ref.`);
}

const adminClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signedIn, error: signInError } = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
if (signInError || !signedIn.user) throw new Error(`Staging administrator login failed: ${signInError?.message ?? 'no user'}`);
const { data: adminProfile, error: adminProfileError } = await adminClient.from('profiles').select('role,status').eq('id', signedIn.user.id).single();
if (adminProfileError || adminProfile?.role !== 'admin' || adminProfile.status !== 'approved') {
  throw new Error('STAGING_ADMIN_EMAIL is not an approved administrator.');
}

const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const sharedPassword = `Lt!${randomBytes(18).toString('base64url')}9a`;
const users = [];

for (let index = 1; index <= 50; index += 1) {
  const email = `load-judge-${String(index).padStart(2, '0')}@loadtest.invalid`;
  let user = await findAuthUser(email);
  if (!user) {
    const token = randomUUID();
    const tokenHash = `\\x${createHash('sha256').update(token.toLowerCase()).digest('hex')}`;
    const { error: provisioningError } = await service.from('account_provisioning_requests').insert({
      token_hash: tokenHash,
      email,
      method: 'temporary_password',
      created_by: signedIn.user.id,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (provisioningError) throw new Error(`Provisioning ${email} failed: ${provisioningError.message}`);
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: sharedPassword,
      email_confirm: true,
      user_metadata: { full_name: `Load Judge ${index}`, provisioning_token: token },
    });
    if (error || !data.user) throw new Error(`Creating ${email} failed: ${error?.message ?? 'no user'}`);
    user = data.user;
  } else {
    const { error } = await service.auth.admin.updateUserById(user.id, { password: sharedPassword, email_confirm: true });
    if (error) throw new Error(`Resetting ${email} failed: ${error.message}`);
  }
  const { error: profileError } = await service.from('profiles').update({
    full_name: `Load Judge ${index}`,
    role: 'judge',
    status: 'approved',
    password_change_required: false,
  }).eq('id', user.id);
  if (profileError) throw new Error(`Approving ${email} failed: ${profileError.message}`);
  users.push({ id: user.id, email, password: sharedPassword });
}

const team30 = await createTeam(`LOAD30-${runId}`, '30-user shared team');
const team50 = await createTeam(`LOAD50-${runId}`, '50-user shared team');
const forbiddenTeam = await createTeam(`LOAD-DENY-${runId}`, 'RLS control team');
await assign(team30.id, users.slice(0, 30));
await assign(team50.id, users);

const { error: publishError } = await service.from('competitions').update({
  is_published: true,
  published_at: new Date().toISOString(),
  published_by: signedIn.user.id,
}).eq('code', 'DEMI_G4');
if (publishError) throw new Error(`Publishing staging leaderboard failed: ${publishError.message}`);

const fixture = {
  generatedAt: new Date().toISOString(),
  projectRef,
  users,
  targets: {
    30: { teamId: team30.id, teamCode: team30.team_code, expectedJudges: 30, expectedCoreAverage: 60 },
    50: { teamId: team50.id, teamCode: team50.team_code, expectedJudges: 50, expectedCoreAverage: 60 },
  },
  forbiddenTeamId: forbiddenTeam.id,
};
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./.staging-fixture.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
console.log(`Prepared staging fixtures for 30 and 50 users in project ${projectRef}.`);

async function findAuthUser(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Listing staging users failed: ${error.message}`);
    const found = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
}

async function createTeam(teamCode, name) {
  const { data: existing, error: findError } = await service.from('teams').select('*').eq('organization', 'DEMI').ilike('team_code', teamCode).maybeSingle();
  if (findError) throw new Error(`Looking up ${teamCode} failed: ${findError.message}`);
  if (existing) return existing;
  const { data, error } = await service.from('teams').insert({
    team_code: teamCode,
    name,
    project_name: 'Concurrency and recovery validation',
    level_code: 'G4',
    governorate_code: 'CAI',
    created_by: signedIn.user.id,
  }).select('*').single();
  if (error) throw new Error(`Creating ${teamCode} failed: ${error.message}`);
  return data;
}

async function assign(teamId, judges) {
  const rows = judges.map((judge) => ({ team_id: teamId, judge_id: judge.id, assigned_by: signedIn.user.id }));
  const { error } = await service.from('team_judges').upsert(rows, { onConflict: 'team_id,judge_id', ignoreDuplicates: true });
  if (error) throw new Error(`Assigning judges to ${teamId} failed: ${error.message}`);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
