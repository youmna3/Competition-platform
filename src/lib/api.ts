import { supabase } from './supabase';
import type {
  AuditEntry, Competition, DashboardStats, Evaluation, EvaluationScore, Governorate, ImportResult, ImportRow,
  LeaderboardRow, Level, Profile, RubricCriterion, RubricSection, RubricTemplate, ScoreChange, ScoreLevel,
  Team, TeamJudge, TeamResult,
} from './types';

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// Reference data (cached for the session)
// ---------------------------------------------------------------------------
export interface Reference {
  governorates: Governorate[];
  competitions: Competition[];
  levels: Level[];
}

let referenceCache: Promise<Reference> | null = null;

export function loadReference(force = false): Promise<Reference> {
  if (!referenceCache || force) {
    referenceCache = (async () => {
      const [g, c, l] = await Promise.all([
        supabase.from('governorates').select('*').order('sort_order'),
        supabase.rpc('get_competitions'),
        supabase.from('levels').select('*').order('sort_order'),
      ]);
      return {
        governorates: unwrap(g) as Governorate[],
        competitions: unwrap(c) as Competition[],
        levels: unwrap(l) as Level[],
      };
    })().catch((e) => {
      referenceCache = null;
      throw e;
    });
  }
  return referenceCache;
}

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------
const templateCache = new Map<string, Promise<RubricTemplate>>();
let scaleCache: Promise<ScoreLevel[]> | null = null;

export function loadScoreLevels(): Promise<ScoreLevel[]> {
  if (!scaleCache) {
    scaleCache = (async () => unwrap(await supabase.from('score_levels').select('*').order('value')) as ScoreLevel[])()
      .catch((e) => { scaleCache = null; throw e; });
  }
  return scaleCache;
}

export function loadTemplate(templateId: string): Promise<RubricTemplate> {
  let p = templateCache.get(templateId);
  if (!p) {
    p = (async () => {
      const [t, s, c] = await Promise.all([
        supabase.from('rubric_templates').select('*').eq('id', templateId).single(),
        supabase.from('rubric_sections').select('*').eq('template_id', templateId).order('position'),
        supabase.from('rubric_criteria').select('*').eq('template_id', templateId).order('position'),
      ]);
      const tpl = unwrap(t) as Omit<RubricTemplate, 'sections' | 'bonus'>;
      const criteria = unwrap(c) as RubricCriterion[];
      const sections = (unwrap(s) as Omit<RubricSection, 'criteria'>[]).map((sec) => ({
        ...sec,
        criteria: criteria.filter((x) => x.section_id === sec.id).sort((a, b) => a.position - b.position),
      }));
      return {
        ...tpl,
        sections: sections.filter((x) => !x.is_bonus),
        bonus: sections.find((x) => x.is_bonus) ?? null,
      } as RubricTemplate;
    })();
    p.catch(() => templateCache.delete(templateId));
    templateCache.set(templateId, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const res = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return unwrap(res) as Profile | null;
}

export async function fetchProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from('profiles').select('*').order('created_at', { ascending: false })) as Profile[];
}

export async function updateProfileAccess(id: string, patch: Partial<Pick<Profile, 'role' | 'status' | 'full_name'>>) {
  unwrap(await supabase.from('profiles').update(patch).eq('id', id).select().single());
}

// ---------------------------------------------------------------------------
// Teams & assignments
// ---------------------------------------------------------------------------
export async function fetchTeams(): Promise<Team[]> {
  return unwrap(await supabase.from('teams').select('*').order('team_code')) as Team[];
}

