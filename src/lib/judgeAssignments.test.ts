import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Evaluation, Team, TeamJudge } from './types';
import { buildJudgeAssignments } from './judgeAssignments';

const teams: Team[] = Array.from({ length: 6 }, (_, index) => ({
  id: `t${index + 1}`, team_code: `T-${index + 1}`, name: `Team ${index + 1}`, project_name: `Project ${index + 1}`,
  organization: index % 2 ? 'DECI' : 'DEMI', level_code: index % 2 ? 'L1' : 'G4', governorate_code: 'CAI',
  template_id: index % 2 ? 'DECI_L1' : 'DEMI_G4', created_at: '2026-01-01', updated_at: '2026-01-01',
}));
const evaluation = (status: 'draft' | 'submitted'): Evaluation => ({
  id: 'e1', team_id: 't1', judge_id: 'judge-a', template_id: 'DEMI_G4', status, core_total: 10, bonus_total: 0,
  core_scored_count: status === 'submitted' ? 20 : 2, core_criteria_count: 20, section_notes: {}, overall_notes: '',
  submitted_at: status === 'submitted' ? '2026-01-02' : null, reopened_count: 0, created_at: '2026-01-01', updated_at: '2026-01-02',
});

describe('judge dashboard assignments', () => {
  const assignments: TeamJudge[] = [
    ...teams.slice(0, 5).map((team) => ({ team_id: team.id, judge_id: 'judge-a', assigned_at: '2026-01-01' })),
    { team_id: 't6', judge_id: 'judge-b', assigned_at: '2026-01-01' },
  ];

  it('shows exactly the five teams assigned to the signed-in judge', () => {
    const rows = buildJudgeAssignments('judge-a', teams, assignments, []);
    expect(rows).toHaveLength(5);
    expect(rows.some((row) => row.team.id === 't6')).toBe(false);
    expect(rows.every((row) => row.status === 'not_started' && row.action === 'Start Evaluation')).toBe(true);
  });

  it('changes draft to Continue Evaluation and submitted to read-only View Submission', () => {
    expect(buildJudgeAssignments('judge-a', teams, assignments, [evaluation('draft')])[0]).toMatchObject({ status: 'in_progress', action: 'Continue Evaluation' });
    expect(buildJudgeAssignments('judge-a', teams, assignments, [evaluation('submitted')])[0]).toMatchObject({ status: 'submitted', action: 'View Submission' });
  });

  it('ignores evaluations belonging to another judge', () => {
    const other = { ...evaluation('submitted'), judge_id: 'judge-b' };
    expect(buildJudgeAssignments('judge-a', teams, assignments, [other])[0].status).toBe('not_started');
  });

  it('is backed by assignment-scoped team RLS and judge-owned evaluation RLS', () => {
    const security = readFileSync(new URL('../../supabase/migrations/20260928000003_security.sql', import.meta.url), 'utf8');
    expect(security).toContain('public.is_assigned_judge(id)');
    expect(security).toContain('judge_id = (select auth.uid())');
  });

  it('keeps the DEMI / DECI dashboard and puts tracking on a separate judge-only route', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const layout = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8');
    const dashboard = readFileSync(new URL('../pages/judge/JudgeHome.tsx', import.meta.url), 'utf8');
    const tracker = readFileSync(new URL('../pages/judge/AssignedTeamsPage.tsx', import.meta.url), 'utf8');
    expect(dashboard).toContain("const ORG_INFO");
    expect(dashboard).toContain("(['DEMI', 'DECI'] as Organization[])");
    expect(dashboard).not.toContain('buildJudgeAssignments');
    expect(tracker).toContain('fetchJudgeAssignmentPage');
    expect(tracker).toContain('<Pagination');
    expect(tracker).toContain('All governorates');
    expect(app).toContain('path="/judge/assigned-teams" element={<RequireAuth judge>');
    expect(app).toContain('path="/judge/rubrics" element={<RequireAuth judge>');
    expect(layout).toContain("label: 'Assigned Teams'");
    expect(layout).toContain("label: 'Rubrics'");
  });
});
