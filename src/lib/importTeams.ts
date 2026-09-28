import type { Governorate, ImportRow, Level } from './types';

export interface ParsedImportRow extends ImportRow {
  rowNumber: number; // 1-based data row number (header excluded)
  organization: string;
  gradeLevel: string;
  errors: string[];
}

const HEADER_ALIASES: Record<string, keyof RawRow> = {
  'team id': 'team_code', team_id: 'team_code', 'team code': 'team_code', team_code: 'team_code', id: 'team_code', 'team #': 'team_code',
  'team name': 'name', team_name: 'name', team: 'name', name: 'name',
  'project name': 'project_name', project_name: 'project_name', project: 'project_name',
  organization: 'organization', organisation: 'organization', org: 'organization', competition: 'organization',
  'grade or level': 'grade_level', 'grade/level': 'grade_level', grade_level: 'grade_level', 'grade level': 'grade_level',
  grade: 'grade_level', level: 'grade_level',
  governorate: 'governorate', governorates: 'governorate', city: 'governorate',
  judges: 'judges', 'judge emails': 'judges', judge_emails: 'judges', 'assigned judges': 'judges', 'assigned judge(s)': 'judges',
  'judge email': 'judges', judge: 'judges', 'judge(s)': 'judges',
};

interface RawRow {
  team_code: string; name: string; project_name: string; organization: string;
  grade_level: string; governorate: string; judges: string;
}

export const TEMPLATE_HEADERS = ['Team ID', 'Team Name', 'Project Name', 'Organization', 'Grade or Level', 'Governorate', 'Judge Emails'];

export function normaliseHeader(h: string): keyof RawRow | null {
  const k = h.trim().toLowerCase().replace(/\s+/g, ' ');
  return HEADER_ALIASES[k] ?? HEADER_ALIASES[k.replace(/ /g, '_')] ?? null;
}

/** Map organization + free-text grade/level to a level code (G4..G6, L1..L5). */
export function resolveLevel(organization: string, gradeLevel: string, levels: Level[]): { code: string | null; error?: string } {
  const org = organization.trim().toUpperCase();
  const gl = gradeLevel.trim();
  if (org !== 'DEMI' && org !== 'DECI') return { code: null, error: `Organization must be DEMI or DECI (got "${organization}")` };
  if (!gl) return { code: null, error: 'Grade or level is required' };
  if (/4\s*(&|and|\/|-)\s*5/i.test(gl)) {
    return { code: null, error: 'Enter the team\'s actual level ("Level 4" or "Level 5"); both use the shared Levels 4 & 5 rubric' };
  }
  if ((org === 'DECI' && /grade/i.test(gl)) || (org === 'DEMI' && /level/i.test(gl))) {
    const allowed = levels.filter((l) => l.organization === org).map((l) => l.label).join(', ');
    return { code: null, error: `"${gradeLevel}" is not a valid ${org} grade/level (allowed: ${allowed})` };
  }
  const digit = gl.match(/(\d)/)?.[1];
  const direct = levels.find((l) => l.code.toUpperCase() === gl.toUpperCase() || l.label.toLowerCase() === gl.toLowerCase());
  const byDigit = digit ? levels.find((l) => l.organization === org && l.code.endsWith(digit)) : undefined;
  const lvl = direct && direct.organization === org ? direct : byDigit;
  if (!lvl) {
    const allowed = levels.filter((l) => l.organization === org).map((l) => l.label).join(', ');
    return { code: null, error: `"${gradeLevel}" is not a valid ${org} grade/level (allowed: ${allowed})` };
  }
  return { code: lvl.code };
}

export function splitEmails(v: string): string[] {
  return Array.from(
    new Set(
      v.split(/[;,|\n]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
    ),
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildImportRows(
  records: Record<string, unknown>[],
  levels: Level[],
  governorates: Governorate[],
  knownJudgeEmails: Set<string>,
): { rows: ParsedImportRow[]; headerErrors: string[] } {
  const headerErrors: string[] = [];
  if (records.length === 0) return { rows: [], headerErrors: ['The file contains no data rows'] };
  const headers = Object.keys(records[0]);
  const mapping = new Map<string, keyof RawRow>();
  headers.forEach((h) => {
    const k = normaliseHeader(h);
    if (k && ![...mapping.values()].includes(k)) mapping.set(h, k);
  });
  const required: (keyof RawRow)[] = ['team_code', 'name', 'project_name', 'organization', 'grade_level', 'governorate'];
  const present = new Set(mapping.values());
  for (const r of required) {
    if (!present.has(r)) headerErrors.push(`Missing column: ${TEMPLATE_HEADERS[required.indexOf(r)]}`);
  }
  if (headerErrors.length) return { rows: [], headerErrors };

  const seen = new Map<string, number>();
  const rows: ParsedImportRow[] = [];
  records.forEach((rec, i) => {
    const raw: RawRow = { team_code: '', name: '', project_name: '', organization: '', grade_level: '', governorate: '', judges: '' };
    for (const [h, k] of mapping) raw[k] = String(rec[h] ?? '').trim();
    if (Object.values(raw).every((v) => v === '')) return; // skip blank lines
    const errors: string[] = [];
    if (!raw.team_code) errors.push('Team ID is required');
    if (!raw.name) errors.push('Team name is required');
    if (!raw.project_name) errors.push('Project name is required');
    const lvl = resolveLevel(raw.organization, raw.grade_level, levels);
    if (lvl.error) errors.push(lvl.error);
    const gov = governorates.find(
      (g) => g.name.toLowerCase() === raw.governorate.toLowerCase() || g.code.toLowerCase() === raw.governorate.toLowerCase(),
    );
    if (!gov) errors.push(`Governorate must be one of ${governorates.map((g) => g.name).join(', ')} (got "${raw.governorate}")`);
    const emails = splitEmails(raw.judges);
    for (const e of emails) {
      if (!EMAIL_RE.test(e)) errors.push(`"${e}" is not a valid e-mail`);
      else if (!knownJudgeEmails.has(e)) errors.push(`Judge "${e}" has no approved account yet`);
    }
    const key = raw.team_code.toLowerCase();
    if (key) {
      if (seen.has(key)) errors.push(`Duplicate Team ID (also on row ${seen.get(key)})`);
      else seen.set(key, i + 1);
    }
    rows.push({
      rowNumber: i + 1,
      team_code: raw.team_code,
      name: raw.name,
      project_name: raw.project_name,
      level_code: lvl.code ?? '',
      governorate: gov?.code ?? raw.governorate,
      judge_emails: emails,
      organization: raw.organization.toUpperCase(),
      gradeLevel: raw.grade_level,
      errors,
    });
  });
  return { rows, headerErrors };
}

/** Read a CSV or Excel file into an array of header-keyed records. */
export async function readSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    const Papa = (await import('papaparse')).default;
    const text = await file.text();
    const res = Papa.parse<Record<string, unknown>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' });
    if (res.errors.length && res.data.length === 0) throw new Error(res.errors[0].message);
    return res.data;
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value);
    });
    const out: Record<string, unknown>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        if (h) rec[h] = cellText(row.getCell(idx + 1).value);
      });
      out.push(rec);
    });
    return out;
  }
  throw new Error('Unsupported file type. Upload a .csv or .xlsx file.');
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { text?: string; richText?: { text: string }[]; result?: unknown; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}
