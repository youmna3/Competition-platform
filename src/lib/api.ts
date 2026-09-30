import { supabase } from './supabase';
import type {
  AuditEntry, Competition, DashboardStats, Evaluation, EvaluationScore, Governorate, ImportResult, ImportRow,
  LeaderboardRow, Level, Profile, RubricCriterion, RubricSection, RubricTemplate, ScoreChange, ScoreLevel,
  Team, TeamJudge, TeamResult, RubricVersionSummary, UserInvitation,
} from './types';
import type { PageResult } from './pagination';

export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

export function requireArray<T>(value: T[] | null | undefined, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} response is missing or is not an array`);
  return value;
}

function requirePage<T>(value: PageResult<T> | null | undefined, label: string): PageResult<T> {
  const rows = requireArray(value?.rows, label);
  const total = Number(value?.total);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`${label} response has an invalid total`);
  return { rows, total };
}

export async function fetchAdminPage<T>(kind: 'teams' | 'judges' | 'invitations' | 'progress' | 'progress_details' | 'results' | 'audit' | 'leaderboard' | 'rubric_versions', filters: Record<string, string>, page: number, pageSize: number): Promise<PageResult<T>> {
  const data = unwrap(await supabase.rpc('admin_list_page', { p_kind: kind, p_filters: filters, p_page: page, p_page_size: pageSize })) as PageResult<T>;
  return requirePage(data, `${kind} page`);
}

export interface JudgeAssignmentPageRow extends Team {
  level_label: string;
  governorate_name: string;
  evaluation_id: string | null;
  evaluation_status: 'draft' | 'submitted' | null;
  evaluation_updated_at: string | null;
  submitted_at: string | null;
}

export async function fetchJudgeAssignmentPage(filters: Record<string, string>, page: number, pageSize: number): Promise<PageResult<JudgeAssignmentPageRow>> {
  const data = unwrap(await supabase.rpc('judge_assignment_page', { p_filters: filters, p_page: page, p_page_size: pageSize })) as PageResult<JudgeAssignmentPageRow>;
  return requirePage(data, 'Assigned teams page');
}
export interface JudgeDashboardSummary { total: number; submitted: number; groups: { organization: 'DEMI'|'DECI'; competition_code: string; total: number; submitted: number }[] }
export async function fetchJudgeDashboardSummary(): Promise<JudgeDashboardSummary> {
  return unwrap(await supabase.rpc('judge_dashboard_summary')) as JudgeDashboardSummary;
}
export interface AdminProgressStats { judges_not_started:number; judges_incomplete:number; judges_finished:number; teams_waiting:number }
export async function fetchAdminProgressStats(): Promise<AdminProgressStats> {
  return unwrap(await supabase.rpc('admin_progress_stats')) as AdminProgressStats;
}
export async function fetchEvaluatorProgressPage<T>(filters: Record<string,string>, page:number, pageSize:number): Promise<PageResult<T>> {
  const data=unwrap(await supabase.rpc('admin_evaluator_progress_page',{p_filters:filters,p_page:page,p_page_size:pageSize})) as PageResult<T>;
  return requirePage(data,'Evaluator progress page');
}
export async function fetchAssignedEvaluatorChoices(): Promise<Pick<Profile,'id'|'email'|'full_name'|'role'>[]> {
  return requireArray(unwrap(await supabase.rpc('admin_assigned_evaluator_choices')) as Pick<Profile,'id'|'email'|'full_name'|'role'>[],'Assigned evaluator choices');
}

export function hydrateRubricTemplate(
  template: Omit<RubricTemplate, 'sections' | 'bonus'>,
  sectionRows: Omit<RubricSection, 'criteria'>[] | null | undefined,
  criterionRows: RubricCriterion[] | null | undefined,
): RubricTemplate {
  const criteria = requireArray(criterionRows, `Criteria for ${template.id}`);
  const sections = requireArray(sectionRows, `Sections for ${template.id}`).map((section) => ({
    ...section,
    criteria: criteria.filter((criterion) => criterion.section_id === section.id).sort((a, b) => a.position - b.position),
  }));
  return { ...template, sections: sections.filter((section) => !section.is_bonus), bonus: sections.find((section) => section.is_bonus) ?? null };
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
        governorates: requireArray(unwrap(g) as Governorate[] | null, 'Governorates'),
        competitions: requireArray(unwrap(c) as Competition[] | null, 'Competitions'),
        levels: requireArray(unwrap(l) as Level[] | null, 'Levels').filter((level) => level.is_active !== false),
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
const scaleCache = new Map<string, Promise<ScoreLevel[]>>();

export function loadScoreLevels(templateId?: string): Promise<ScoreLevel[]> {
  const key = templateId ?? 'global';
  let cached = scaleCache.get(key);
  if (!cached) {
    cached = (async () => {
      if (templateId) {
        const rows = requireArray(unwrap(await supabase.from('rubric_score_levels').select('value,label,description').eq('template_id', templateId).order('value')) as ScoreLevel[] | null, `Scoring levels for ${templateId}`);
        if (rows.length !== 5) throw new Error(`Rubric ${templateId} has ${rows.length} scoring levels; expected 5`);
        return rows;
      }
      return requireArray(unwrap(await supabase.from('score_levels').select('*').order('value')) as ScoreLevel[] | null, 'Global scoring levels');
    })().catch((e) => { scaleCache.delete(key); throw e; });
    scaleCache.set(key, cached);
  }
  return cached;
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
      return hydrateRubricTemplate(tpl, unwrap(s) as Omit<RubricSection, 'criteria'>[] | null, unwrap(c) as RubricCriterion[] | null);
    })();
    p.catch(() => templateCache.delete(templateId));
    templateCache.set(templateId, p);
  }
  return p;
}

export async function fetchRubricVersions(): Promise<RubricVersionSummary[]> {
  return requireArray(
    unwrap(await supabase.from('rubric_templates').select('*').order('family_id').order('version', { ascending: false })) as RubricVersionSummary[] | null,
    'Rubric versions',
  );
}

export async function createRubricDraft(sourceTemplateId: string): Promise<string> {
  const id = unwrap(await supabase.rpc('admin_create_rubric_draft', { p_source_template: sourceTemplateId })) as string;
  templateCache.delete(id); scaleCache.delete(id);
  return id;
}

export interface RubricDraftPayload {
  title: string; subtitle: string; scale_instruction: string; guidance: string;
  score_levels: ScoreLevel[];
  sections: { title: string; weight: number; is_bonus: boolean; criteria: { title: string; description: string }[] }[];
}

export async function saveRubricDraft(templateId: string, payload: RubricDraftPayload): Promise<void> {
  unwrap(await supabase.rpc('admin_save_rubric_draft', { p_template_id: templateId, p_payload: payload }));
  templateCache.delete(templateId); scaleCache.delete(templateId);
}

export async function publishRubric(templateId: string, teamHandling: 'keep_existing' | 'move_unevaluated'): Promise<void> {
  unwrap(await supabase.rpc('admin_publish_rubric', { p_template_id: templateId, p_team_handling: teamHandling }));
  templateCache.delete(templateId);
  await loadReference(true);
}

export async function countTemplateEvaluations(templateId: string): Promise<number> {
  const res = await supabase.from('evaluations').select('id', { count: 'exact', head: true }).eq('template_id', templateId).eq('status', 'submitted');
  if (res.error) throw res.error;
  return res.count ?? 0;
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

export async function fetchInvitations(): Promise<UserInvitation[]> {
  return requireArray(unwrap(await supabase.from('user_invitations').select('*').order('invited_at', { ascending: false })) as UserInvitation[] | null, 'Invitations');
}

export type AccountManagementRequest =
  | { action: 'invite' | 'create-temporary'; fullName: string; email: string; teamIds: string[] }
  | { action: 'resend' | 'revoke'; invitationId: string }
  | { action: 'complete-password-change'; password: string };

export async function manageInvitation(body: AccountManagementRequest) {
  const { data, error } = await supabase.functions.invoke('admin-user-invitations', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      let message: string | undefined;
      try {
        const payload = await context.clone().json() as { error?: string; message?: string; msg?: string; code?: string };
        message = payload.error || payload.message || payload.msg;
        if (message && payload.code) message = `${message} (${payload.code})`;
      } catch { /* use the original Functions error */ }
      if (message) throw new Error(message);
    }
    const message = error instanceof Error ? error.message : '';
    if (/failed to send|fetch failed|network/i.test(message)) {
      throw new Error('The account service could not be reached. Verify that the admin-user-invitations Edge Function is deployed to this Supabase project and that this site origin is listed in ALLOWED_ORIGINS.');
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function completeRequiredPasswordChange(password: string): Promise<void> {
  await manageInvitation({ action: 'complete-password-change', password });
}

export async function acceptMyInvitation() {
  unwrap(await supabase.rpc('accept_my_invitation'));
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
export async function fetchAssignmentsForTeams(teamIds: string[]): Promise<TeamJudge[]> {
  if (!teamIds.length) return [];
  return unwrap(await supabase.from('team_judges').select('team_id,judge_id,assigned_at').in('team_id', teamIds)) as TeamJudge[];
}

export async function fetchAssignmentsForJudge(judgeId: string): Promise<TeamJudge[]> {
  if (!judgeId) return [];
  return unwrap(await supabase.from('team_judges').select('team_id, judge_id, assigned_at').eq('judge_id', judgeId)) as TeamJudge[];
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

export async function setJudgeTeams(judgeId: string, teamIds: string[]) {
  unwrap(await supabase.rpc('admin_set_judge_teams', { p_judge_id: judgeId, p_team_ids: teamIds }));
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
export async function fetchEvaluationsForTeams(teamIds: string[]): Promise<Evaluation[]> {
  if (!teamIds.length) return [];
  return unwrap(await supabase.from('evaluations').select('*').in('team_id', teamIds)) as Evaluation[];
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
