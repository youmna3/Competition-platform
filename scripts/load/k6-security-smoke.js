import http from 'k6/http';
import { check } from 'k6';

const fixture = JSON.parse(open(__ENV.K6_FIXTURE || './.staging-fixture.json'));
const base = required('STAGING_SUPABASE_URL').replace(/\/$/, '');
const anonKey = required('STAGING_SUPABASE_ANON_KEY');
if (fixture.projectRef === 'kdkwctsqfpwreebhftyn') throw new Error('Refusing to test the production project.');

export const options = { vus: 1, iterations: 1, thresholds: { checks: ['rate==1'] } };

export default function securitySmoke() {
  const judge = fixture.users[0];
  const session = login(judge.email, judge.password);
  const judgeHeaders = headers(session.access_token);

  const anonymousTeams = http.get(`${base}/rest/v1/teams?select=id&limit=1`, { headers: headers() });
  check(anonymousTeams, { 'anonymous users cannot read teams': (response) => response.status === 401 || response.status === 403 });

  const forbidden = http.get(`${base}/rest/v1/teams?id=eq.${fixture.forbiddenTeamId}&select=*`, { headers: judgeHeaders });
  check(forbidden, { 'judge cannot read an unassigned team': (response) => response.status === 200 && response.json().length === 0 });

  const adminResults = http.post(`${base}/rest/v1/rpc/admin_team_results`, '{}', { headers: judgeHeaders });
  check(adminResults, { 'judge cannot call administrator result RPC': (response) => response.status === 401 || response.status === 403 });

  const directEvaluation = http.post(`${base}/rest/v1/evaluations`, JSON.stringify({
    team_id: fixture.targets['30'].teamId,
    judge_id: judge.id,
    template_id: 'DEMI_G4',
  }), { headers: { ...judgeHeaders, Prefer: 'return=representation' } });
  check(directEvaluation, { 'judge cannot insert evaluations directly': (response) => response.status === 401 || response.status === 403 });

  const invitation = http.post(`${base}/functions/v1/admin-user-invitations`, JSON.stringify({
    action: 'invite', fullName: 'Unauthorized Invite', email: `deny-${Date.now()}@loadtest.invalid`, teamIds: [],
  }), { headers: judgeHeaders });
  check(invitation, { 'judge cannot invoke account management': (response) => response.status === 401 || response.status === 403 });

  const signup = http.post(`${base}/auth/v1/signup`, JSON.stringify({
    email: `public-${Date.now()}@loadtest.invalid`, password: 'Blocked!Public12345',
  }), { headers: headers() });
  check(signup, { 'public signup remains blocked': (response) => response.status < 200 || response.status >= 300 });
}

function login(email, password) {
  const response = http.post(`${base}/auth/v1/token?grant_type=password`, JSON.stringify({ email, password }), { headers: headers() });
  if (response.status !== 200) throw new Error(`Judge login failed: ${response.status}`);
  return response.json();
}

function headers(accessToken) {
  return {
    apikey: anonKey,
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
