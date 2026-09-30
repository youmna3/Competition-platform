import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, ChevronLeft, CircleDashed, ClipboardList, MapPin, PencilLine } from 'lucide-react';
import { fetchEvaluationsForTeams, fetchJudgeAssignmentPage, fetchJudgeDashboardSummary, loadReference, type JudgeDashboardSummary, type Reference } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Evaluation, Organization, Team } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Alert, Badge, Card, EmptyState, PageHeader, ProgressBar, Spinner } from '@/components/ui';
import Pagination from '@/components/Pagination';

const ORG_INFO: Record<Organization, { title: string; blurb: string; cls: string; ring: string }> = {
  DEMI: { title: 'DEMI', blurb: 'Grade 4 · Grade 5 · Grade 6', cls: 'from-demi-500 to-demi-600', ring: 'ring-demi-100' },
  DECI: { title: 'DECI', blurb: 'Level 1 · Level 2 · Level 3 · Levels 4 & 5', cls: 'from-deci-500 to-deci-700', ring: 'ring-deci-100' },
};

export default function JudgeHome() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const org = params.get('org') as Organization | null;
  const comp = params.get('c');
  const [ref, setRef] = useState<Reference | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [summary, setSummary] = useState<JudgeDashboardSummary>({ total: 0, submitted: 0, groups: [] });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, summaryResult, teamPage] = await Promise.all([loadReference(), fetchJudgeDashboardSummary(), comp ? fetchJudgeAssignmentPage({ competition: comp }, page, pageSize) : Promise.resolve({ rows: [], total: 0 })]);
        const e = await fetchEvaluationsForTeams(teamPage.rows.map((team) => team.id));
        setRef(r);
        setSummary(summaryResult); setTotal(teamPage.total);
        setTeams(teamPage.rows);
        setEvals(e);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [profile?.id, comp, page, pageSize]);

  const levelMap = useMemo(() => new Map(ref?.levels.map((l) => [l.code, l]) ?? []), [ref]);
  const govMap = useMemo(() => new Map(ref?.governorates.map((g) => [g.code, g.name]) ?? []), [ref]);
  const evalByTeam = useMemo(() => new Map(evals.map((e) => [e.team_id, e])), [evals]);

  const teamsIn = (pred: (compCode: string, o: Organization) => boolean) =>
    teams.filter((t) => {
      const l = levelMap.get(t.level_code);
      return l && pred(l.competition_code, l.organization);
    });
  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load your assignments">{error}</Alert>;
  if (!ref) return null;

  const overall = { total: summary.total, done: summary.submitted };
  const competition = ref.competitions.find((c) => c.code === comp);
  const competitionRubrics = comp
    ? Array.from(new Map(teamsIn((code) => code === comp).filter((team) => Boolean(team.template_id)).map((team) => [team.template_id as string, team])).values())
    : [];

  return (
    <div>
      <PageHeader
        breadcrumb={org ? <button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => setParams(comp ? { org } : {})}><ChevronLeft size={14} /> {comp ? `Back to ${org}` : 'All organizations'}</button> : 'Judge workspace'}
        title={competition ? `${competition.organization} · ${competition.label}` : org ? `${org} competition` : 'My evaluations'}
        subtitle={competition ? 'Select an assigned team to open its digital rubric.' : `${overall.done} of ${overall.total} assigned evaluations submitted`}
        actions={competitionRubrics.length > 0 ? <div className="flex flex-wrap gap-2">{competitionRubrics.map((team) => <Link key={team.template_id} to={`/rubrics/${team.template_id}/preview`} className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-brand-600 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"><BookOpen size={16} /> View Rubric{competitionRubrics.length > 1 ? ` (${team.team_code})` : ''}</Link>)}</div> : undefined}
      />

      {summary.total === 0 && <Card><EmptyState icon={<ClipboardList />} title="No teams assigned yet">An administrator will assign teams to you. They will appear here automatically when you reload.</EmptyState></Card>}

      {summary.total > 0 && !org && <div className="grid gap-5 md:grid-cols-2">{(['DEMI', 'DECI'] as Organization[]).map((organization) => {
        const groups=summary.groups.filter(group=>group.organization===organization);const orgSummary={total:groups.reduce((n,g)=>n+g.total,0),done:groups.reduce((n,g)=>n+g.submitted,0)};
        return <button key={organization} onClick={() => setParams({ org: organization })} className={clsx('group relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-left text-white shadow-lg ring-4 transition hover:-translate-y-0.5 hover:shadow-xl', ORG_INFO[organization].cls, ORG_INFO[organization].ring)}>
          <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border-[18px] border-white/15" aria-hidden />
          <span className={clsx('pointer-events-none absolute right-16 top-6 h-3 w-3 rounded-full', organization === 'DEMI' ? 'bg-amber-300' : 'bg-orange-500')} aria-hidden />
          <div className="relative flex items-start justify-between"><div><p className="text-4xl font-semibold tracking-tight">{ORG_INFO[organization].title}</p><p className="mt-1 text-sm text-white/80">{ORG_INFO[organization].blurb}</p></div><ArrowRight className="h-6 w-6 opacity-70 transition group-hover:translate-x-1" /></div>
          <div className="relative mt-8"><div className="mb-1.5 flex justify-between text-sm font-medium"><span>{orgSummary.total} assigned team{orgSummary.total === 1 ? '' : 's'}</span><span>{orgSummary.done} submitted</span></div><div className="h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white" style={{ width: `${orgSummary.total ? (orgSummary.done / orgSummary.total) * 100 : 0}%` }} /></div></div>
        </button>;
      })}</div>}

      {org && !comp && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ref.competitions.filter((item) => item.organization === org).map((item) => {
        const group=summary.groups.find(value=>value.competition_code===item.code);const competitionSummary={total:group?.total??0,done:group?.submitted??0};
        return <button key={item.code} disabled={competitionSummary.total === 0} onClick={() => {setPage(1);setParams({ org, c: item.code })}} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-card transition hover:border-brand-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-slate-200">
          <div className="flex items-center justify-between"><p className="text-lg font-bold text-slate-900">{item.label}</p>{competitionSummary.total > 0 && <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" />}</div>
          <p className="mt-1 text-sm text-slate-500">{competitionSummary.total === 0 ? 'No assigned teams' : `${competitionSummary.done}/${competitionSummary.total} submitted`}</p>
          {competitionSummary.total > 0 && <ProgressBar className="mt-4" value={competitionSummary.done} max={competitionSummary.total} tone={competitionSummary.done === competitionSummary.total ? 'green' : 'blue'} />}
        </button>;
      })}</div>}

      {org && comp && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{teamsIn((code) => code === comp).map((team) => {
        const evaluation = evalByTeam.get(team.id);
        const level = levelMap.get(team.level_code);
        const status = !evaluation ? 'new' : evaluation.status;
        return <Link key={team.id} to={`/evaluate/${team.id}`} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition hover:border-brand-300 hover:shadow-md">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team {team.team_code}</p><p className="mt-0.5 truncate text-base font-bold text-slate-900">{team.name}</p><p className="truncate text-sm text-slate-600">{team.project_name}</p></div>{status === 'submitted' ? <Badge tone="green"><CheckCircle2 size={12} /> Submitted</Badge> : status === 'draft' ? <Badge tone="amber"><PencilLine size={12} /> Draft</Badge> : <Badge><CircleDashed size={12} /> Not started</Badge>}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><MapPin size={12} /> {govMap.get(team.governorate_code)}</span><span>· {level?.label}</span></div>
          <div className="mt-4 flex items-center gap-3"><ProgressBar value={evaluation?.core_scored_count ?? 0} max={evaluation?.core_criteria_count || 20} tone={status === 'submitted' ? 'green' : 'blue'} /><span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-600">{evaluation ? `${evaluation.core_scored_count}/${evaluation.core_criteria_count}` : '0'} rows</span></div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm"><span className="font-semibold tabular-nums text-slate-900">{evaluation ? <>{evaluation.core_total}<span className="font-normal text-slate-400">/100</span>{evaluation.bonus_total > 0 && <span className="ml-2 text-xs font-medium text-amber-700">+{evaluation.bonus_total} bonus</span>}</> : '—'}</span><span className="inline-flex items-center gap-1 font-medium text-brand-700">{status === 'submitted' ? 'View' : status === 'draft' ? 'Continue' : 'Start'}<ArrowRight size={14} className="transition group-hover:translate-x-0.5" /></span></div>
        </Link>;
      })}</div>}
      {org&&comp&&<Card className="mt-4"><Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1)}}/></Card>}
    </div>
  );
}
