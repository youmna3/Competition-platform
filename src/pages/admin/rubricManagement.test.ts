import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import rubrics from '../../../rubrics/rubrics.json';
import { validateRubricDraft } from './RubricManagementPage';

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

  it('validates weights, criteria, scoring descriptions and bonus changes before publishing', () => {
    const source = rubrics.templates[0];
    const payload = {
      title: source.title, subtitle: source.subtitle,
      scale_instruction: rubrics.scale_instruction, guidance: rubrics.guidance,
      score_levels: rubrics.score_levels.map((x) => ({ ...x })),
      sections: [...source.sections.map((s) => ({ title: s.title, weight: s.weight, is_bonus: false, criteria: s.criteria.map(([title, description]) => ({ title, description })) })),
        { title: source.bonus.title, weight: source.bonus_max, is_bonus: true, criteria: source.bonus.criteria.map(([title, description]) => ({ title, description })) }],
    };
    expect(validateRubricDraft(payload)).toEqual([]);
    const moved = payload.sections[0].criteria.pop()!;
    payload.sections[0].weight -= 5;
    payload.sections[1].criteria.push({ ...moved, title: 'Moved criterion' });
    payload.sections[1].weight += 5;
    const bonus = payload.sections[payload.sections.length - 1];
    bonus.criteria.push({ title: 'New bonus requirement', description: 'Evidence required.' });
    bonus.weight += 5;
    payload.score_levels[2].label = 'Updated expectation';
    expect(validateRubricDraft(payload)).toEqual([]);
    payload.score_levels[2].description = '';
    bonus.weight += 5;
    expect(validateRubricDraft(payload).join(' ')).toMatch(/Scoring levels|not 20/);
  });
});
