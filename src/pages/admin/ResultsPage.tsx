import clsx from 'clsx';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, ExternalLink, Search } from 'lucide-react';
import { fetchAdminPage, fetchAssignmentsForTeams, fetchEvaluationsForTeams, fetchProfiles, loadReference, subscribeToResults, type Reference } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Evaluation, Profile, TeamJudge, TeamResult } from '@/lib/types';
import { Alert, Badge, Button, Card, EmptyState, Input, OrgBadge, PageHeader, Select, Spinner, formatDate, formatScore } from '@/components/ui';
import { useFullExport } from './useFullExport';
import Pagination from '@/components/Pagination';

export default function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const judgeFilter = params.get('judge') ?? '';
  const [ref, setRef] = useState<Reference | null>(null);
  const [results, setResults] = useState<TeamResult[]>([]);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [assign, setAssign] = useState<TeamJudge[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [fComp, setFComp] = useState('');
  const [fGov, setFGov] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[total,setTotal]=useState(0);
  const { exporting, runExport } = useFullExport();

  const load = useCallback(async () => {
    try {
      const [r,res,p]=await Promise.all([loadReference(),fetchAdminPage<TeamResult>('results',{search:q,competition:fComp,governorate:fGov,status:fStatus,judge:judgeFilter},page,pageSize),fetchProfiles()]);
      const ids=res.rows.map(row=>row.team_id);const[e,a]=await Promise.all([fetchEvaluationsForTeams(ids),fetchAssignmentsForTeams(ids)]);
      setRef(r);setResults(res.rows.map(row=>({...row,avg_core:row.avg_core===null?null:Number(row.avg_core),avg_bonus:row.avg_bonus===null?null:Number(row.avg_bonus),provisional_core:row.provisional_core===null?null:Number(row.provisional_core),provisional_bonus:row.provisional_bonus===null?null:Number(row.provisional_bonus)})));setTotal(res.total);setEvals(e);setAssign(a);setProfiles(p);setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [q,fComp,fGov,fStatus,judgeFilter,page,pageSize]);
  useEffect(() => {
    void load();
    const unsub = subscribeToResults(() => void load());
    return unsub;
  }, [load]);
  useEffect(() => { setPage(1); }, [q, fComp, fGov, fStatus, judgeFilter]);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const evalsByTeam = useMemo(() => {
    const m = new Map<string, Evaluation[]>();
    evals.forEach((e) => m.set(e.team_id, [...(m.get(e.team_id) ?? []), e]));
    return m;
  }, [evals]);
  const assignedByTeam = useMemo(() => {
    const m = new Map<string, Set<string>>();
    assign.forEach((a) => { if (!m.has(a.team_id)) m.set(a.team_id, new Set()); m.get(a.team_id)!.add(a.judge_id); });
    return m;
  }, [assign]);

  const filtered = results;

  const toggle = (id: string) => {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setOpen(n);
  };

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load evaluations">{error}</Alert>;

  const judgeName = judgeFilter ? profileMap.get(judgeFilter)?.full_name || profileMap.get(judgeFilter)?.email : null;

  return (
    <div>
      <PageHeader
        title="Evaluations & results"
        subtitle="Every judge's submission is stored separately. Official scores are the mean of all assigned judges' submitted core scores."
        actions={<Button onClick={runExport} loading={exporting}><Download size={16} /> Export all results</Button>}
      />

      {judgeName && (
        <Alert tone="info" className="mb-4">
          Showing teams assigned to <strong>{judgeName}</strong>. <button className="font-semibold underline" onClick={() => setParams({})}>Show all</button>
        </Alert>
      )}

      <Card className="mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-8" placeholder="Search team ID, name or project" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={fComp} onChange={(e) => setFComp(e.target.value)}>
            <option value="">All categories</option>
            {ref?.competitions.map((c) => <option key={c.code} value={c.code}>{c.organization} {c.label}</option>)}
          </Select>
          <Select value={fGov} onChange={(e) => setFGov(e.target.value)}>
            <option value="">All governorates</option>
            {ref?.governorates.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
          </Select>
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Any status</option><option value="complete">Finalized</option><option value="pending">Pending</option><option value="unassigned">No judges</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState title="No teams match" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-8 px-3 py-3" />
                  <th className="px-3 py-3">Team</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Governorate</th>
                  <th className="px-3 py-3">Judges</th>
                  <th className="px-3 py-3 text-right">Official avg</th>
                  <th className="px-3 py-3 text-right">Avg bonus</th>
                  <th className="px-5 py-3 text-right">Provisional</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => {
                  const teamEvals = evalsByTeam.get(r.team_id) ?? [];
                  const assigned = assignedByTeam.get(r.team_id) ?? new Set<string>();
                  const judgeIds = [...new Set([...assigned, ...teamEvals.map((e) => e.judge_id)])];
                  const isOpen = open.has(r.team_id);
                  return (
                    <Fragment key={r.team_id}>
                      <tr className={clsx('cursor-pointer hover:bg-slate-50', isOpen && 'bg-slate-50')} onClick={() => toggle(r.team_id)}>
                        <td className="px-3 py-3 text-slate-400">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td className="px-3 py-3"><p className="font-semibold text-slate-900">{r.team_name}</p><p className="text-xs text-slate-500">#{r.team_code} · {r.project_name}</p></td>
                        <td className="px-3 py-3"><div className="flex items-center gap-1.5"><OrgBadge org={r.organization} /><span>{r.level_label}</span></div></td>
                        <td className="px-3 py-3">{r.governorate_name}</td>
                        <td className="px-3 py-3">
                          {r.judges_required === 0 ? <Badge tone="red">None assigned</Badge>
                            : <Badge tone={r.is_complete ? 'green' : 'amber'}>{r.judges_submitted}/{r.judges_required} submitted</Badge>}
                        </td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums">{r.is_complete ? formatScore(r.avg_core) : <span className="text-xs font-medium text-amber-700">Pending</span>}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">{r.is_complete ? formatScore(r.avg_bonus) : '—'}</td>
                        <td className="px-5 py-3 text-right text-xs tabular-nums text-slate-400">{!r.is_complete && r.provisional_core !== null ? `${formatScore(r.provisional_core)} (not official)` : ''}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={7} className="px-3 pb-4">
                            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
                                  <tr><th className="px-3 py-2">Judge</th><th className="px-3 py-2">Entered team / project</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Core</th><th className="px-3 py-2 text-right">Bonus</th><th className="px-3 py-2">Rows</th><th className="px-3 py-2">Submitted</th><th className="px-3 py-2" /></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {judgeIds.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-500">No judges assigned.</td></tr>}
                                  {judgeIds.map((jid) => {
                                    const e = teamEvals.find((x) => x.judge_id === jid);
                                    const p = profileMap.get(jid);
                                    const isAssigned = assigned.has(jid);
                                    return (
                                      <tr key={jid}>
                                        <td className="px-3 py-2"><p className="font-medium text-slate-900">{p?.full_name || p?.email}</p><p className="text-slate-500">{p?.email}</p>
                                          {!isAssigned && <Badge tone="slate" className="mt-1">No longer assigned — not counted</Badge>}</td>
                                        <td className="px-3 py-2"><p className="font-medium text-slate-900">{e?.entered_team_name||'—'}</p><p className="text-slate-500">{e?.entered_project_name||'—'}</p></td>
                                        <td className="px-3 py-2">{!e ? <Badge>Not started</Badge> : e.status === 'submitted' ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">Draft</Badge>}{e && e.reopened_count > 0 && <span className="ml-1 text-slate-400">reopened ×{e.reopened_count}</span>}</td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{e ? `${e.core_total}/100` : '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{e ? e.bonus_total : '—'}</td>
                                        <td className="px-3 py-2 tabular-nums">{e ? `${e.core_scored_count}/${e.core_criteria_count}` : '—'}</td>
                                        <td className="px-3 py-2">{formatDate(e?.submitted_at)}</td>
                                        <td className="px-3 py-2 text-right">{e && <Link to={`/admin/evaluations/${e.id}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" onClick={(ev) => ev.stopPropagation()}>Open <ExternalLink size={12} /></Link>}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1)}}/>
      </Card>
    </div>
  );
}
