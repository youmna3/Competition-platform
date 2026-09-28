// End-to-end browser test against a local Supabase-compatible stack
// (GoTrue + PostgREST + Postgres with the project migrations applied).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import ExcelJS from '/home/claude/judging-platform/node_modules/exceljs/dist/es5/index.js';

const BASE = 'http://127.0.0.1:5173';
const SHOTS = process.env.SHOTS || '/var/tmp/e2e/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const PW = 'Str0ngPass!';
const sql = (q) => execFileSync('psql', ['-tAq', '-h', '/var/tmp/pgtest', '-p', '54329', '-U', 'postgres', '-d', 'supa', '-c', q]).toString().trim();

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok -', msg); else { failures++; console.log('  FAIL -', msg); } };
const consoleErrors = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());

async function ctx(viewport = { width: 1440, height: 900 }) {
  const c = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await c.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/realtime|websocket|WebSocket/i.test(m.text())) consoleErrors.push(m.text()); });
  p.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  return { c, p };
}
async function signup(p, name, email) {
  await p.goto(`${BASE}/signup`);
  await p.getByLabel('Full name').fill(name);
  await p.getByLabel('E-mail').fill(email);
  await p.getByLabel('Password', { exact: false }).first().fill(PW);
  await p.getByLabel('Confirm password').fill(PW);
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.waitForURL('**/pending');
}
async function login(p, email) {
  await p.goto(`${BASE}/login`);
  await p.getByLabel('E-mail').fill(email);
  await p.getByLabel('Password').fill(PW);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
}
/** scores: array for every radiogroup in order (core rows then bonus rows); null = skip */
async function score(p, values) {
  const groups = p.getByRole('radiogroup');
  await groups.first().waitFor();
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    await groups.nth(i).getByRole('radio', { name: String(values[i]), exact: true }).click();
  }
}
const arr = (n5, other, nOther) => [...Array(n5).fill(5), ...Array(nOther).fill(other)];
async function openTeam(p, org, comp, teamName) {
  await p.goto(`${BASE}/judge`);
  await p.getByRole('button', { name: new RegExp(`^${org}`) }).click();
  await p.getByRole('button', { name: new RegExp(comp) }).click();
  await p.getByRole('link', { name: new RegExp(teamName) }).click();
  await p.getByRole('radiogroup').first().waitFor();
}
async function submit(p) {
  await p.getByRole('button', { name: /^Submit$/ }).click();
  const btn = p.getByRole('button', { name: /Submit final scores/ });
  await btn.waitFor();
  await Promise.allSettled([btn.click({ timeout: 4000 }), btn.click({ force: true, timeout: 4000 }), btn.click({ force: true, timeout: 4000 })]); // rapid repeated clicks
  await p.getByText('Submitted', { exact: true }).first().waitFor();
}

