import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { fetchAudit } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { AuditEntry } from '@/lib/types';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, formatDate } from '@/components/ui';

const ACTIONS: [string, string][] = [
  ['', 'All activity'], ['score', 'Score changes'], ['evaluation', 'Submissions & reopens'], ['assignment', 'Assignments'],
  ['team', 'Teams'], ['profile', 'Account access'], ['leaderboard', 'Publication'],
];

export function describe(a: AuditEntry): string {
  const d = a.details as Record<string, unknown>;
  switch (a.action) {
    case 'score.changed':
      return `“${d.criterion}”: ${d.old_score ?? '—'} → ${d.new_score ?? '—'}`;
    case 'evaluation.submitted':
      return `Submitted · core ${d.core_total}, bonus ${d.bonus_total}`;
    case 'evaluation.reopened':
      return `Reopened · reason: ${d.reason}`;
    case 'evaluation.created':
      return `Evaluation started (${d.template_id})`;
    case 'assignment.added':
      return `Judge ${d.judge_email} assigned`;
    case 'assignment.removed':
      return `Judge ${d.judge_email} unassigned`;
    case 'profile.access_changed': {
      const o = d.old as { role: string; status: string }; const n = d.new as { role: string; status: string };
      return `${d.email}: ${o.role}/${o.status} → ${n.role}/${n.status}`;
    }
    case 'team.created': return `Team ${(d as { team_code?: string }).team_code} registered`;
    case 'team.updated': return `Team ${((d.new ?? {}) as { team_code?: string }).team_code} updated`;
    case 'team.deleted': return `Team ${(d as { team_code?: string }).team_code} deleted`;
    case 'teams.imported': return `Import: ${d.inserted} new, ${d.updated} updated, ${d.assignments_added} assignments`;
    case 'leaderboard.published': return `Leaderboard ${a.entity_id} published`;
    case 'leaderboard.unpublished': return `Leaderboard ${a.entity_id} unpublished`;
    default: return a.action;
  }
}

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <EmptyState icon={<History />} title="No activity recorded" />;
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((a) => (
        <li key={a.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
          <span className="w-44 shrink-0 text-xs tabular-nums text-slate-500">{formatDate(a.occurred_at)}</span>
          <Badge tone={a.action.startsWith('score') ? 'blue' : a.action.includes('reopen') ? 'amber' : a.action.includes('submitted') ? 'green' : 'slate'} className="w-fit">{a.action}</Badge>
          <span className="min-w-0 flex-1 text-sm text-slate-800">
            {describe(a)}
            {a.evaluation_id && a.action !== 'evaluation.created' && (
              <Link to={`/admin/evaluations/${a.evaluation_id}`} className="ml-2 text-xs font-medium text-brand-700 hover:underline">view</Link>
            )}
          </span>
          <span className="shrink-0 text-xs text-slate-500">{a.actor_email ?? 'system'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(200);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchAudit({ action: action || undefined, limit }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [action, limit]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Immutable record of score changes, submissions, reopens, assignments and access changes"
        actions={<Select value={action} onChange={(e) => { setAction(e.target.value); setLimit(200); }} className="w-56">{ACTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
      />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Card>
        {!entries ? <Spinner /> : <AuditList entries={entries} />}
        {entries && entries.length >= limit && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button variant="secondary" onClick={() => setLimit((l) => l + 200)}>Load more</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
