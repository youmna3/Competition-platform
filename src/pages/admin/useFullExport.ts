import { useState } from 'react';
import {
  fetchAllEvaluations, fetchAllScores, fetchAudit, fetchLeaderboard, fetchProfiles, fetchTeamResults, fetchTeams, loadReference, loadTemplate,
} from '@/lib/api';
import { exportAllResults } from '@/lib/exportResults';
import { errorMessage } from '@/lib/supabase';
import type { RubricTemplate } from '@/lib/types';
import { useToast } from '@/components/ui';

export function useFullExport() {
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const runExport = async () => {
    setExporting(true);
    try {
      const ref = await loadReference();
      const [teamResults, leaderboard, evaluations, scores, profiles, teams, audit, tpls] = await Promise.all([
        fetchTeamResults(), fetchLeaderboard(), fetchAllEvaluations(), fetchAllScores(), fetchProfiles(), fetchTeams(),
        fetchAudit({ limit: 5000 }),
        Promise.all([...new Set(ref.competitions.map((c) => c.template_id))].map((id) => loadTemplate(id))),
      ]);
      const templates: Record<string, RubricTemplate> = Object.fromEntries(tpls.map((t) => [t.id, t]));
      await exportAllResults({ teamResults, leaderboard, evaluations, scores, profiles, teams, templates, audit });
      toast('success', 'Results workbook downloaded');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  return { exporting, runExport };
}
