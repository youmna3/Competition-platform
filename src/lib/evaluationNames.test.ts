import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('evaluation-entered team and project names',()=>{
  const form=readFileSync(new URL('../components/RubricForm.tsx',import.meta.url),'utf8');
  const page=readFileSync(new URL('../pages/judge/EvaluationPage.tsx',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../pages/admin/AdminEvaluationView.tsx',import.meta.url),'utf8');
  const results=readFileSync(new URL('../pages/admin/ResultsPage.tsx',import.meta.url),'utf8');
  const exports=readFileSync(new URL('./exportResults.ts',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../../supabase/migrations/20261001000001_evaluation_entered_names.sql',import.meta.url),'utf8');

  it('renders empty editable rubric fields instead of assigned-team values',()=>{
    expect(form).toContain('aria-label="Team Name"');
    expect(form).toContain('aria-label="Project Name"');
    expect(page).toContain('team: teamName');
    expect(page).toContain('project: projectName');
    expect(page).not.toContain('team: `${team.name}');
    expect(page).not.toContain('project: team.project_name');
  });

  it('persists, validates and displays evaluation-owned names',()=>{
    expect(migration).toContain('entered_team_name');
    expect(migration).toContain('entered_project_name');
    expect(migration).toContain('Team Name is required before submission');
    expect(page).toContain('batch.teamName');
    expect(admin).toContain('evaluation.entered_team_name');
    expect(results).toContain("e?.entered_project_name");
    expect(exports).toContain('team_name: e.entered_team_name');
  });
});