export async function fetchAssignments(): Promise<TeamJudge[]> {
  // judges receive only their own rows (RLS); admins receive all
  const all: TeamJudge[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = unwrap(await supabase.from('team_judges').select('team_id, judge_id, assigned_at').range(from, from + page - 1)) as TeamJudge[];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

export async function saveTeam(team: Partial<Team> & Pick<Team, 'team_code' | 'name' | 'project_name' | 'level_code' | 'governorate_code'>): Promise<Team> {
  const payload = {
    team_code: team.team_code.trim(),
    name: team.name.trim(),
    project_name: team.project_name.trim(),
    level_code: team.level_code,
    governorate_code: team.governorate_code,
  };
  if (team.id) {
    return unwrap(await supabase.from('teams').update(payload).eq('id', team.id).select().single()) as Team;
  }
  return unwrap(await supabase.from('teams').insert(payload).select().single()) as Team;
}

export async function deleteTeam(id: string) {
  unwrap(await supabase.from('teams').delete().eq('id', id));
}

export async function setTeamJudges(teamId: string, judgeIds: string[]) {
  unwrap(await supabase.rpc('admin_set_team_judges', { p_team_id: teamId, p_judge_ids: judgeIds }));
}

export async function importTeams(rows: ImportRow[], replaceAssignments: boolean): Promise<ImportResult> {
  return unwrap(await supabase.rpc('admin_import_teams', { p_rows: rows, p_replace_assignments: replaceAssignments })) as ImportResult;
}

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------
export async function fetchMyEvaluations(): Promise<Evaluation[]> {
  // RLS returns only the caller's evaluations for judges
  return unwrap(await supabase.from('evaluations').select('*')) as Evaluation[];
}

export async function fetchAllEvaluations(): Promise<Evaluation[]> {
  const all: Evaluation[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = unwrap(await supabase.from('evaluations').select('*').order('created_at').range(from, from + page - 1)) as Evaluation[];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

export async function fetchAllScores(): Promise<EvaluationScore[]> {
  const all: EvaluationScore[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = unwrap(
      await supabase.from('evaluation_scores').select('*').order('evaluation_id').order('criterion_id').range(from, from + page - 1),
    ) as EvaluationScore[];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

export async function fetchEvaluation(id: string): Promise<{ evaluation: Evaluation; scores: EvaluationScore[] }> {
  const [e, s] = await Promise.all([
    supabase.from('evaluations').select('*').eq('id', id).single(),
    supabase.from('evaluation_scores').select('*').eq('evaluation_id', id),
  ]);
  return { evaluation: unwrap(e) as Evaluation, scores: unwrap(s) as EvaluationScore[] };
}

export async function fetchTeam(id: string): Promise<Team | null> {
  return unwrap(await supabase.from('teams').select('*').eq('id', id).maybeSingle()) as Team | null;
}

export async function startEvaluation(teamId: string): Promise<string> {
  return unwrap(await supabase.rpc('start_evaluation', { p_team_id: teamId })) as string;
}

export async function saveEvaluation(
  evaluationId: string,
  scores: ScoreChange[] | null,
  sectionNotes: Record<string, string> | null,
  overallNotes: string | null,
): Promise<Evaluation> {
  return unwrap(
    await supabase.rpc('save_evaluation', {
      p_evaluation_id: evaluationId,
      p_scores: scores,
      p_section_notes: sectionNotes,
      p_overall_notes: overallNotes,
    }),
  ) as Evaluation;
}

export async function submitEvaluation(
  evaluationId: string,
  scores: ScoreChange[] | null,
  sectionNotes: Record<string, string> | null,
  overallNotes: string | null,
): Promise<Evaluation> {
  return unwrap(
    await supabase.rpc('submit_evaluation', {
      p_evaluation_id: evaluationId,
      p_scores: scores,
      p_section_notes: sectionNotes,
      p_overall_notes: overallNotes,
    }),
  ) as Evaluation;
}

export async function reopenEvaluation(evaluationId: string, reason: string): Promise<Evaluation> {
  return unwrap(await supabase.rpc('admin_reopen_evaluation', { p_evaluation_id: evaluationId, p_reason: reason })) as Evaluation;
}

// ---------------------------------------------------------------------------
// Results, leaderboards, dashboard
// ---------------------------------------------------------------------------
export async function fetchLeaderboard(filters: {
  organization?: string | null; competition?: string | null; level?: string | null; governorate?: string | null;
} = {}): Promise<LeaderboardRow[]> {
  const rows = unwrap(
    await supabase.rpc('get_leaderboard', {
      p_organization: filters.organization || null,
      p_competition: filters.competition || null,
      p_level: filters.level || null,
      p_governorate: filters.governorate || null,
    }),
  ) as LeaderboardRow[];
  return rows.map((r) => ({ ...r, avg_core: Number(r.avg_core), avg_bonus: Number(r.avg_bonus) }));
}

export async function fetchTeamResults(): Promise<TeamResult[]> {
  const rows = unwrap(await supabase.rpc('admin_team_results')) as TeamResult[];
  return rows.map((r) => ({
    ...r,
    avg_core: num(r.avg_core),
    avg_bonus: num(r.avg_bonus),
    provisional_core: num(r.provisional_core),
    provisional_bonus: num(r.provisional_bonus),
  }));
}

export async function fetchDashboard(): Promise<DashboardStats> {
  return unwrap(await supabase.rpc('admin_dashboard_stats')) as DashboardStats;
}

export async function setPublication(competition: string, published: boolean) {
  unwrap(await supabase.rpc('admin_set_publication', { p_competition: competition, p_published: published }));
}

export async function fetchAudit(filters: { evaluationId?: string; teamId?: string; action?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  let q = supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(filters.limit ?? 200);
  if (filters.evaluationId) q = q.eq('evaluation_id', filters.evaluationId);
  if (filters.teamId) q = q.eq('team_id', filters.teamId);
  if (filters.action) q = q.like('action', `${filters.action}%`);
  return unwrap(await q) as AuditEntry[];
}

/** Subscribe to result changes (realtime). Returns an unsubscribe function. */
export function subscribeToResults(onChange: () => void): () => void {
  const channel = supabase
    .channel(`results-signal-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'results_signal' }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
