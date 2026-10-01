import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('./JudgeHome.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../admin/RubricPreviewPage.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8');
const combinedMigration = readFileSync(new URL('../../../supabase/migrations/20260930000001_combine_deci_levels_4_5.sql', import.meta.url), 'utf8');
const libraryMigration = readFileSync(new URL('../../../supabase/migrations/20260930000002_judge_rubric_library_and_admin_leaderboard.sql', import.meta.url), 'utf8');

describe('judge rubric preview and combined DECI Levels 4 & 5', () => {
  it('offers one active combined level and preserves the original legacy value', () => {
    expect(api).toContain('.filter(isSelectableLevel)');
    expect(api).toContain("level.code === 'L4' || level.code === 'L5'");
    expect(combinedMigration).toContain("values ('L45', 'DECI', 'Levels 4 & 5', 'DECI_L45'");
    expect(combinedMigration).toContain("update public.levels set is_active = false where code in ('L4', 'L5')");
    expect(combinedMigration).toContain('legacy_level_code = level_code');
    expect(combinedMigration).not.toContain('insert into public.rubric_templates');
  });

  it('links assigned judges to a read-only preview without evaluation writes', () => {
    expect(app).toContain('path="/rubrics/:templateId/preview"');
    expect(dashboard).toContain('View Rubric');
    expect(dashboard).toContain('team.template_id');
    expect(preview).toContain('readOnly');
    expect(preview).not.toContain('startEvaluation');
    expect(preview).not.toContain('saveEvaluation');
    expect(preview).not.toContain('submitEvaluation');
  });

  it('allows judges to read active published rubrics but not draft versions', () => {
    expect(libraryMigration).toContain('public.can_read_judge_rubric(id)');
    expect(libraryMigration).toContain('public.can_read_judge_rubric(template_id)');
    expect(libraryMigration).toContain("t.lifecycle = 'published'");
  });
});
