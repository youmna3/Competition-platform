import type { Evaluation, Profile, Team, TeamJudge } from './types';

export type JudgeProgressStatus = 'not_started' | 'in_progress' | 'submitted';

export interface JudgeProgressAssignment {
  judge: Profile;
  team: Team;
  assignment: TeamJudge;
  evaluation: Evaluation | null;
  status: JudgeProgressStatus;
}

export interface JudgeProgressSummary {
  judge: Profile;
  assignments: JudgeProgressAssignment[];
  organizations: string[];
  assigned: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  completionPercentage: number;
}

export function evaluationProgressStatus(evaluation?: Evaluation | null): JudgeProgressStatus {
  if (!evaluation) return 'not_started';
  return evaluation.status === 'submitted' ? 'submitted' : 'in_progress';
}

/** Derive progress from authoritative assignments and evaluations; no progress rows are stored. */
export function buildJudgeProgress(
  profiles: Profile[],
  assignments: TeamJudge[],
  teams: Team[],
  evaluations: Evaluation[],
): JudgeProgressSummary[] {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const evaluationByPair = new Map(evaluations.map((evaluation) => [`${evaluation.judge_id}:${evaluation.team_id}`, evaluation]));
  const assignmentsByJudge = new Map<string, JudgeProgressAssignment[]>();

  assignments.forEach((assignment) => {
    const team = teamById.get(assignment.team_id);
    const judge = profileById.get(assignment.judge_id);
    if (!team || !judge || judge.role !== 'judge') return;
    const evaluation = evaluationByPair.get(`${assignment.judge_id}:${assignment.team_id}`) ?? null;
    const row: JudgeProgressAssignment = { judge, team, assignment, evaluation, status: evaluationProgressStatus(evaluation) };
    assignmentsByJudge.set(judge.id, [...(assignmentsByJudge.get(judge.id) ?? []), row]);
  });

  return profiles
    .filter((profile) => profile.role === 'judge')
    .map((judge) => {
      const rows = assignmentsByJudge.get(judge.id) ?? [];
      const completed = rows.filter((row) => row.status === 'submitted').length;
      const inProgress = rows.filter((row) => row.status === 'in_progress').length;
      const notStarted = rows.filter((row) => row.status === 'not_started').length;
      return {
        judge,
        assignments: rows,
        organizations: [...new Set(rows.map((row) => row.team.organization))].sort(),
        assigned: rows.length,
        completed,
        inProgress,
        notStarted,
        completionPercentage: rows.length ? Math.round((completed / rows.length) * 100) : 0,
      };
    })
    .sort((a, b) => (a.judge.full_name || a.judge.email).localeCompare(b.judge.full_name || b.judge.email));
}
