import { describe, expect, it } from 'vitest';
import { buildImportRows, resolveLevel, splitEmails } from './importTeams';
import type { Governorate, Level } from './types';

const levels: Level[] = [
  ['G4', 'DEMI', 'Grade 4', 'DEMI_G4'], ['G5', 'DEMI', 'Grade 5', 'DEMI_G5'], ['G6', 'DEMI', 'Grade 6', 'DEMI_G6'], ['L1', 'DECI', 'Level 1', 'DECI_L1'],
  ['L2', 'DECI', 'Level 2', 'DECI_L2'], ['L3', 'DECI', 'Level 3', 'DECI_L3'], ['L4', 'DECI', 'Level 4', 'DECI_L45'], ['L5', 'DECI', 'Level 5', 'DECI_L45'],
].map(([code, organization, label, competition_code], i) => ({ code, organization, label, competition_code, sort_order: i } as Level));
const govs: Governorate[] = [['ALX', 'Alexandria'], ['CAI', 'Cairo'], ['MNF', 'Monufia'], ['AST', 'Assiut'], ['SUZ', 'Suez']].map(([code, name], i) => ({ code, name, sort_order: i }));

describe('resolveLevel', () => {
  it('maps common spellings', () => {
    expect(resolveLevel('DEMI', 'Grade 4', levels).code).toBe('G4');
    expect(resolveLevel('demi', '5', levels).code).toBe('G5');
    expect(resolveLevel('DEMI', 'Grade 6', levels).code).toBe('G6');
    expect(resolveLevel('DECI', 'Level 3', levels).code).toBe('L3');
    expect(resolveLevel('DECI', 'L5', levels).code).toBe('L5');
  });
  it('rejects cross-organization and combined values', () => {
    expect(resolveLevel('DEMI', 'Level 1', levels).code).toBeNull();
    expect(resolveLevel('DECI', 'Grade 4', levels).code).toBeNull();
    expect(resolveLevel('DECI', 'Levels 4 & 5', levels).error).toMatch(/actual level/);
    expect(resolveLevel('XYZ', 'Grade 4', levels).code).toBeNull();
  });
});

describe('buildImportRows', () => {
  const judges = new Set(['a@x.com', 'b@x.com']);
  it('parses valid rows and flags problems', () => {
    const { rows, headerErrors } = buildImportRows(
      [
        { 'Team ID': 'T1', 'Team Name': 'One', 'Project Name': 'P', Organization: 'DEMI', 'Grade or Level': 'Grade 4', Governorate: 'Cairo', 'Judge Emails': 'A@x.com; b@x.com' },
        { 'Team ID': 't1', 'Team Name': 'Dup', 'Project Name': 'P', Organization: 'DECI', 'Grade or Level': 'Level 9', Governorate: 'Giza', 'Judge Emails': 'c@x.com' },
        { 'Team ID': '', 'Team Name': '', 'Project Name': '', Organization: '', 'Grade or Level': '', Governorate: '', 'Judge Emails': '' },
      ],
      levels, govs, judges,
    );
    expect(headerErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ team_code: 'T1', level_code: 'G4', governorate: 'CAI', judge_emails: ['a@x.com', 'b@x.com'], errors: [] });
    expect(rows[1].errors.join(' ')).toMatch(/Duplicate Team ID/);
    expect(rows[1].errors.join(' ')).toMatch(/not a valid DECI/);
    expect(rows[1].errors.join(' ')).toMatch(/Governorate/);
    expect(rows[1].errors.join(' ')).toMatch(/no approved account/);
  });
  it('reports missing columns', () => {
    expect(buildImportRows([{ foo: 1 }], levels, govs, judges).headerErrors.length).toBeGreaterThan(0);
  });
  it('splits e-mail lists', () => {
    expect(splitEmails('a@x.com, B@x.com;a@x.com | c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });
});
