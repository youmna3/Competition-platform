import { describe, expect, it } from 'vitest';
import { pageRange } from './pagination';
import { readFileSync } from 'node:fs';

describe('server pagination ranges', () => {
  it('creates non-overlapping inclusive Supabase ranges', () => {
    expect(pageRange({ page: 1, pageSize: 20 })).toEqual({ from: 0, to: 19 });
    expect(pageRange({ page: 2, pageSize: 20 })).toEqual({ from: 20, to: 39 });
    expect(pageRange({ page: 6, pageSize: 100 })).toEqual({ from: 500, to: 599 });
  });
  it('covers large result sets without gaps or duplicate offsets', () => {
    const indexes = Array.from({ length: 50 }, (_, index) => pageRange({ page: index + 1, pageSize: 20 })).flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
    expect(indexes).toHaveLength(1000);
    expect(new Set(indexes).size).toBe(1000);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(999);
  });
  it('uses counted database pages on large-list screens', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260930000003_server_side_pagination.sql', import.meta.url), 'utf8');
    const assigned = readFileSync(new URL('../pages/judge/AssignedTeamsPage.tsx', import.meta.url), 'utf8');
    const audit = readFileSync(new URL('../pages/admin/AuditPage.tsx', import.meta.url), 'utf8');
    for (const kind of ['teams','judges','invitations','progress','results','audit','leaderboard','rubric_versions']) expect(migration).toContain(`p_kind = '${kind}'`);
    expect(migration).toContain('offset v_offset limit v_size');
    expect(assigned).toContain('fetchJudgeAssignmentPage');
    expect(audit).toContain("fetchAdminPage<AuditEntry>('audit'");
  });
  it('wires every large list to the shared pagination controls', () => {
    const files = [
      '../pages/admin/TeamsPage.tsx', '../pages/admin/JudgesPage.tsx', '../pages/admin/JudgeProgressPage.tsx',
      '../pages/admin/ResultsPage.tsx', '../pages/admin/AuditPage.tsx', '../pages/admin/RubricManagementPage.tsx',
      '../pages/admin/AdminEvaluationView.tsx',
      '../pages/LeaderboardPage.tsx', '../pages/judge/AssignedTeamsPage.tsx', '../pages/judge/JudgeHome.tsx',
    ];
    for (const file of files) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).toContain('<Pagination');
    }
  });
});
