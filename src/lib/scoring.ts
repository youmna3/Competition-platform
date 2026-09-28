import type { RubricSection, RubricTemplate } from './types';

/**
 * Client-side mirror of the server calculation, used ONLY for live display
 * while a judge is scoring. The authoritative totals are always recomputed
 * by the database (`_recompute_evaluation`) on every save / submit.
 *
 * Each criterion row is scored 1–5 and is worth 5 points, so a section's
 * subtotal is the sum of its row scores and its maximum is (rows × 5), which
 * equals the section weight printed on the PDF.
 */
export type ScoreMap = Record<string, number | null | undefined>;

export function sectionSubtotal(section: RubricSection, scores: ScoreMap): number {
  return section.criteria.reduce((sum, c) => sum + (scores[c.id] ?? 0), 0);
}

export function sectionScoredCount(section: RubricSection, scores: ScoreMap): number {
  return section.criteria.filter((c) => isValidScore(scores[c.id])).length;
}

export function isValidScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}

export interface Totals {
  core: number;
  bonus: number;
  coreScored: number;
  coreCount: number;
  complete: boolean;
  sections: { id: string; title: string; weight: number; subtotal: number; scored: number; count: number }[];
  missing: string[]; // criterion ids still needing a score
}

export function computeTotals(template: RubricTemplate, scores: ScoreMap): Totals {
  const sections = template.sections.map((s) => ({
    id: s.id,
    title: s.title,
    weight: s.weight,
    subtotal: sectionSubtotal(s, scores),
    scored: sectionScoredCount(s, scores),
    count: s.criteria.length,
  }));
  const coreCriteria = template.sections.flatMap((s) => s.criteria);
  const missing = coreCriteria.filter((c) => !isValidScore(scores[c.id])).map((c) => c.id);
  const bonus = template.bonus ? sectionSubtotal(template.bonus, scores) : 0;
  return {
    core: sections.reduce((a, s) => a + s.subtotal, 0),
    bonus,
    coreScored: coreCriteria.length - missing.length,
    coreCount: coreCriteria.length,
    complete: missing.length === 0 && coreCriteria.length > 0,
    sections,
    missing,
  };
}

/** Check that a template is internally consistent with the PDF rules. */
export function validateTemplate(t: RubricTemplate): string[] {
  const problems: string[] = [];
  for (const s of [...t.sections, ...(t.bonus ? [t.bonus] : [])]) {
    const max = s.criteria.reduce((a, c) => a + c.max_points, 0);
    if (max !== s.weight) problems.push(`${s.title}: rows total ${max} but weight is ${s.weight}`);
  }
  const core = t.sections.reduce((a, s) => a + s.weight, 0);
  if (core !== t.core_max) problems.push(`Core sections total ${core}, expected ${t.core_max}`);
  if ((t.bonus?.weight ?? 0) !== t.bonus_max) problems.push(`Bonus weight ${t.bonus?.weight} ≠ bonus max ${t.bonus_max}`);
  return problems;
}

/** Arithmetic mean, kept for display/tests; the database is authoritative. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Standard competition ranking ("1224"): equal scores share a rank and the
 * next rank is skipped. No tie-breaking rule is applied.
 */
export function competitionRank<T>(rows: T[], score: (r: T) => number): (T & { rank: number; tied: boolean })[] {
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const key = (v: number) => Math.round(v * 1e6);
  const counts = new Map<number, number>();
  sorted.forEach((r) => counts.set(key(score(r)), (counts.get(key(score(r))) ?? 0) + 1));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((r, i) => {
    const k = key(score(r));
    if (prev === null || k !== prev) rank = i + 1;
    prev = k;
    return { ...r, rank, tied: (counts.get(k) ?? 0) > 1 };
  });
}
