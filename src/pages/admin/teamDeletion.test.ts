import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./TeamsPage.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../../../supabase/migrations/20261001000003_admin_cascade_delete_team.sql', import.meta.url), 'utf8');

describe('administrator team deletion', () => {
  it('uses the administrator-only transactional RPC rather than a direct table delete', () => {
    expect(apiSource).toContain("supabase.rpc('admin_delete_team'");
    expect(apiSource).not.toContain("supabase.from('teams').delete().eq('id', id)");
    expect(migrationSource).toContain('security definer');
    expect(migrationSource).toContain('not public.is_admin()');
    expect(migrationSource).toContain("errcode = '42501'");
  });

  it('removes dependencies in a controlled order and records deletion counts', () => {
    const scores = migrationSource.indexOf('delete from public.evaluation_scores');
    const evaluations = migrationSource.indexOf('delete from public.evaluations where');
    const assignments = migrationSource.indexOf('delete from public.team_judges');
    const team = migrationSource.indexOf('delete from public.teams where');
    expect(scores).toBeGreaterThan(-1);
    expect(scores).toBeLessThan(evaluations);
    expect(evaluations).toBeLessThan(assignments);
    expect(assignments).toBeLessThan(team);
    expect(migrationSource).toContain("'team.deleted_cascade'");
    expect(migrationSource).toContain("'assignments_deleted', v_assignment_count");
    expect(migrationSource).toContain("'evaluations_deleted', v_evaluation_count");
    expect(migrationSource).toContain("'deleted_by', auth.uid()");
  });

  it('clearly warns the administrator and exposes Cancel and Delete Team actions', () => {
    expect(pageSource).toContain('Delete this team permanently?');
    expect(pageSource).toContain('All assignments, evaluations, scores and related judging data for this team will also be deleted.');
    expect(pageSource).toContain('>Cancel</Button>');
    expect(pageSource).toContain('>Delete Team</Button>');
    expect(pageSource).not.toContain('already has evaluations and cannot be deleted');
  });
});
