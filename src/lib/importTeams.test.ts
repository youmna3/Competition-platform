import { describe, expect, it } from 'vitest';
import { buildImportRows, hasTeamIdConflict, resolveLevel, splitEmails, teamIdentityKey } from './importTeams';
import type { Governorate, Level, Team } from './types';

const levels: Level[] = [
  ['G4', 'DEMI', 'Grade 4', 'DEMI_G4'], ['G5', 'DEMI', 'Grade 5', 'DEMI_G5'], ['G6', 'DEMI', 'Grade 6', 'DEMI_G6'], ['L1', 'DECI', 'Level 1', 'DECI_L1'],
  ['L2', 'DECI', 'Level 2', 'DECI_L2'], ['L3', 'DECI', 'Level 3', 'DECI_L3'], ['L45', 'DECI', 'Levels 4 & 5', 'DECI_L45'],
].map(([code, organization, label, competition_code], i) => ({ code, organization, label, competition_code, sort_order: i, is_active: true } as Level));
const govs: Governorate[] = [['ALX', 'Alexandria'], ['CAI', 'Cairo'], ['MNF', 'Monufia'], ['AST', 'Assiut'], ['SUZ', 'Suez']].map(([code, name], i) => ({ code, name, sort_order: i }));

describe('resolveLevel', () => {
  it('maps common spellings', () => {
    expect(resolveLevel('DEMI', 'Grade 4', levels).code).toBe('G4');
    expect(resolveLevel('demi', '5', levels).code).toBe('G5');
    expect(resolveLevel('DEMI', 'Grade 6', levels).code).toBe('G6');
    expect(resolveLevel('DECI', 'Level 3', levels).code).toBe('L3');
    expect(resolveLevel('DECI', 'L5', levels).code).toBe('L45');
    expect(resolveLevel('DECI', 'Level 4', levels).code).toBe('L45');
    expect(resolveLevel('DECI', 'Levels 4 & 5', levels).code).toBe('L45');
  });
  it('rejects cross-organization and unknown organization values', () => {
    expect(resolveLevel('DEMI', 'Level 1', levels).code).toBeNull();
    expect(resolveLevel('DECI', 'Grade 4', levels).code).toBeNull();
    expect(resolveLevel('XYZ', 'Grade 4', levels).code).toBeNull();
  });
});

describe('buildImportRows', () => {
  const judges = new Set(['a@x.com', 'b@x.com']);
  it('parses valid rows and flags problems', () => {
    const { rows, headerErrors } = buildImportRows(
      [
        { 'Team ID': 'T1', 'Team Name': 'One', 'Project Name': 'P', Organization: 'DEMI', 'Grade or Level': 'Grade 4', Governorate: 'Cairo', 'Judge Emails': 'A@x.com; b@x.com' },
        { 'Team ID': 't1', 'Team Name': 'Other organization', 'Project Name': 'P', Organization: 'DECI', 'Grade or Level': 'Level 1', Governorate: 'Alexandria', 'Judge Emails': '' },
        { 'Team ID': 'T1', 'Team Name': 'Same organization', 'Project Name': 'P', Organization: 'DEMI', 'Grade or Level': 'Grade 5', Governorate: 'Assiut', 'Judge Emails': '' },
        { 'Team ID': '', 'Team Name': '', 'Project Name': '', Organization: '', 'Grade or Level': '', Governorate: '', 'Judge Emails': '' },
      ],
      levels, govs, judges,
    );
    expect(headerErrors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ team_code: 'T1', level_code: 'G4', governorate: 'CAI', judge_emails: ['a@x.com', 'b@x.com'], errors: [] });
    expect(rows[1]).toMatchObject({ team_code: 't1', organization: 'DECI', level_code: 'L1', errors: [] });
    expect(rows[2].errors.join(' ')).toMatch(/Duplicate Team ID/);
  });
  it('reports missing columns', () => {
    expect(buildImportRows([{ foo: 1 }], levels, govs, judges).headerErrors.length).toBeGreaterThan(0);
  });
  it('splits e-mail lists', () => {
    expect(splitEmails('a@x.com, B@x.com;a@x.com | c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });
  it('keys duplicate validation by organization and case-insensitive Team ID', () => {
    expect(teamIdentityKey('DEMI', 'G-18')).toBe(teamIdentityKey('demi', 'g-18'));
    expect(teamIdentityKey('DEMI', 'G-18')).not.toBe(teamIdentityKey('DECI', 'G-18'));
  });
  it('applies the same organization-scoped rule to manual registration', () => {
    const teams = [
      { id: 'demi-team', team_code: 'G-18', organization: 'DEMI', level_code: 'G4' },
      { id: 'deci-team', team_code: 'D-1', organization: 'DECI', level_code: 'L1' },
    ] as Team[];
    expect(hasTeamIdConflict(teams, 'DEMI', 'g-18')).toBe(true);
    expect(hasTeamIdConflict(teams, 'DECI', 'G-18')).toBe(false);
    expect(hasTeamIdConflict(teams, 'DEMI', 'G-18', 'demi-team')).toBe(false);
  });
});
