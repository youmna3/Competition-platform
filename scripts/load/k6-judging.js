import exec from 'k6/execution';
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const fixture = JSON.parse(open(__ENV.K6_FIXTURE || './.staging-fixture.json'));
const userCount = Number(__ENV.K6_USERS || 30);
if (![30, 50].includes(userCount)) throw new Error('K6_USERS must be 30 or 50.');
if (fixture.projectRef === 'kdkwctsqfpwreebhftyn') throw new Error('Refusing to load-test the production project.');

const base = required('STAGING_SUPABASE_URL').replace(/\/$/, '');
const anonKey = required('STAGING_SUPABASE_ANON_KEY');
const target = fixture.targets[String(userCount)];
const selectedUsers = fixture.users.slice(0, userCount);

const apiErrors = new Rate('api_errors');
const lostSubmissions = new Counter('lost_submissions');
const duplicateEvaluations = new Counter('duplicate_evaluations');
const incorrectAverages = new Counter('incorrect_averages');
const loginTime = new Trend('login_time', true);
const rubricLoadTime = new Trend('rubric_load_time', true);
const draftSaveTime = new Trend('draft_save_time', true);
const submitTime = new Trend('submit_time', true);
const leaderboardTime = new Trend('leaderboard_time', true);
const refreshTime = new Trend('session_refresh_time', true);

export const options = {
  scenarios: {
    simultaneous_judging: {
      executor: 'per-vu-iterations',
      vus: userCount,
      iterations: 1,
      maxDuration: '5m',
    },
  },
  thresholds: {
    api_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    login_time: ['p(95)<2000'],
    rubric_load_time: ['p(95)<2000'],
    draft_save_time: ['p(95)<1500'],
    submit_time: ['p(95)<2000'],
    leaderboard_time: ['p(95)<1500'],
    lost_submissions: ['count==0'],
    duplicate_evaluations: ['count==0'],
    incorrect_averages: ['count==0'],
  },
};

export function setup() {
  if (selectedUsers.length !== userCount) fail(`Fixture has ${selectedUsers.length} users; ${userCount} required.`);
  return { target, users: selectedUsers, forbiddenTeamId: fixture.forbiddenTeamId };
}

export default function run(data) {
  const index = exec.vu.idInTest - 1;
  const user = data.users[index];
  const session = login(user.email, user.password);
  const headers = authHeaders(session.access_token);

  const teamResponse = timedGet(`${base}/rest/v1/teams?id=eq.${data.target.teamId}&select=*`, headers, 'team_load');
  const team = jsonArray(teamResponse, 'assigned team')[0];
  if (!team) fail('Assigned team was not visible.');

  const rubricStart = Date.now();
  const rubricResponses = http.batch([
    ['GET', `${base}/rest/v1/rubric_templates?id=eq.${team.template_id}&select=*`, null, { headers, tags: { operation: 'rubric_template' } }],
    ['GET', `${base}/rest/v1/rubric_sections?template_id=eq.${team.template_id}&select=*&order=position`, null, { headers, tags: { operation: 'rubric_sections' } }],
    ['GET', `${base}/rest/v1/rubric_criteria?template_id=eq.${team.template_id}&select=*&order=position`, null, { headers, tags: { operation: 'rubric_criteria' } }],
    ['GET', `${base}/rest/v1/rubric_score_levels?template_id=eq.${team.template_id}&select=*&order=value`, null, { headers, tags: { operation: 'rubric_scale' } }],
  ]);
  rubricLoadTime.add(Date.now() - rubricStart);
  rubricResponses.forEach((response) => record(response, response.status === 200, 'rubric load'));
  const criteria = jsonArray(rubricResponses[2], 'criteria');
  if (criteria.length < 20) fail(`Rubric returned only ${criteria.length} criteria.`);

  const evaluationId = rpc('start_evaluation', { p_team_id: team.id }, headers, 'start_evaluation');
  const repeatedId = rpc('start_evaluation', { p_team_id: team.id }, headers, 'start_evaluation_retry');
  check(repeatedId, { 'start is idempotent': (value) => value === evaluationId }) || duplicateEvaluations.add(1);

  const score = 1 + (index % 5);
  const draftA = criteria.slice(0, 5).map((criterion) => ({ criterion_id: criterion.id, score, note: `load-${userCount}-${index}` }));
  const draftB = criteria.slice(5, 10).map((criterion) => ({ criterion_id: criterion.id, score, note: `load-${userCount}-${index}` }));
  const draftStart = Date.now();
  const saves = http.batch([
    ['POST', `${base}/rest/v1/rpc/save_evaluation`, JSON.stringify({ p_evaluation_id: evaluationId, p_scores: draftA, p_section_notes: null, p_overall_notes: null }), { headers, tags: { operation: 'draft_save_parallel_a' } }],
    ['POST', `${base}/rest/v1/rpc/save_evaluation`, JSON.stringify({ p_evaluation_id: evaluationId, p_scores: draftB, p_section_notes: null, p_overall_notes: null }), { headers, tags: { operation: 'draft_save_parallel_b' } }],
  ]);
  draftSaveTime.add(Date.now() - draftStart);
  saves.forEach((response) => record(response, response.status === 200, 'parallel draft save'));

  // A refresh-token rotation plus a fresh read represents recovery after a
  // refresh/reconnect. The server-side draft must contain both save batches.
  sleep(0.2);
  const refreshed = refresh(session.refresh_token);
  const refreshedHeaders = authHeaders(refreshed.access_token);
  const draftRows = jsonArray(timedGet(`${base}/rest/v1/evaluation_scores?evaluation_id=eq.${evaluationId}&select=criterion_id,score`, refreshedHeaders, 'draft_recovery'), 'saved draft');
  check(draftRows, { 'parallel draft changes persisted': (rows) => rows.filter((row) => row.score !== null).length === 10 }) || lostSubmissions.add(1);

  const complete = criteria.map((criterion) => ({ criterion_id: criterion.id, score, note: `load-${userCount}-${index}` }));
  const submitStart = Date.now();
  const submitted = rpc('submit_evaluation', {
    p_evaluation_id: evaluationId,
    p_scores: complete,
    p_section_notes: {},
    p_overall_notes: `load-test-${userCount}-${index}`,
  }, refreshedHeaders, 'submit_evaluation');
  submitTime.add(Date.now() - submitStart);
  check(submitted, {
    'evaluation submitted': (row) => row.status === 'submitted',
    'submitted total is correct': (row) => Number(row.core_total) === score * 20,
  }) || lostSubmissions.add(1);

  const retry = rpc('submit_evaluation', { p_evaluation_id: evaluationId, p_scores: null, p_section_notes: null, p_overall_notes: null }, refreshedHeaders, 'submit_retry');
  check(retry, { 'submit retry is idempotent': (row) => row.id === evaluationId && row.status === 'submitted' }) || duplicateEvaluations.add(1);

  const boardStart = Date.now();
  const board = rpc('get_leaderboard', { p_organization: 'DEMI', p_competition: 'DEMI_G4', p_level: null, p_governorate: null }, refreshedHeaders, 'leaderboard_during_load');
  leaderboardTime.add(Date.now() - boardStart);
  check(board, { 'leaderboard returns an array': Array.isArray });
}

