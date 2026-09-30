import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Evaluation, Profile, Team, TeamJudge } from './types';
import { buildJudgeProgress, evaluationProgressStatus } from './judgeProgress';

const profile = (id: string, name: string): Profile => ({
  id, email: `${id}@example.com`, full_name: name, role: 'judge', status: 'approved', password_change_required: false,
  reviewed_at: null, reviewed_by: null, created_at: '2026-01-01', updated_at: '2026-01-01',
});
const team = (id: string, organization: 'DEMI' | 'DECI'): Team => ({
  id, team_code: id.toUpperCase(), name: `Team ${id}`, project_name: `Project ${id}`, organization,
  level_code: organization === 'DEMI' ? 'G4' : 'L1', governorate_code: 'CAI', template_id: organization === 'DEMI' ? 'DEMI_G4' : 'DECI_L1',
  created_at: '2026-01-01', updated_at: '2026-01-01',
});
const evaluation = (id: string, teamId: string, judgeId: string, status: 'draft' | 'submitted'): Evaluation => ({
  id, team_id: teamId, judge_id: judgeId, template_id: 'DEMI_G4', status, core_total: 0, bonus_total: 0,
  core_scored_count: status === 'submitted' ? 20 : 1, core_criteria_count: 20, section_notes: {}, overall_notes: '',
  submitted_at: status === 'submitted' ? '2026-01-02' : null, reopened_count: 0, created_at: '2026-01-01', updated_at: '2026-01-02',
});

describe('judge assignment progress', () => {
  it('classifies missing, draft and submitted evaluations', () => {
    expect(evaluationProgressStatus(null)).toBe('not_started');
    expect(evaluationProgressStatus(evaluation('e1', 't1', 'j1', 'draft'))).toBe('in_progress');
    expect(evaluationProgressStatus(evaluation('e2', 't1', 'j1', 'submitted'))).toBe('submitted');
  });

  it('calculates a user with no starts and excludes users with no assignments', () => {
    const judges = [profile('j1', 'No Starts'), profile('j2', 'Unassigned')];
    const teams = [team('t1', 'DEMI'), team('t2', 'DECI')];
    const assignments: TeamJudge[] = teams.map((t) => ({ team_id: t.id, judge_id: 'j1', assigned_at: '2026-01-01' }));
    const rows = buildJudgeProgress(judges, assignments, teams, []);
    expect(rows.find((row) => row.judge.id === 'j1')).toMatchObject({ assigned: 2, completed: 0, inProgress: 0, notStarted: 2, completionPercentage: 0 });
    expect(rows.find((row) => row.judge.id === 'j2')).toBeUndefined();
  });

  it('includes an administrator when the administrator is assigned to evaluate', () => {
    const admin = { ...profile('admin', 'Admin Evaluator'), role: 'admin' as const };
    const rows = buildJudgeProgress([admin], [{ team_id: 't1', judge_id: admin.id, assigned_at: '2026-01-01' }], [team('t1','DEMI')], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ judge: { role: 'admin' }, assigned: 1, notStarted: 1 });
  });

  it('keeps multiple judges on one team independent and updates after submission', () => {
    const judges = [profile('j1', 'Judge One'), profile('j2', 'Judge Two')];
    const teams = [team('t1', 'DEMI')];
    const assignments: TeamJudge[] = judges.map((judge) => ({ team_id: 't1', judge_id: judge.id, assigned_at: '2026-01-01' }));
    const before = buildJudgeProgress(judges, assignments, teams, [evaluation('e1', 't1', 'j1', 'draft')]);
    expect(before.find((row) => row.judge.id === 'j1')).toMatchObject({ inProgress: 1, completed: 0 });
    expect(before.find((row) => row.judge.id === 'j2')).toMatchObject({ notStarted: 1, completed: 0 });

    const after = buildJudgeProgress(judges, assignments, teams, [evaluation('e1', 't1', 'j1', 'submitted'), evaluation('e2', 't1', 'j2', 'submitted')]);
    expect(after.every((row) => row.completed === 1 && row.completionPercentage === 100)).toBe(true);
  });

  it('is exposed only through the administrator route and refreshes from result signals', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const layout = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../pages/admin/JudgeProgressPage.tsx', import.meta.url), 'utf8');
    expect(app).toContain('path="/admin/judge-progress" element={<RequireAuth admin>');
    expect(layout).toContain("label: 'Judge Progress'");
    expect(page).toContain('subscribeToResults');
    expect(page).toContain('All organizations');
    expect(page).toContain('All grades / levels');
    expect(page).toContain('All governorates');
    expect(page).toContain('All assigned evaluators');
    expect(page).toContain('fetchEvaluatorProgressPage');
    expect(page).toContain('Any status');
  });
});
