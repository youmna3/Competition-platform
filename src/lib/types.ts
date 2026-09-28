export type AppRole = 'admin' | 'judge';
export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled';
export type Organization = 'DEMI' | 'DECI';
export type EvaluationStatus = 'draft' | 'submitted';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Governorate {
  code: string;
  name: string;
  sort_order: number;
}

export interface Competition {
  code: string;
  organization: Organization;
  label: string;
  template_id: string;
  sort_order: number;
  is_published: boolean;
  published_at: string | null;
}

export interface Level {
  code: string;
  organization: Organization;
  label: string;
  competition_code: string;
  sort_order: number;
}

export interface ScoreLevel {
  value: number;
  label: string;
  description: string;
}

export interface RubricCriterion {
  id: string;
  section_id: string;
  template_id: string;
  is_bonus: boolean;
  position: number;
  title: string;
  description: string;
  max_points: number;
}

export interface RubricSection {
  id: string;
  template_id: string;
  position: number;
  title: string;
  weight: number;
  is_bonus: boolean;
  criteria: RubricCriterion[];
}

export interface RubricTemplate {
  id: string;
  title: string;
  subtitle: string;
  source_pdf: string;
  scale_instruction: string;
  guidance: string;
  core_max: number;
  bonus_max: number;
  family_id?: string;
  version?: number;
  lifecycle?: 'draft' | 'published' | 'archived';
  based_on_id?: string | null;
  created_by?: string | null;
  published_at?: string | null;
  published_by?: string | null;
  updated_at?: string;
  sections: RubricSection[]; // core sections, ordered
  bonus: RubricSection | null;
}

export type RubricVersionSummary = Omit<RubricTemplate, 'sections' | 'bonus'>;

export interface Team {
  id: string;
  team_code: string;
  name: string;
  project_name: string;
  level_code: string;
  governorate_code: string;
  template_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamJudge {
  team_id: string;
  judge_id: string;
  assigned_at: string;
}

export interface Evaluation {
  id: string;
  team_id: string;
  judge_id: string;
  template_id: string;
  status: EvaluationStatus;
  core_total: number;
  bonus_total: number;
  core_scored_count: number;
  core_criteria_count: number;
  section_notes: Record<string, string>;
  overall_notes: string;
  submitted_at: string | null;
  reopened_count: number;
  created_at: string;
  updated_at: string;
}

export interface EvaluationScore {
  evaluation_id: string;
  criterion_id: string;
  score: number | null;
  note: string;
  updated_at: string;
}

export interface TeamResult {
  team_id: string;
  team_code: string;
  team_name: string;
  project_name: string;
  organization: Organization;
  competition_code: string;
  competition_label: string;
  competition_sort: number;
  is_published: boolean;
  level_code: string;
  level_label: string;
  governorate_code: string;
  governorate_name: string;
  judges_required: number;
  judges_submitted: number;
  is_complete: boolean;
  avg_core: number | null;
  avg_bonus: number | null;
  provisional_core: number | null;
  provisional_bonus: number | null;
}

export interface LeaderboardRow {
  rank: number;
  team_id: string;
  team_code: string;
  team_name: string;
  project_name: string;
  organization: Organization;
  competition_code: string;
  competition_label: string;
  level_code: string;
  level_label: string;
  governorate_code: string;
  governorate_name: string;
  judges_submitted: number;
  judges_required: number;
  avg_core: number;
  avg_bonus: number;
  is_top: boolean;
  is_tied: boolean;
  is_published: boolean;
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  team_id: string | null;
  evaluation_id: string | null;
  details: Record<string, unknown>;
}

export interface DashboardStats {
  total_teams: number;
  total_judges: number;
  pending_judges: number;
  total_assignments: number;
  completed_evaluations: number;
  pending_evaluations: number;
  draft_evaluations: number;
  not_started_evaluations: number;
  teams_complete: number;
  teams_pending: number;
  teams_unassigned: number;
  by_competition: {
    code: string; label: string; organization: Organization; sort_order: number; is_published: boolean;
    teams: number; complete: number; pending: number; avg_core: number | null;
  }[];
  by_level: { code: string; label: string; organization: Organization; teams: number; complete: number; avg_core: number | null }[];
  by_governorate: { code: string; name: string; teams: number; complete: number; pending: number; avg_core: number | null }[];
  top_teams: {
    competition_code: string; competition_label: string; organization: Organization;
    avg_core: number; avg_bonus: number;
    teams: { team_code: string; team_name: string; project_name: string; governorate: string }[];
  }[];
}

export interface ScoreChange {
  criterion_id: string;
  score: number | null;
  note: string;
}

export interface ImportRow {
  team_code: string;
  name: string;
  project_name: string;
  level_code: string;
  governorate: string;
  judge_emails: string[];
}

export interface ImportResult {
  ok: boolean;
  errors: { row: number; message: string }[];
  inserted: number;
  updated: number;
  assignments_added: number;
}
