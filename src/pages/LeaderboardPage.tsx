import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Eye, EyeOff, Medal, RefreshCw, Trophy } from 'lucide-react';
import { fetchLeaderboard, loadReference, setPublication, subscribeToResults, type Reference } from '@/lib/api';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Competition, LeaderboardRow, Organization } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { exportLeaderboard } from '@/lib/exportResults';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, formatDate, formatScore, useToast } from '@/components/ui';

export default function LeaderboardPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const org = (params.get('org') as Organization) || 'DEMI';
  const levelFilter = params.get('level') ?? '';
  const gov = params.get('gov') ?? '';

  const [ref, setRef] = useState<Reference | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busyComp, setBusyComp] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filters = useMemo(() => {
    const f: { organization: string; competition?: string; level?: string; governorate?: string } = { organization: org };
    if (levelFilter.startsWith('c:')) f.competition = levelFilter.slice(2);
    if (levelFilter.startsWith('l:')) f.level = levelFilter.slice(2);
    if (gov) f.governorate = gov;
    return f;
  }, [org, levelFilter, gov]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [r, lb] = await Promise.all([loadReference(true), fetchLeaderboard(filters)]);
      setRef(r);
      setRows(lb);
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // live updates: realtime signal + polling fallback
  useEffect(() => {
    const refresh = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void load(true), 600);
    };
    const unsub = subscribeToResults(refresh);
    const poll = setInterval(() => void load(true), 30000);
    return () => {
      unsub();
      clearInterval(poll);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [load]);

  // refresh the realtime auth token when signing in/out
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => void load(true));
    return () => data.subscription.unsubscribe();
  }, [load]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'org') next.delete('level');
    setParams(next, { replace: true });
  };

  const competitions = (ref?.competitions ?? []).filter((c) => c.organization === org);
  const shownComps = competitions.filter((c) => {
    if (filters.competition) return c.code === filters.competition;
    if (filters.level) return ref?.levels.find((l) => l.code === filters.level)?.competition_code === c.code;
    return true;
  });
  const visibleComps = isAdmin ? shownComps : shownComps.filter((c) => c.is_published);

  const togglePublish = async (c: Competition) => {
    setBusyComp(c.code);
    try {
      await setPublication(c.code, !c.is_published);
      toast('success', `${c.organization} ${c.label} leaderboard ${c.is_published ? 'unpublished' : 'published'}`);
      await load(true);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusyComp(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Competition Leaderboard"
        subtitle={
          <>
            Official results include only teams whose assigned judges have all submitted. Scores are the average core score out of 100; bonus points are shown separately.
            {updatedAt && <span className="ml-1 text-slate-400">Updated {updatedAt.toLocaleTimeString()}.</span>}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void load()}><RefreshCw size={16} /> Refresh</Button>
            {isAdmin && (
              <Button variant="secondary" onClick={() => void exportLeaderboard(rows, `leaderboard-${org}-${new Date().toISOString().slice(0, 10)}.xlsx`)} disabled={!rows.length}>
                <Download size={16} /> Export view
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex rounded-full bg-white p-1 shadow-card ring-1 ring-slate-200" role="tablist">
          {(['DEMI', 'DECI'] as Organization[]).map((o) => (
            <button
              key={o}
              role="tab"
              aria-selected={org === o}
              onClick={() => set('org', o)}
              className={clsx(
                'rounded-full px-7 py-2 text-sm font-semibold transition',
                org === o ? (o === 'DEMI' ? 'bg-demi-500 text-white shadow' : 'bg-deci-500 text-white shadow') : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {o}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:w-[480px]">
          <Select value={levelFilter} onChange={(e) => set('level', e.target.value)} aria-label="Grade or level">
            <option value="">All {org === 'DEMI' ? 'grades' : 'levels'}</option>
            {competitions.map((c) => (
              <option key={c.code} value={`c:${c.code}`}>{c.label}</option>
            ))}
          </Select>
          <Select value={gov} onChange={(e) => set('gov', e.target.value)} aria-label="Governorate">
            <option value="">All governorates</option>
            {ref?.governorates.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
          </Select>
        </div>
      </div>

      {error && <Alert tone="error" title="Could not load the leaderboard" className="mb-4">{error}</Alert>}
      {(filters.level || filters.governorate) && (
        <Alert tone="info" className="mb-4">
          Ranks are recalculated within the filtered view{filters.governorate ? ' for the selected governorate' : ''}.
        </Alert>
      )}

      {loading && !ref ? (
        <Spinner />
      ) : visibleComps.length === 0 ? (
        <Card>
          <EmptyState icon={<Trophy />} title="No published results yet">
            Results appear here once the competition administrators publish them.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleComps.map((c) => (
            <CompetitionBoard
              key={c.code}
              competition={c}
              rows={rows.filter((r) => r.competition_code === c.code)}
              isAdmin={isAdmin}
              showLevel={c.code === 'DECI_L45'}
              busy={busyComp === c.code}
              onTogglePublish={() => void togglePublish(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitionBoard({ competition: c, rows, isAdmin, showLevel, busy, onTogglePublish }: {
  competition: Competition; rows: LeaderboardRow[]; isAdmin: boolean; showLevel: boolean; busy: boolean; onTogglePublish: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className={clsx('flex flex-wrap items-center justify-between gap-3 px-5 py-4', c.organization === 'DEMI' ? 'bg-gradient-to-r from-demi-500 to-demi-600' : 'bg-gradient-to-r from-deci-500 to-deci-700')}>
        <div className="text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{c.organization}</p>
          <h2 className="text-lg font-bold">{c.label}</h2>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <Badge tone={c.is_published ? 'green' : 'amber'}>
                {c.is_published ? `Published ${formatDate(c.published_at)}` : 'Not published — admins only'}
              </Badge>
              <Button size="sm" variant="secondary" loading={busy} onClick={onTogglePublish}>
                {c.is_published ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}
              </Button>
            </>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Medal />} title="No finalized teams yet">
          Teams appear once all of their assigned judges have submitted.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-16 px-5 py-3">Rank</th>
                <th className="px-3 py-3">Team</th>
                <th className="px-3 py-3">Project</th>
                <th className="px-3 py-3">Governorate</th>
                {showLevel && <th className="px-3 py-3">Level</th>}
                <th className="px-3 py-3 text-center">Judges</th>
                <th className="px-3 py-3 text-right">Average score</th>
                <th className="px-5 py-3 text-right">Avg bonus<span className="block text-[10px] font-medium normal-case tracking-normal text-slate-400">recorded separately</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.team_id} className={clsx(r.is_top ? 'bg-amber-50/80' : 'hover:bg-slate-50')}>
                  <td className="px-5 py-3">
                    <span
                      className={clsx(
                        'inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums',
                        r.rank === 1 ? 'bg-amber-400 text-amber-950' : r.rank === 2 ? 'bg-slate-300 text-slate-800' : r.rank === 3 ? 'bg-orange-300 text-orange-950' : 'bg-slate-100 text-slate-600',
                      )}
                      title={r.is_tied ? 'Tied — no tie-break rule applied' : undefined}
                    >
                      {r.is_tied && '='}{r.rank}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {r.is_top && <Trophy size={16} className="shrink-0 text-amber-500" aria-label="Highest score in category" />}
                      <div>
                        <p className="font-semibold text-slate-900">{r.team_name}</p>
                        <p className="text-xs text-slate-500">#{r.team_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{r.project_name}</td>
                  <td className="px-3 py-3 text-slate-700">{r.governorate_name}</td>
                  {showLevel && <td className="px-3 py-3"><Badge tone="violet">{r.level_label}</Badge></td>}
                  <td className="px-3 py-3 text-center tabular-nums text-slate-700">{r.judges_submitted}/{r.judges_required}</td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-lg font-bold tabular-nums text-slate-900">{formatScore(r.avg_core)}</span>
                    <span className="text-xs text-slate-400">/100</span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-amber-700">{formatScore(r.avg_bonus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some((r) => r.is_tied) && (
            <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">“=” marks tied teams. They share a rank; no tie-breaking rule has been applied.</p>
          )}
        </div>
      )}
    </Card>
  );
}
