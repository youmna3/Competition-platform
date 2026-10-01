import type {
  AuditEntry, Evaluation, EvaluationScore, LeaderboardRow, Profile, RubricTemplate, Team, TeamResult,
} from './types';
import { TEMPLATE_HEADERS } from './importTeams';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

type Sheet = { name: string; columns: { header: string; key: string; width?: number }[]; rows: Record<string, unknown>[] };

async function writeWorkbook(sheets: Sheet[], filename: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DEMI · DECI Judging Platform';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF043FAD' } };
    s.rows.forEach((r) => ws.addRow(r));
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export async function exportLeaderboard(rows: LeaderboardRow[], filename = `leaderboard-${stamp()}.xlsx`) {
  await writeWorkbook(
    [
      {
        name: 'Leaderboard',
        columns: [
          { header: 'Organization', key: 'organization' },
          { header: 'Competition', key: 'competition_label', width: 16 },
          { header: 'Rank', key: 'rank', width: 8 },
          { header: 'Tied', key: 'tied', width: 8 },
          { header: 'Team ID', key: 'team_code' },
          { header: 'Team Name', key: 'team_name', width: 28 },
          { header: 'Project Name', key: 'project_name', width: 30 },
          { header: 'Grade / Level', key: 'level_label' },
          { header: 'Governorate', key: 'governorate_name' },
          { header: 'Completed Judges', key: 'judges', width: 18 },
          { header: 'Average Core Score (/100)', key: 'avg_core', width: 24 },
          { header: 'Average Bonus (separate)', key: 'avg_bonus', width: 24 },
          { header: 'Top of Category', key: 'top', width: 16 },
        ],
        rows: rows.map((r) => ({
          ...r,
          tied: r.is_tied ? 'Yes' : '',
          judges: `${r.judges_submitted}/${r.judges_required}`,
          top: r.is_top ? 'Yes' : '',
        })),
      },
    ],
    filename,
  );
}

export interface FullExportInput {
  teamResults: TeamResult[];
  leaderboard: LeaderboardRow[];
  evaluations: Evaluation[];
  scores: EvaluationScore[];
  profiles: Profile[];
  teams: Team[];
  templates: Record<string, RubricTemplate>;
  audit: AuditEntry[];
}

