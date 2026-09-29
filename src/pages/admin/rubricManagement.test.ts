import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import rubrics from '../../../rubrics/rubrics.json';
import { validateRubricDraft } from './RubricManagementPage';
import { hydrateRubricTemplate, requireArray, unwrap } from '../../lib/api';
import type { RubricCriterion, RubricSection, RubricTemplate } from '../../lib/types';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../../components/Layout.tsx', import.meta.url), 'utf8');
const managementSource = readFileSync(new URL('./RubricManagementPage.tsx', import.meta.url), 'utf8');
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
    expect(validateRubricDraft(payload).join(' ')).toMatch(/Scoring level 3|weight is 20/);
  });

  it('reports missing rubric arrays instead of rendering a blank page', () => {
    expect(() => requireArray(undefined, 'Rubric versions')).toThrow('Rubric versions response is missing');
    expect(() => hydrateRubricTemplate({ id: 'X' } as Omit<RubricTemplate, 'sections' | 'bonus'>, undefined, [])).toThrow('Sections for X response is missing');
  });

  it('propagates failed Supabase queries', () => {
    const failure = new Error('database unavailable');
    expect(() => unwrap({ data: null, error: failure })).toThrow(failure);
  });

  it('hydrates successful version metadata with complete section and criterion arrays', () => {
    const template = { id: 'X', title: 'X' } as Omit<RubricTemplate, 'sections' | 'bonus'>;
    const sections = [
      { id: 'X.S1', template_id: 'X', position: 1, title: 'Core', weight: 5, is_bonus: false },
      { id: 'X.BONUS', template_id: 'X', position: 2, title: 'Bonus', weight: 5, is_bonus: true },
    ] as Omit<RubricSection, 'criteria'>[];
    const criteria = sections.map((section) => ({ id: `${section.id}.C1`, section_id: section.id, template_id: 'X', position: 1, title: 'Criterion', description: 'Description', max_points: 5, is_bonus: section.is_bonus })) as RubricCriterion[];
    const result = hydrateRubricTemplate(template, sections, criteria);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].criteria).toHaveLength(1);
    expect(result.bonus?.criteria).toHaveLength(1);
  });

  it('uses a controlled responsive menu through tablet and smaller desktop widths', () => {
    expect(layoutSource).toContain('navigationNeedsMenu');
    expect(layoutSource).toContain('new ResizeObserver(measure)');
    expect(layoutSource).toContain("window.addEventListener('resize', measure)");
    expect(layoutSource).toContain("aria-expanded={open}");
    expect(layoutSource).toContain("aria-controls=\"responsive-navigation\"");
    expect(layoutSource).toContain("event.key === 'Escape'");
    expect(layoutSource).toContain('open && compactNavigation');
  });

  it('lets rubric editor controls shrink or stack without page-level overflow', () => {
    expect(managementSource).toContain('min-[440px]:flex-row');
    expect(managementSource).toContain('lg:grid-cols-[3rem_12rem_minmax(0,1fr)]');
    expect(managementSource).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]');
    expect(managementSource).toContain('grid grid-cols-1 gap-2 sm:flex');
  });

  it('keeps a saved draft open and exposes validation before publishing', () => {
    expect(managementSource).toContain("Draft saved. You can now validate, preview or publish it.");
    expect(managementSource).toContain('Validate draft');
    expect(managementSource).toContain('rubric-validation-errors');
    expect(managementSource).toContain("useState<'keep_existing'|'move_unevaluated'>('move_unevaluated')");
    expect(managementSource).not.toContain('disabled={errors.length>0} onClick={publish}');
  });
});
