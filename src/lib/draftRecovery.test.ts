import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRecoverableDraft, loadRecoverableDraft, storeRecoverableDraft } from './draftRecovery';

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

describe('evaluation draft recovery', () => {
  afterEach(() => { values.clear(); vi.unstubAllGlobals(); });

  it('persists and restores unsent score and note changes', () => {
    vi.stubGlobal('localStorage', storage);
    storeRecoverableDraft('evaluation-1', {
      scores: new Map([['criterion-1', { criterion_id: 'criterion-1', score: 4, note: 'Recovered note' }]]),
      sections: { section1: 'Recovered section' },
      overall: 'Recovered overall',
      teamName: 'Recovered team',
      projectName: 'Recovered project',
    });
    expect(loadRecoverableDraft('evaluation-1')).toMatchObject({
      scores: [{ criterion_id: 'criterion-1', score: 4, note: 'Recovered note' }],
      sections: { section1: 'Recovered section' },
      overall: 'Recovered overall',
      teamName: 'Recovered team',
      projectName: 'Recovered project',
    });
  });

  it('clears recovered data after a successful save or submission', () => {
    vi.stubGlobal('localStorage', storage);
    storeRecoverableDraft('evaluation-1', {
      scores: new Map([['criterion-1', { criterion_id: 'criterion-1', score: 5, note: '' }]]),
      sections: {}, overall: null,
    });
    clearRecoverableDraft('evaluation-1');
    expect(loadRecoverableDraft('evaluation-1')).toBeNull();
  });

  it('recovers team and project names even before any score is entered',()=>{
    vi.stubGlobal('localStorage',storage);
    storeRecoverableDraft('evaluation-names',{scores:new Map(),sections:{},overall:null,teamName:'Manual team',projectName:'Manual project'});
    expect(loadRecoverableDraft('evaluation-names')).toMatchObject({teamName:'Manual team',projectName:'Manual project'});
  });
});
