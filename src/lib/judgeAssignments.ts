import type { Evaluation, Team, TeamJudge } from './types';

export type JudgeAssignmentStatus = 'not_started' | 'in_progress' | 'submitted';

export interface JudgeAssignmentRow {
  team: Team;
  evaluation: Evaluation | null;
  status: JudgeAssignmentStatus;
  action: 'Start Evaluation' | 'Continue Evaluation' | 'View Submission';
}

export function assignmentStatus(evaluation?: Evaluation | null): JudgeAssignmentStatus {
  if (!evaluation) return 'not_started';
  return evaluation.status === 'submitted' ? 'submitted' : 'in_progress';
}

export function assignmentAction(status: JudgeAssignmentStatus): JudgeAssignmentRow['action'] {
  if (status === 'submitted') return 'View Submission';
  if (status === 'in_progress') return 'Continue Evaluation';
  return 'Start Evaluation';
}

/** Defense-in-depth: intersect every row with the signed-in judge's assignment and evaluation IDs. */
export function buildJudgeAssignments(
  judgeId: string,
  teams: Team[],
  assignments: TeamJudge[],
  evaluations: Evaluation[],
): JudgeAssignmentRow[] {
  const assignedTeamIds = new Set(assignments.filter((row) => row.judge_id === judgeId).map((row) => row.team_id));
  const evaluationByTeam = new Map(
    evaluations.filter((evaluation) => evaluation.judge_id === judgeId).map((evaluation) => [evaluation.team_id, evaluation]),
  );
  return teams
    .filter((team) => assignedTeamIds.has(team.id))
    .map((team) => {
      const evaluation = evaluationByTeam.get(team.id) ?? null;
      const status = assignmentStatus(evaluation);
      return { team, evaluation, status, action: assignmentAction(status) };
    })
    .sort((a, b) => a.team.team_code.localeCompare(b.team.team_code, undefined, { numeric: true }));
}
