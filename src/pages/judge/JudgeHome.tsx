import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronLeft, CircleDashed, ClipboardList, MapPin, PencilLine } from 'lucide-react';
import { fetchAssignments, fetchMyEvaluations, fetchTeams, loadReference, type Reference } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Evaluation, Organization, Team } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Alert, Badge, Card, EmptyState, PageHeader, ProgressBar, Spinner } from '@/components/ui';

const ORG_INFO: Record<Organization, { title: string; blurb: string; cls: string; ring: string }> = {
  DEMI: { title: 'DEMI', blurb: 'Grade 4 · Grade 5', cls: 'from-demi-500 to-demi-600', ring: 'ring-demi-100' },
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
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, t, e, a] = await Promise.all([loadReference(), fetchTeams(), fetchMyEvaluations(), fetchAssignments()]);
        setRef(r);
        const mine = new Set(a.filter((x) => x.judge_id === profile?.id).map((x) => x.team_id));
        setAssigned(mine);
        setTeams(t.filter((x) => mine.has(x.id)));
        setEvals(e);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [profile?.id]);

  const levelMap = useMemo(() => new Map(ref?.levels.map((l) => [l.code, l]) ?? []), [ref]);
  const govMap = useMemo(() => new Map(ref?.governorates.map((g) => [g.code, g.name]) ?? []), [ref]);
  const evalByTeam = useMemo(() => new Map(evals.map((e) => [e.team_id, e])), [evals]);

  const teamsIn = (pred: (compCode: string, o: Organization) => boolean) =>
    teams.filter((t) => {
      const l = levelMap.get(t.level_code);
      return l && pred(l.competition_code, l.organization);
    });
  const stats = (list: Team[]) => ({
    total: list.length,
    done: list.filter((t) => evalByTeam.get(t.id)?.status === 'submitted').length,
  });

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load your assignments">{error}</Alert>;
  if (!ref) return null;

  const overall = stats(teams);
  const competition = ref.competitions.find((c) => c.code === comp);

  return (
    <div>
      <PageHeader
        breadcrumb={
          org ? (
            <button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => setParams(comp ? { org } : {})}>
              <ChevronLeft size={14} /> {comp ? `Back to ${org}` : 'All organizations'}
            </button>
          ) : 'Judge workspace'
        }
        title={competition ? `${competition.organization} · ${competition.label}` : org ? `${org} competition` : 'My evaluations'}
        subtitle={
          competition
            ? 'Select an assigned team to open its digital rubric.'
            : `${overall.done} of ${overall.total} assigned evaluations submitted`
        }
      />

      {assigned.size === 0 && (
        <Card>
          <EmptyState icon={<ClipboardList />} title="No teams assigned yet">
            An administrator will assign teams to you. They will appear here automatically when you reload.
          </EmptyState>
        </Card>
      )}

      {assigned.size > 0 && !org && (
        <div className="grid gap-5 md:grid-cols-2">
          {(['DEMI', 'DECI'] as Organization[]).map((o) => {
            const s = stats(teamsIn((_, oo) => oo === o));
            return (
              <button
                key={o}
                onClick={() => setParams({ org: o })}
                className={clsx('group relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-left text-white shadow-lg ring-4 transition hover:-translate-y-0.5 hover:shadow-xl', ORG_INFO[o].cls, ORG_INFO[o].ring)}
              >
                <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border-[18px] border-white/15" aria-hidden />
                <span className={clsx('pointer-events-none absolute right-16 top-6 h-3 w-3 rounded-full', o === 'DEMI' ? 'bg-amber-300' : 'bg-orange-500')} aria-hidden />
                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-4xl font-semibold tracking-tight">{ORG_INFO[o].title}</p>
                    <p className="mt-1 text-sm text-white/80">{ORG_INFO[o].blurb}</p>
                  </div>
                  <ArrowRight className="h-6 w-6 opacity-70 transition group-hover:translate-x-1" />
                </div>
                <div className="relative mt-8">
                  <div className="mb-1.5 flex justify-between text-sm font-medium">
                    <span>{s.total} assigned team{s.total === 1 ? '' : 's'}</span>
                    <span>{s.done} submitted</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/25">
                    <div className="h-full rounded-full bg-white" style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {org && !comp && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ref.competitions.filter((c) => c.organization === org).map((c) => {
            const s = stats(teamsIn((cc) => cc === c.code));
            return (
              <button
                key={c.code}
                disabled={s.total === 0}
                onClick={() => setParams({ org, c: c.code })}
                className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-card transition hover:border-brand-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-slate-200"
              >
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-slate-900">{c.label}</p>
                  {s.total > 0 && <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" />}
                </div>
                <p className="mt-1 text-sm text-slate-500">{s.total === 0 ? 'No assigned teams' : `${s.done}/${s.total} submitted`}</p>
                {s.total > 0 && <ProgressBar className="mt-4" value={s.done} max={s.total} tone={s.done === s.total ? 'green' : 'blue'} />}
              </button>
            );
          })}
        </div>
      )}

      {org && comp && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teamsIn((cc) => cc === comp).map((t) => {
            const e = evalByTeam.get(t.id);
            const level = levelMap.get(t.level_code);
            const status = !e ? 'new' : e.status;
            return (
              <Link
                key={t.id}
                to={`/evaluate/${t.id}`}
                className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team {t.team_code}</p>
                    <p className="mt-0.5 truncate text-base font-bold text-slate-900">{t.name}</p>
                    <p className="truncate text-sm text-slate-600">{t.project_name}</p>
                  </div>
                  {status === 'submitted' ? (
                    <Badge tone="green"><CheckCircle2 size={12} /> Submitted</Badge>
                  ) : status === 'draft' ? (
                    <Badge tone="amber"><PencilLine size={12} /> Draft</Badge>
                  ) : (
                    <Badge><CircleDashed size={12} /> Not started</Badge>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><MapPin size={12} /> {govMap.get(t.governorate_code)}</span>
                  <span>· {level?.label}</span>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <ProgressBar value={e?.core_scored_count ?? 0} max={e?.core_criteria_count || 20} tone={status === 'submitted' ? 'green' : 'blue'} />
                  <span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-600">
                    {e ? `${e.core_scored_count}/${e.core_criteria_count}` : '0'} rows
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                  <span className="font-semibold tabular-nums text-slate-900">
                    {e ? <>{e.core_total}<span className="font-normal text-slate-400">/100</span>{e.bonus_total > 0 && <span className="ml-2 text-xs font-medium text-amber-700">+{e.bonus_total} bonus</span>}</> : '—'}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-brand-700">
                    {status === 'submitted' ? 'View' : status === 'draft' ? 'Continue' : 'Start'}
                    <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
