import { describe, expect, it } from 'vitest';
import { buildUserImportRows, normalizeUserGovernorate, passwordValidationError } from './importUsers';
import type { Governorate } from './types';

const governorates: Governorate[] = [
  ['CAI','Cairo'],['ALX','Alexandria'],['MNF','Monufia'],['AST','Assiut'],['SUZ','Suez'],
].map(([code,name],sort_order)=>({code,name,sort_order}));

const record=(index:number,overrides:Record<string,string>={})=>({
  'Full Name':`Judge ${index}`,'Email':`judge${index}@example.com`,'Password':`Strong!Pass${index}word`,'Governorate':'Cairo',...overrides,
});

describe('bulk user import',()=>{
  it('previews more than 20 valid users without retaining passwords in result fields',()=>{
    const {rows,headerErrors}=buildUserImportRows(Array.from({length:25},(_,index)=>record(index+1)),governorates);
    expect(headerErrors).toEqual([]);expect(rows).toHaveLength(25);expect(rows.every(row=>row.errors.length===0)).toBe(true);
    expect(rows[0]).toMatchObject({fullName:'Judge 1',email:'judge1@example.com',governorateCode:'CAI',governorateName:'Cairo'});
  });
  it('normalizes safe governorate spelling and case variants',()=>{
    expect(normalizeUserGovernorate('alex',governorates)?.code).toBe('ALX');
    expect(normalizeUserGovernorate('Menoufia',governorates)?.code).toBe('MNF');
    expect(normalizeUserGovernorate('ASYUT',governorates)?.code).toBe('AST');
    expect(normalizeUserGovernorate('Suez',governorates)?.code).toBe('SUZ');
  });
  it('reports missing, weak, duplicate, invalid-governorate and existing-account rows',()=>{
    const {rows}=buildUserImportRows([
      record(1),record(2,{'Email':'JUDGE1@example.com'}),
      record(3,{'Full Name':'','Password':'weak','Governorate':'Unknown'}),
      record(4),
    ],governorates,new Set(['judge4@example.com']));
    expect(rows[1].errors).toContain('Duplicate e-mail in uploaded file');
    expect(rows[2].errors.join(' ')).toMatch(/Full Name|12 characters|Governorate/);
    expect(rows[3].errors).toContain('Account already exists');
  });
  it('uses the same strong-password policy as mandatory password replacement',()=>{
    expect(passwordValidationError('weak')).toBeTruthy();
    expect(passwordValidationError('Strong!Pass123')).toBeNull();
  });
});