export function teardown(data) {
  const adminEmail = required('STAGING_ADMIN_EMAIL');
  const adminPassword = required('STAGING_ADMIN_PASSWORD');
  const admin = login(adminEmail, adminPassword);
  const headers = authHeaders(admin.access_token);
  const evaluations = jsonArray(timedGet(`${base}/rest/v1/evaluations?team_id=eq.${data.target.teamId}&select=id,team_id,judge_id,status,core_total`, headers, 'integrity_evaluations'), 'evaluations');
  const unique = new Set(evaluations.map((row) => `${row.team_id}:${row.judge_id}`));
  if (evaluations.length !== userCount || evaluations.some((row) => row.status !== 'submitted')) lostSubmissions.add(1);
  if (unique.size !== evaluations.length) duplicateEvaluations.add(evaluations.length - unique.size);

  const results = rpc('admin_team_results', {}, headers, 'integrity_results');
  const result = results.find((row) => row.team_id === data.target.teamId);
  if (!result || !result.is_complete || result.judges_required !== userCount || result.judges_submitted !== userCount) lostSubmissions.add(1);
  if (!result || Number(result.avg_core) !== data.target.expectedCoreAverage) incorrectAverages.add(1);

  const board = rpc('get_leaderboard', { p_organization: 'DEMI', p_competition: 'DEMI_G4', p_level: null, p_governorate: null }, headers, 'integrity_leaderboard');
  const leaderboardRow = board.find((row) => row.team_id === data.target.teamId);
  if (!leaderboardRow || Number(leaderboardRow.avg_core) !== data.target.expectedCoreAverage) incorrectAverages.add(1);
}

function login(email, password) {
  const started = Date.now();
  const response = http.post(`${base}/auth/v1/token?grant_type=password`, JSON.stringify({ email, password }), {
    headers: baseHeaders(), tags: { operation: 'login' },
  });
  loginTime.add(Date.now() - started);
  record(response, response.status === 200, 'login');
  return response.json();
}

function refresh(refreshToken) {
  const started = Date.now();
  const response = http.post(`${base}/auth/v1/token?grant_type=refresh_token`, JSON.stringify({ refresh_token: refreshToken }), {
    headers: baseHeaders(), tags: { operation: 'session_refresh' },
  });
  refreshTime.add(Date.now() - started);
  record(response, response.status === 200, 'session refresh');
  return response.json();
}

function rpc(name, body, headers, operation) {
  const response = http.post(`${base}/rest/v1/rpc/${name}`, JSON.stringify(body), { headers, tags: { operation } });
  record(response, response.status === 200, operation);
  return response.json();
}

function timedGet(url, headers, operation) {
  const response = http.get(url, { headers, tags: { operation } });
  record(response, response.status === 200, operation);
  return response;
}

function jsonArray(response, label) {
  const value = response.json();
  if (!Array.isArray(value)) fail(`${label} did not return an array: ${response.status}`);
  return value;
}

function record(response, ok, label) {
  apiErrors.add(!ok);
  if (!check(response, { [`${label} succeeded`]: () => ok })) fail(`${label} failed (${response.status}): ${response.body}`);
}

function baseHeaders() {
  return { apikey: anonKey, 'Content-Type': 'application/json' };
}

function authHeaders(accessToken) {
  return { ...baseHeaders(), Authorization: `Bearer ${accessToken}` };
}

function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
