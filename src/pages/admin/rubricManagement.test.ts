import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import rubrics from '../../../rubrics/rubrics.json';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../../components/Layout.tsx', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('./RubricPreviewPage.tsx', import.meta.url), 'utf8');

describe('admin rubric management', () => {
  it('has all seven complete rubric definitions available to the database-backed catalog', () => {
    expect(rubrics.templates.map((rubric) => rubric.id)).toEqual([
      'DEMI_G4', 'DEMI_G5', 'DEMI_G6', 'DECI_L1', 'DECI_L2', 'DECI_L3', 'DECI_L45',
    ]);
    for (const rubric of rubrics.templates) {
      expect(rubric.title).toBeTruthy();
      expect(rubric.subtitle).toBeTruthy();
      expect(rubric.sections.flatMap((section) => section.criteria)).toHaveLength(20);
      expect(rubric.sections.reduce((total, section) => total + section.weight, 0)).toBe(100);
      expect(rubric.bonus.criteria.length * 5).toBe(rubric.bonus_max);
    }
  });

  it('keeps management and preview routes behind the administrator guard', () => {
    expect(appSource).toContain('path="/admin/rubrics" element={<RequireAuth admin><RubricManagementPage /></RequireAuth>}');
    expect(appSource).toContain('path="/admin/rubrics/:templateId/preview" element={<RequireAuth admin><RubricPreviewPage /></RequireAuth>}');
    expect(layoutSource).toContain("to: '/admin/rubrics', label: 'Rubric Management'");
  });

  it('renders the shared rubric form read-only without evaluation mutation APIs', () => {
    expect(previewSource).toContain('<RubricForm');
    expect(previewSource).toMatch(/\sreadOnly\s/);
    expect(previewSource).not.toMatch(/startEvaluation|saveEvaluation|submitEvaluation/);
  });
});
