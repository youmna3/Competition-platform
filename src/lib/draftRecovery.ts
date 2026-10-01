import type { ScoreChange } from './types';

export interface RecoverableDraft {
  scores: ScoreChange[];
  sections: Record<string, string>;
  overall: string | null;
  teamName: string | null;
  projectName: string | null;
  savedAt: string;
}

const key = (evaluationId: string) => `judging:draft:${evaluationId}`;

export function storeRecoverableDraft(
  evaluationId: string,
  pending: { scores: Map<string, ScoreChange>; sections: Record<string, string>; overall: string | null; teamName?: string | null; projectName?: string | null },
) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!pending.scores.size && !Object.keys(pending.sections).length && pending.overall === null && pending.teamName == null && pending.projectName == null) {
      localStorage.removeItem(key(evaluationId));
      return;
    }
    const value: RecoverableDraft = {
      scores: [...pending.scores.values()],
      sections: pending.sections,
      overall: pending.overall,
      teamName: pending.teamName ?? null,
      projectName: pending.projectName ?? null,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key(evaluationId), JSON.stringify(value));
  } catch {
    // Storage can be disabled or full. Server autosave remains authoritative.
  }
}

export function loadRecoverableDraft(evaluationId: string): RecoverableDraft | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(evaluationId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RecoverableDraft>;
    if (!Array.isArray(value.scores) || !value.sections || typeof value.sections !== 'object') return null;
    return {
      scores: value.scores.filter((score): score is ScoreChange => Boolean(score && typeof score.criterion_id === 'string')),
      sections: Object.fromEntries(Object.entries(value.sections).filter(([, note]) => typeof note === 'string')),
      overall: typeof value.overall === 'string' || value.overall === null ? value.overall : null,
      teamName: typeof value.teamName === 'string' ? value.teamName : null,
      projectName: typeof value.projectName === 'string' ? value.projectName : null,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    };
  } catch {
    return null;
  }
}

export function clearRecoverableDraft(evaluationId: string) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(key(evaluationId)); } catch { /* no-op */ }
}
