import { describe, expect, it } from 'vitest';
import rubrics from '../../rubrics/rubrics.json';
import { competitionRank, computeTotals, mean, validateTemplate } from './scoring';
import type { RubricTemplate } from './types';

// Build templates exactly as the seed generator does (same ids)
function toTemplate(t: (typeof rubrics.templates)[number]): RubricTemplate {
  const sections = t.sections.map((s, i) => ({
    id: `${t.id}.S${i + 1}`, template_id: t.id, position: i + 1, title: s.title, weight: s.weight, is_bonus: false,
    criteria: s.criteria.map(([title, description], j) => ({
      id: `${t.id}.S${i + 1}.C${j + 1}`, section_id: `${t.id}.S${i + 1}`, template_id: t.id, is_bonus: false,
      position: j + 1, title, description, max_points: 5,
    })),
  }));
  const bonus = {
    id: `${t.id}.BONUS`, template_id: t.id, position: sections.length + 1, title: t.bonus.title, weight: t.bonus_max, is_bonus: true,
    criteria: t.bonus.criteria.map(([title, description], j) => ({
      id: `${t.id}.BONUS.C${j + 1}`, section_id: `${t.id}.BONUS`, template_id: t.id, is_bonus: true, position: j + 1, title, description, max_points: 5,
    })),
  };
  return {
    id: t.id, title: t.title, subtitle: t.subtitle, source_pdf: t.source_pdf, scale_instruction: rubrics.scale_instruction,
    guidance: rubrics.guidance, core_max: t.core_max, bonus_max: t.bonus_max, sections, bonus,
  };
}
const templates = rubrics.templates.map(toTemplate);

describe('rubric templates', () => {
  it('has the six PDF rubrics', () => {
    expect(templates.map((t) => t.id)).toEqual(['DEMI_G4', 'DEMI_G5', 'DECI_L1', 'DECI_L2', 'DECI_L3', 'DECI_L45']);
  });
  it.each(templates.map((t) => [t.id, t] as const))('%s is internally consistent (weights = rows x 5, core = 100)', (_, t) => {
    expect(validateTemplate(t)).toEqual([]);
    expect(t.sections.reduce((a, s) => a + s.weight, 0)).toBe(100);
    expect(t.sections.flatMap((s) => s.criteria)).toHaveLength(20);
  });
  it('preserves the section weights printed on each PDF', () => {
    const w = Object.fromEntries(templates.map((t) => [t.id, t.sections.map((s) => s.weight)]));
    expect(w).toEqual({
      DEMI_G4: [20, 15, 25, 15, 10, 15],
      DEMI_G5: [15, 25, 20, 15, 10, 15],
      DECI_L1: [15, 20, 20, 15, 10, 5, 15],
      DECI_L2: [15, 25, 15, 15, 10, 5, 15],
      DECI_L3: [15, 25, 20, 10, 10, 5, 15],
      DECI_L45: [10, 25, 20, 15, 15, 15],
    });
  });
  it('bonus maximums follow the PDFs (L4&5 = 15, others = 10)', () => {
    expect(Object.fromEntries(templates.map((t) => [t.id, t.bonus_max]))).toEqual({
      DEMI_G4: 10, DEMI_G5: 10, DECI_L1: 10, DECI_L2: 10, DECI_L3: 10, DECI_L45: 15,
    });
  });
});

describe('computeTotals', () => {
  const t = templates[0];
  const core = t.sections.flatMap((s) => s.criteria);
  it('sums section subtotals and core total; bonus separate', () => {
    const scores: Record<string, number> = {};
    core.forEach((c, i) => (scores[c.id] = i < 15 ? 5 : 2));
    scores[t.bonus!.criteria[0].id] = 4;
    const r = computeTotals(t, scores);
    expect(r.core).toBe(85);
    expect(r.bonus).toBe(4);
    expect(r.complete).toBe(true);
    expect(r.sections.map((s) => s.subtotal)).toEqual([20, 15, 25, 15, 4, 6]);
  });
  it('is incomplete until every core row is scored; bonus is optional', () => {
    const scores: Record<string, number | null> = {};
    core.slice(0, 19).forEach((c) => (scores[c.id] = 3));
    const r = computeTotals(t, scores);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual([core[19].id]);
    scores[core[19].id] = 3;
    expect(computeTotals(t, scores).complete).toBe(true);
  });
  it('max score is exactly 100 core and bonus_max bonus', () => {
    for (const tpl of templates) {
      const s: Record<string, number> = {};
      [...tpl.sections, tpl.bonus!].flatMap((x) => x.criteria).forEach((c) => (s[c.id] = 5));
      const r = computeTotals(tpl, s);
      expect(r.core).toBe(100);
      expect(r.bonus).toBe(tpl.bonus_max);
    }
  });
});

describe('averaging and ranking', () => {
  it('averages judges arithmetically (85, 95 -> 90)', () => {
    expect(mean([85, 95])).toBe(90);
    expect(mean([])).toBeNull();
  });
  it('uses standard competition ranking without tie-breaks', () => {
    const r = competitionRank([{ id: 'a', s: 90 }, { id: 'b', s: 95 }, { id: 'c', s: 90 }, { id: 'd', s: 80 }], (x) => x.s);
    expect(r.map((x) => `${x.id}:${x.rank}:${x.tied}`)).toEqual(['b:1:false', 'a:2:true', 'c:2:true', 'd:4:false']);
  });
});
