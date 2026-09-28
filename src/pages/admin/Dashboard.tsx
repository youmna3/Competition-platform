import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Download, Hourglass, MapPin, Trophy, UserCheck, UsersRound } from 'lucide-react';
import { fetchDashboard, subscribeToResults } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { DashboardStats } from '@/lib/types';
import { Alert, Badge, Button, Card, CardHeader, OrgBadge, PageHeader, ProgressBar, Spinner, StatCard, formatScore } from '@/components/ui';
import { useFullExport } from './useFullExport';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { exporting, runExport } = useFullExport();

  const load = useCallback(async () => {
    try {
      setStats(await fetchDashboard());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const unsub = subscribeToResults(() => void load());
    const t = setInterval(() => void load(), 30000);
    return () => { unsub(); clearInterval(t); };
  }, [load]);

  if (error) return <Alert tone="error" title="Could not load dashboard">{error}</Alert>;
  if (!stats) return <Spinner />;

  const pct = stats.total_assignments ? Math.round((stats.completed_evaluations / stats.total_assignments) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Administrator dashboard"
        subtitle="Live overview of registration, judging progress and results"
        actions={<Button onClick={runExport} loading={exporting}><Download size={16} /> Export all results</Button>}
      />

      {stats.pending_judges > 0 && (
        <Alert tone="warning" className="mb-6" title={`${stats.pending_judges} judge account${stats.pending_judges === 1 ? '' : 's'} awaiting approval`}>
          <Link to="/admin/judges?status=pending" className="font-semibold underline">Review sign-ups</Link>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered teams" value={stats.total_teams} icon={<UsersRound size={20} />} hint={`${stats.teams_unassigned} without judges`} />
        <StatCard label="Approved judges" value={stats.total_judges} icon={<UserCheck size={20} />} tone="violet" hint={`${stats.total_assignments} assignments`} />
        <StatCard label="Completed evaluations" value={stats.completed_evaluations} icon={<CheckCircle2 size={20} />} tone="green" hint={`${pct}% of all assignments`} />
        <StatCard label="Pending evaluations" value={stats.pending_evaluations} icon={<Hourglass size={20} />} tone="amber" hint={`${stats.draft_evaluations} in draft · ${stats.not_started_evaluations} not started`} />
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-slate-900">Overall judging progress</span>
          <span className="text-slate-600">
            {stats.teams_complete} team{stats.teams_complete === 1 ? "" : "s"} finalized · {stats.teams_pending} pending
          </span>
        </div>
        <ProgressBar value={stats.completed_evaluations} max={stats.total_assignments} tone={pct === 100 ? 'green' : 'blue'} className="h-3" />
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Results by organization and grade / level" subtitle="Official averages include finalized teams only" actions={<Link className="text-sm font-medium text-brand-700" to="/leaderboard">Leaderboards →</Link>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Category</th>
                  <th className="px-3 py-2.5 text-right">Teams</th>
                  <th className="px-3 py-2.5">Finalized</th>
                  <th className="px-3 py-2.5 text-right">Avg score</th>
                  <th className="px-5 py-2.5">Leaderboard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.by_competition.map((c) => (
                  <tr key={c.code}>
                    <td className="px-5 py-3"><div className="flex items-center gap-2"><OrgBadge org={c.organization} /> <span className="font-medium text-slate-900">{c.label}</span></div></td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.teams}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={c.complete} max={c.teams} tone={c.teams > 0 && c.complete === c.teams ? 'green' : 'blue'} className="w-24" />
                        <span className="text-xs tabular-nums text-slate-600">{c.complete}/{c.teams}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatScore(c.avg_core)}</td>
                    <td className="px-5 py-3">{c.is_published ? <Badge tone="green">Published</Badge> : <Badge>Hidden</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-5 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By actual grade / level</p>
            <div className="flex flex-wrap gap-2">
              {stats.by_level.map((l) => (
                <span key={l.code} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700">
                  <strong>{l.organization} {l.label}</strong>: {l.complete}/{l.teams} final · avg {formatScore(l.avg_core)}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Results by governorate" />
          <ul className="divide-y divide-slate-100">
            {stats.by_governorate.map((g) => (
              <li key={g.code} className="flex items-center gap-3 px-5 py-3">
                <MapPin size={16} className="text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-900">{g.name}</span>
                    <span className="tabular-nums text-slate-600">{g.complete}/{g.teams} final</span>
                  </div>
                  <ProgressBar value={g.complete} max={g.teams} className="mt-1.5" tone={g.teams > 0 && g.complete === g.teams ? 'green' : 'blue'} />
                </div>
                <span className="w-14 text-right text-sm font-semibold tabular-nums">{formatScore(g.avg_core)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Highest-scoring teams" subtitle="Top finalized team(s) in each competition category — ties are listed together" />
        {stats.top_teams.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No team has completed all required evaluations yet.</p>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {stats.top_teams.map((t) => (
              <div key={t.competition_code} className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><OrgBadge org={t.organization} /><span className="text-sm font-semibold text-slate-800">{t.competition_label}</span></div>
                  <Trophy size={18} className="text-amber-500" />
                </div>
                {t.teams.map((m) => (
                  <div key={m.team_code} className="mt-3">
                    <p className="font-bold text-slate-900">{m.team_name} <span className="text-xs font-medium text-slate-500">#{m.team_code}</span></p>
                    <p className="text-xs text-slate-600">{m.project_name} · {m.governorate}</p>
                  </div>
                ))}
                <p className="mt-3 text-2xl font-extrabold tabular-nums text-slate-900">{formatScore(t.avg_core)}<span className="text-sm font-medium text-slate-400">/100</span>
                  <span className="ml-2 text-xs font-medium text-amber-700">bonus {formatScore(t.avg_bonus)} (separate)</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link to="/admin/teams" className="inline-flex items-center gap-1.5 font-medium text-brand-700"><ClipboardList size={16} /> Manage teams & assignments</Link>
      </div>
    </div>
  );
}