export async function exportAllResults(input: FullExportInput) {
  const judge = new Map(input.profiles.map((p) => [p.id, p]));
  const team = new Map(input.teams.map((t) => [t.id, t]));
  const result = new Map(input.teamResults.map((r) => [r.team_id, r]));
  const scoresByEval = new Map<string, Map<string, EvaluationScore>>();
  input.scores.forEach((s) => {
    if (!scoresByEval.has(s.evaluation_id)) scoresByEval.set(s.evaluation_id, new Map());
    scoresByEval.get(s.evaluation_id)!.set(s.criterion_id, s);
  });

  const evalRows = input.evaluations.map((e) => {
    const t = team.get(e.team_id);
    const r = result.get(e.team_id);
    const tpl = input.templates[e.template_id];
    const sc = scoresByEval.get(e.id) ?? new Map();
    const row: Record<string, unknown> = {
      organization: r?.organization, competition: r?.competition_label, level: r?.level_label,
      governorate: r?.governorate_name, team_code: t?.team_code, team_name: e.entered_team_name, project_name: e.entered_project_name,
      judge_name: judge.get(e.judge_id)?.full_name, judge_email: judge.get(e.judge_id)?.email,
      rubric: e.template_id, status: e.status, core_total: e.core_total, bonus_total: e.bonus_total,
      scored: `${e.core_scored_count}/${e.core_criteria_count}`,
      submitted_at: e.submitted_at ? new Date(e.submitted_at).toLocaleString() : '',
      reopened: e.reopened_count, overall_notes: e.overall_notes,
    };
    tpl?.sections.forEach((s, i) => {
      row[`s${i + 1}`] = `${s.criteria.reduce((a, c) => a + (sc.get(c.id)?.score ?? 0), 0)}/${s.weight}`;
    });
    return row;
  });
  const maxSections = Math.max(0, ...Object.values(input.templates).map((t) => t.sections.length));

  const criterionRows: Record<string, unknown>[] = [];
  input.evaluations.forEach((e) => {
    const tpl = input.templates[e.template_id];
    const sc = scoresByEval.get(e.id) ?? new Map();
    if (!tpl) return;
    [...tpl.sections, ...(tpl.bonus ? [tpl.bonus] : [])].forEach((s) =>
      s.criteria.forEach((c) => {
        const v = sc.get(c.id);
        criterionRows.push({
          team_code: team.get(e.team_id)?.team_code, judge_email: judge.get(e.judge_id)?.email, rubric: e.template_id,
          status: e.status, section: s.title, bonus: s.is_bonus ? 'Bonus' : 'Core', criterion: c.title,
          score: v?.score ?? '', note: v?.note ?? '', section_note: e.section_notes?.[s.id] ?? '',
        });
      }),
    );
  });

  await writeWorkbook(
    [
      {
        name: 'Official Leaderboard',
        columns: [
          { header: 'Organization', key: 'organization' }, { header: 'Competition', key: 'competition_label', width: 16 },
          { header: 'Rank', key: 'rank', width: 8 }, { header: 'Tied', key: 'tied', width: 8 },
          { header: 'Team ID', key: 'team_code' }, { header: 'Team Name', key: 'team_name', width: 28 },
          { header: 'Project Name', key: 'project_name', width: 30 }, { header: 'Grade / Level', key: 'level_label' },
          { header: 'Governorate', key: 'governorate_name' }, { header: 'Completed Judges', key: 'judges', width: 18 },
          { header: 'Average Core Score (/100)', key: 'avg_core', width: 24 },
          { header: 'Average Bonus (separate)', key: 'avg_bonus', width: 24 },
          { header: 'Published', key: 'published', width: 12 },
        ],
        rows: input.leaderboard.map((r) => ({
          ...r, tied: r.is_tied ? 'Yes' : '', judges: `${r.judges_submitted}/${r.judges_required}`, published: r.is_published ? 'Yes' : 'No',
        })),
      },
      {
        name: 'All Teams Status',
        columns: [
          { header: 'Organization', key: 'organization' }, { header: 'Competition', key: 'competition_label', width: 16 },
          { header: 'Grade / Level', key: 'level_label' }, { header: 'Governorate', key: 'governorate_name' },
          { header: 'Team ID', key: 'team_code' }, { header: 'Team Name', key: 'team_name', width: 28 },
          { header: 'Project Name', key: 'project_name', width: 30 }, { header: 'Status', key: 'status', width: 14 },
          { header: 'Submitted / Required', key: 'judges', width: 20 },
          { header: 'Official Avg Core', key: 'avg_core', width: 18 }, { header: 'Official Avg Bonus', key: 'avg_bonus', width: 18 },
          { header: 'Provisional Avg Core (not official)', key: 'provisional_core', width: 32 },
        ],
        rows: input.teamResults.map((r) => ({
          ...r,
          status: r.judges_required === 0 ? 'Unassigned' : r.is_complete ? 'Complete' : 'Pending',
          judges: `${r.judges_submitted}/${r.judges_required}`,
          avg_core: r.avg_core === null ? '' : round2(r.avg_core),
          avg_bonus: r.avg_bonus === null ? '' : round2(r.avg_bonus),
          provisional_core: r.is_complete || r.provisional_core === null ? '' : round2(r.provisional_core),
        })),
      },
      {
        name: 'Judge Evaluations',
        columns: [
          { header: 'Organization', key: 'organization' }, { header: 'Competition', key: 'competition', width: 16 },
          { header: 'Grade / Level', key: 'level' }, { header: 'Governorate', key: 'governorate' },
          { header: 'Team ID', key: 'team_code' }, { header: 'Team Name', key: 'team_name', width: 26 },
          { header: 'Project Name', key: 'project_name', width: 26 }, { header: 'Judge', key: 'judge_name', width: 22 },
          { header: 'Judge Email', key: 'judge_email', width: 28 }, { header: 'Rubric', key: 'rubric' },
          { header: 'Status', key: 'status' }, { header: 'Core Total (/100)', key: 'core_total', width: 16 },
          { header: 'Bonus Total', key: 'bonus_total' }, { header: 'Core Rows Scored', key: 'scored', width: 16 },
          ...Array.from({ length: maxSections }, (_, i) => ({ header: `Section ${i + 1}`, key: `s${i + 1}`, width: 11 })),
          { header: 'Submitted At', key: 'submitted_at', width: 22 }, { header: 'Times Reopened', key: 'reopened' },
          { header: 'Overall Notes', key: 'overall_notes', width: 40 },
        ],
        rows: evalRows,
      },
      {
        name: 'Criterion Scores',
        columns: [
          { header: 'Team ID', key: 'team_code' }, { header: 'Judge Email', key: 'judge_email', width: 28 },
          { header: 'Rubric', key: 'rubric' }, { header: 'Status', key: 'status' },
          { header: 'Section', key: 'section', width: 34 }, { header: 'Core/Bonus', key: 'bonus' },
          { header: 'Criterion', key: 'criterion', width: 40 }, { header: 'Score (1-5)', key: 'score' },
          { header: 'Judge Note', key: 'note', width: 40 }, { header: 'Section Note', key: 'section_note', width: 30 },
        ],
        rows: criterionRows,
      },
      {
        name: 'Audit Log',
        columns: [
          { header: 'When', key: 'when', width: 22 }, { header: 'Actor', key: 'actor_email', width: 28 },
          { header: 'Action', key: 'action', width: 24 }, { header: 'Entity', key: 'entity' },
          { header: 'Entity ID', key: 'entity_id', width: 40 }, { header: 'Details', key: 'details_text', width: 80 },
        ],
        rows: input.audit.map((a) => ({ ...a, when: new Date(a.occurred_at).toLocaleString(), details_text: JSON.stringify(a.details) })),
      },
    ],
    `competition-results-${stamp()}.xlsx`,
  );
}

export async function downloadImportTemplate() {
  await writeWorkbook(
    [
      {
        name: 'Teams',
        columns: TEMPLATE_HEADERS.map((h) => ({ header: h, key: h, width: h === 'Judge Emails' ? 44 : 18 })),
        rows: [],
      },
      {
        name: 'Allowed values',
        columns: [
          { header: 'Organization', key: 'o' }, { header: 'Grade or Level', key: 'g', width: 18 },
          { header: 'Governorate', key: 'v' }, { header: 'Judge Emails', key: 'j', width: 60 },
        ],
        rows: [
          { o: 'DEMI', g: 'Grade 4', v: 'Alexandria', j: 'Approved judge e-mails separated by ; (optional)' },
          { o: 'DEMI', g: 'Grade 5', v: 'Cairo', j: 'Leave empty to assign judges later' },
          { o: 'DEMI', g: 'Grade 6', v: 'Cairo' },
          { o: 'DECI', g: 'Level 1', v: 'Monufia' },
          { o: 'DECI', g: 'Level 2', v: 'Assiut' },
          { o: 'DECI', g: 'Level 3', v: 'Suez' },
          { o: 'DECI', g: 'Levels 4 & 5' },
        ],
      },
    ],
    'team-import-template.xlsx',
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