try {
  // ---------------------------------------------------------------- sign-ups
  console.log('1. Sign-up (pending approval)');
  const a = await ctx();
  await signup(a.p, 'Aya Admin', 'admin@demo.test');
  await a.p.screenshot({ path: `${SHOTS}/01-pending-approval.png` });
  ok(await a.p.getByText('Awaiting approval').isVisible(), 'new account lands on awaiting-approval page');
  for (const [n, e] of [['Judge One', 'judge1@demo.test'], ['Judge Two', 'judge2@demo.test']]) {
    const x = await ctx(); await signup(x.p, n, e); await x.c.close();
  }
  ok(sql("select count(*) from profiles where status='pending' and role='judge'") === '3', 'three pending judge profiles created by trigger');
  sql("update profiles set role='admin', status='approved' where email='admin@demo.test'");

  // ---------------------------------------------------------------- admin approves
  console.log('2. Admin approves judges');
  await a.p.goto(`${BASE}/`);
  await a.p.waitForURL('**/admin');
  await a.p.getByText('awaiting approval').waitFor();
  await a.p.goto(`${BASE}/admin/judges?status=pending`);
  await a.p.getByText('judge1@demo.test').waitFor();
  await a.p.screenshot({ path: `${SHOTS}/02-judges-pending.png` });
  for (let i = 0; i < 2; i++) {
    await a.p.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await a.p.waitForTimeout(700);
  }
  ok(sql("select count(*) from profiles where status='approved' and role='judge'") === '2', 'two judges approved via UI');

  // ---------------------------------------------------------------- import teams
  console.log('3. Bulk import + manual team registration');
  const csv = [
    'Team ID,Team Name,Project Name,Organization,Grade or Level,Governorate,Judge Emails',
    'T-101,Nile Coders,Water Saver App,DEMI,Grade 4,Cairo,judge1@demo.test; judge2@demo.test',
    'T-102,Pharos Minds,Smart Library,DEMI,Grade 4,Alexandria,judge1@demo.test',
    'T-201,Delta Makers,Crop Guardian,DECI,Level 4,Suez,judge1@demo.test;judge2@demo.test',
    'T-202,Canal Tech,Safe Home IoT,DECI,Level 5,Assiut,judge2@demo.test',
  ].join('\n');
  fs.writeFileSync('/var/tmp/e2e/teams.csv', csv);
  await a.p.goto(`${BASE}/admin/teams`);
  await a.p.getByRole('button', { name: /Import CSV/ }).click();
  await a.p.locator('input[type=file]').setInputFiles('/var/tmp/e2e/teams.csv');
  await a.p.getByText('all valid').waitFor();
  await a.p.screenshot({ path: `${SHOTS}/03-import-preview.png` });
  await a.p.getByRole('button', { name: /Import 4 teams/ }).click();
  await a.p.getByRole('dialog').waitFor({ state: 'hidden' });
  await a.p.getByText('Nile Coders').waitFor();
  ok(sql('select count(*) from teams') === '4' && sql('select count(*) from team_judges') === '6', 'import created 4 teams and 6 assignments');

  await a.p.getByRole('button', { name: 'Register team' }).first().click();
  const modal = a.p.getByRole('dialog');
  await modal.getByLabel('Unique team ID').fill('T-103');
  await modal.getByLabel('Team name').fill('Luxor Robotics');
  await modal.getByLabel('Project name').fill('Health Band');
  await modal.getByLabel('Governorate').selectOption({ label: 'Monufia' });
  await modal.getByLabel('Organization').selectOption('DEMI');
  await modal.getByLabel('Grade or level').selectOption({ label: 'Grade 5' });
  await modal.getByText('judge2@demo.test').click();
  await modal.getByRole('button', { name: 'Save team' }).click();
  await a.p.getByText('Luxor Robotics').waitFor();
  ok(sql("select count(*) from team_judges tj join teams t on t.id=tj.team_id where t.team_code='T-103'") === '1', 'manual team registered with a judge');
  await a.p.screenshot({ path: `${SHOTS}/04-teams.png` });

  // ---------------------------------------------------------------- judge 1
  console.log('4. Judge 1: draft auto-save, validation, submit (idempotent)');
  const j1 = await ctx();
  await login(j1.p, 'judge1@demo.test');
  await j1.p.waitForURL('**/judge');
  ok(!(await j1.p.getByText('Canal Tech').isVisible().catch(() => false)), 'judge 1 does not see unassigned teams');
  await j1.p.screenshot({ path: `${SHOTS}/05-judge-home.png` });
  await openTeam(j1.p, 'DEMI', 'Grade 4', 'Nile Coders');
  ok(await j1.p.getByRole('radiogroup').count() === 22, 'Grade 4 form shows 20 core + 2 bonus rows');
  ok(await j1.p.getByRole('button', { name: /^Submit$/ }).isDisabled(), 'submit disabled while incomplete');
  await score(j1.p, arr(10, 5, 0));
  await j1.p.getByLabel('Judge note for Problem & target user').fill('Clear problem statement');
  await j1.p.getByText(/Draft saved/).waitFor({ timeout: 10000 });
  await j1.p.reload();
  await j1.p.getByRole('radiogroup').first().waitFor();
  const checked = await j1.p.locator('[role=radio][aria-checked=true]').count();
  ok(checked === 10, `draft persisted in database across reload (${checked}/10 scores)`);
  ok(await j1.p.getByLabel('Judge note for Problem & target user').inputValue() === 'Clear problem statement', 'judge note persisted');
  await j1.p.screenshot({ path: `${SHOTS}/06-rubric-draft.png`, fullPage: true });
  await score(j1.p, [null, null, null, null, null, null, null, null, null, null, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2, 4, null]);
  ok(await j1.p.getByText('85', { exact: true }).first().isVisible(), 'live core total shows 85');
  await submit(j1.p);
  ok(sql("select count(*) from evaluations e join teams t on t.id=e.team_id where t.team_code='T-101'") === '1', 'triple-click submit produced exactly one evaluation');
  ok(sql("select count(*) from audit_log where action='evaluation.submitted'") === '1', 'submission recorded once');
  ok(sql("select core_total||'/'||bonus_total from evaluations e join teams t on t.id=e.team_id where t.team_code='T-101'") === '85/4', 'server totals 85 core / 4 bonus');
  await j1.p.screenshot({ path: `${SHOTS}/07-rubric-submitted.png` });

  await openTeam(j1.p, 'DEMI', 'Grade 4', 'Pharos Minds');
  await score(j1.p, arr(10, 4, 10)); await submit(j1.p);
  await openTeam(j1.p, 'DECI', 'Levels 4 & 5', 'Delta Makers');
  ok(await j1.p.getByRole('radiogroup').count() === 23, 'Levels 4 & 5 form shows 20 core + 3 bonus rows');
  await score(j1.p, [...arr(16, 4, 4), 5, 5, 5]); await submit(j1.p);

  // ---------------------------------------------------------------- pending exclusion
  console.log('5. Pending teams excluded');
  await a.p.goto(`${BASE}/leaderboard?org=DEMI`);
  await a.p.getByText('Pharos Minds').waitFor();
  ok(!(await a.p.getByText('Nile Coders').isVisible()), 'T-101 (1 of 2 judges) not on leaderboard');

  // ---------------------------------------------------------------- judge 2
  console.log('6. Judge 2 independent evaluations');
  const j2 = await ctx();
  await login(j2.p, 'judge2@demo.test');
  await openTeam(j2.p, 'DEMI', 'Grade 4', 'Nile Coders');
  ok(await j2.p.locator('[role=radio][aria-checked=true]').count() === 0, "judge 2 starts blank (cannot see judge 1's scores)");
  await score(j2.p, [...arr(15, 4, 5), 5, 5]); await submit(j2.p);
  await openTeam(j2.p, 'DECI', 'Levels 4 & 5', 'Delta Makers');
  await score(j2.p, [...arr(10, 3, 10), 1]); await submit(j2.p);
  await openTeam(j2.p, 'DECI', 'Levels 4 & 5', 'Canal Tech');
  await score(j2.p, arr(12, 4, 8)); await submit(j2.p);
  await openTeam(j2.p, 'DEMI', 'Grade 5', 'Luxor Robotics');
  await score(j2.p, arr(6, 3, 0));
  await j2.p.getByText(/Draft saved/).waitFor({ timeout: 10000 });
  const t102 = sql("select id from teams where team_code='T-102'");
  await j2.p.goto(`${BASE}/evaluate/${t102}`);
  await j2.p.getByText('Cannot open this evaluation').waitFor();
  ok(true, 'judge 2 blocked from an unassigned team via direct URL');

  // ---------------------------------------------------------------- leaderboards
  console.log('7. Averaging, ties, separation, publication');
  await a.p.goto(`${BASE}/leaderboard?org=DEMI`);
  await a.p.getByText('Nile Coders').waitFor({ timeout: 35000 });
  const demiText = await a.p.locator('main').innerText();
  ok(/Nile Coders[\s\S]*90/.test(demiText), 'T-101 average (85+95)/2 = 90 shown');
  ok((demiText.match(/=1/g) || []).length === 2, 'T-101 and T-102 tie at 90 and share rank =1 (no tie-break)');
  ok(!/Delta Makers|Canal Tech/.test(demiText), 'DEMI board contains no DECI teams');
  await a.p.screenshot({ path: `${SHOTS}/08-leaderboard-demi-admin.png`, fullPage: true });
  await a.p.goto(`${BASE}/leaderboard?org=DECI`);
  await a.p.getByText('Delta Makers').waitFor();
  const deciText = await a.p.locator('main').innerText();
  ok(/Canal Tech[\s\S]*92[\s\S]*Delta Makers[\s\S]*88/.test(deciText), 'Levels 4 & 5: T-202 92 ranked above T-201 88');
  ok(/Level 5[\s\S]*Level 4/.test(deciText), 'actual levels displayed in combined category');
  await a.p.screenshot({ path: `${SHOTS}/09-leaderboard-deci-admin.png`, fullPage: true });
  await a.p.goto(`${BASE}/leaderboard?org=DECI&level=l:L4`);
  await a.p.getByText('Delta Makers').waitFor();
  ok(!(await a.p.getByText('Canal Tech').isVisible()), 'Level 4 filter shows only level-4 teams');

  const anon = await ctx();
  await anon.p.goto(`${BASE}/leaderboard?org=DEMI`);
  await anon.p.getByText('No published results yet').waitFor();
  ok(true, 'anonymous visitor sees nothing before publication');
  await a.p.goto(`${BASE}/leaderboard?org=DEMI`);
  await a.p.getByRole('heading', { name: 'Grade 4' }).waitFor();
  await a.p.getByRole('button', { name: 'Publish' }).first().click();
  await a.p.getByText(/Published /).first().waitFor();
  await anon.p.reload();
  await anon.p.getByText('Nile Coders').waitFor();
  ok(!(await anon.p.getByRole('heading', { name: 'Grade 5' }).isVisible()), 'only the published Grade 4 board is public');
  await anon.p.screenshot({ path: `${SHOTS}/10-leaderboard-public.png`, fullPage: true });

  // ---------------------------------------------------------------- dashboard, results, reopen, export
  console.log('8. Dashboard, per-judge view, reopen & audit, export');
  await a.p.goto(`${BASE}/admin`);
  await a.p.getByText('Highest-scoring teams').waitFor();
  const dash = await a.p.locator('main').innerText();
  ok(/Completed evaluations\s*6/i.test(dash), 'dashboard: 6 completed evaluations');
  ok(/Pending evaluations\s*1/i.test(dash), 'dashboard: 1 pending evaluation');
  await a.p.screenshot({ path: `${SHOTS}/11-admin-dashboard.png`, fullPage: true });

  await a.p.goto(`${BASE}/admin/results`);
  await a.p.getByText('Nile Coders').click();
  await a.p.getByRole('link', { name: /Open/ }).first().click();
  await a.p.getByText('Read-only administrator view').waitFor();
  await a.p.screenshot({ path: `${SHOTS}/12-admin-evaluation-view.png` });
  await a.p.getByRole('button', { name: /Reopen for correction/ }).click();
  await a.p.getByRole('dialog').getByRole('textbox').fill('Judge asked to correct a score');
  await a.p.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
  await a.p.getByText('Draft — not yet submitted').waitFor();
  ok(sql("select count(*) from audit_log where action='evaluation.reopened'") === '1', 'reopen audited');
  await a.p.goto(`${BASE}/leaderboard?org=DEMI`);
  await a.p.getByText('Pharos Minds').waitFor();
  ok(!(await a.p.getByText('Nile Coders').isVisible()), 'reopened team removed from official ranking');

  await a.p.goto(`${BASE}/admin/results`);
  const [dl] = await Promise.all([a.p.waitForEvent('download'), a.p.getByRole('button', { name: /Export all results/ }).click()]);
  const xlsx = '/var/tmp/e2e/export.xlsx';
  await dl.saveAs(xlsx);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const names = wb.worksheets.map((w) => w.name);
  ok(names.join('|') === 'Official Leaderboard|All Teams Status|Judge Evaluations|Criterion Scores|Audit Log', `export workbook sheets: ${names.join(', ')}`);
  ok(wb.getWorksheet('Criterion Scores').rowCount - 1 === 7 * 22 + 0 || wb.getWorksheet('Criterion Scores').rowCount > 100, 'criterion-level scores exported');
  await a.p.goto(`${BASE}/admin/audit`);
  await a.p.getByText('score.changed').first().waitFor();
  await a.p.screenshot({ path: `${SHOTS}/13-audit.png` });

  // ---------------------------------------------------------------- mobile
  console.log('9. Mobile layout');
  const m = await ctx({ width: 390, height: 844 });
  await login(m.p, 'judge2@demo.test');
  await openTeam(m.p, 'DEMI', 'Grade 5', 'Luxor Robotics');
  const overflow = await m.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'no horizontal page scroll on a phone');
  await m.p.screenshot({ path: `${SHOTS}/14-mobile-rubric.png` });
  await m.p.goto(`${BASE}/judge`);
  await m.p.screenshot({ path: `${SHOTS}/15-mobile-judge-home.png` });
} catch (e) {
  failures++;
  console.error('ERROR', e);
} finally {
  await browser.close();
}
console.log('\nConsole errors:', consoleErrors.length ? consoleErrors : 'none');
console.log(failures === 0 ? 'E2E PASSED' : `E2E: ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
