import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock3, ListChecks, RefreshCw, Search, Users } from 'lucide-react';
import { fetchAllEvaluations, fetchAssignments, fetchProfiles, fetchTeams, loadReference, subscribeToResults, type Reference } from '@/lib/api';
import { buildJudgeProgress, type JudgeProgressAssignment, type JudgeProgressStatus, type JudgeProgressSummary } from '@/lib/judgeProgress';
import { errorMessage } from '@/lib/supabase';
import type { Evaluation, Profile, Team, TeamJudge } from '@/lib/types';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, OrgBadge, PageHeader, ProgressBar, Select, Spinner, StatCard, formatDate } from '@/components/ui';

const STATUS_LABEL: Record<JudgeProgressStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  submitted: 'Submitted',
};

function StatusBadge({ status }: { status: JudgeProgressStatus }) {
  return <Badge tone={status === 'submitted' ? 'green' : status === 'in_progress' ? 'amber' : 'slate'}>{STATUS_LABEL[status]}</Badge>;
}

function summarize(summary: JudgeProgressSummary, assignments: JudgeProgressAssignment[]): JudgeProgressSummary {
  const completed = assignments.filter((row) => row.status === 'submitted').length;
  const inProgress = assignments.filter((row) => row.status === 'in_progress').length;
  const notStarted = assignments.filter((row) => row.status === 'not_started').length;
  return {
    ...summary,
    assignments,
    organizations: [...new Set(assignments.map((row) => row.team.organization))].sort(),
    assigned: assignments.length,
    completed,
    inProgress,
    notStarted,
    completionPercentage: assignments.length ? Math.round((completed / assignments.length) * 100) : 0,
  };
}

export default function JudgeProgressPage() {
  const [reference, setReference] = useState<Reference | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignments, setAssignments] = useState<TeamJudge[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJudge, setSelectedJudge] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [organization, setOrganization] = useState('');
  const [level, setLevel] = useState('');
  const [governorate, setGovernorate] = useState('');
  const [judge, setJudge] = useState('');
  const [status, setStatus] = useState<JudgeProgressStatus | ''>('');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [nextProfiles, nextTeams, nextAssignments, nextEvaluations, nextReference] = await Promise.all([
        fetchProfiles(), fetchTeams(), fetchAssignments(), fetchAllEvaluations(), loadReference(true),
      ]);
      setProfiles(nextProfiles);
      setTeams(nextTeams);
      setAssignments(nextAssignments);
      setEvaluations(nextEvaluations);
      setReference(nextReference);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToResults(() => void load(true));
    const poll = window.setInterval(() => void load(true), 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [load]);

  const progress = useMemo(() => buildJudgeProgress(profiles, assignments, teams, evaluations), [profiles, assignments, teams, evaluations]);
  const activeJudges = useMemo(() => progress.map((row) => row.judge), [progress]);
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => progress.flatMap((summary) => {
    if (judge && summary.judge.id !== judge) return [];
    const judgeMatchesSearch = !normalizedQuery || [summary.judge.full_name, summary.judge.email].some((value) => value.toLowerCase().includes(normalizedQuery));
    const matching = summary.assignments.filter((row) => {
      if (organization && row.team.organization !== organization) return false;
      if (level && row.team.level_code !== level) return false;
      if (governorate && row.team.governorate_code !== governorate) return false;
      if (status && row.status !== status) return false;
      if (!judgeMatchesSearch && normalizedQuery && ![row.team.team_code, row.team.name].some((value) => value.toLowerCase().includes(normalizedQuery))) return false;
      return true;
    });
    const assignmentFilterActive = Boolean(organization || level || governorate || status);
    if (matching.length === 0 && (assignmentFilterActive || !judgeMatchesSearch)) return [];
    return [summarize(summary, matching)];
  }), [progress, judge, normalizedQuery, organization, level, governorate, status]);

  const selected = filtered.find((row) => row.judge.id === selectedJudge) ?? progress.find((row) => row.judge.id === selectedJudge) ?? null;
  const judgesNotStarted = progress.filter((row) => row.assigned > 0 && row.completed === 0 && row.inProgress === 0).length;
  const judgesIncomplete = progress.filter((row) => row.assigned > 0 && row.completed < row.assigned).length;
  const judgesFinished = progress.filter((row) => row.assigned > 0 && row.completed === row.assigned).length;
  const teamsWaiting = new Set(progress.flatMap((row) => row.assignments.filter((assignment) => assignment.status !== 'submitted').map((assignment) => assignment.team.id))).size;

  if (loading) return <Spinner label="Loading judge progress…" />;

  return (
    <div>
      <PageHeader
        title="Judge Progress"
        subtitle="Assignment status is derived live from judge assignments and evaluations. No separate progress records are stored."
        actions={<Button variant="secondary" loading={refreshing} onClick={() => void load(true)}><RefreshCw size={16} /> Refresh</Button>}
      />

      {error && <Alert tone="error" title="Could not refresh judge progress" className="mb-4">{error}</Alert>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Not started" value={judgesNotStarted} icon={<Clock3 size={20} />} tone="slate" hint="Judges with no started assignments" />
        <StatCard label="Incomplete judges" value={judgesIncomplete} icon={<Users size={20} />} tone="amber" hint="At least one assignment outstanding" />
        <StatCard label="Finished judges" value={judgesFinished} icon={<CheckCircle2 size={20} />} tone="green" hint="All assigned evaluations submitted" />
        <StatCard label="Teams waiting" value={teamsWaiting} icon={<ListChecks size={20} />} tone="red" hint="Waiting for one or more judges" />
      </div>

      <Card className="mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative md:col-span-2 xl:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-8" aria-label="Search judge or team" placeholder="Judge name, team ID or team name" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Select aria-label="Organization" value={organization} onChange={(event) => { setOrganization(event.target.value); setLevel(''); }}>
            <option value="">All organizations</option><option value="DEMI">DEMI</option><option value="DECI">DECI</option>
          </Select>
          <Select aria-label="Grade or level" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">All grades / levels</option>
            {reference?.levels.filter((item) => !organization || item.organization === organization).map((item) => <option key={item.code} value={item.code}>{item.organization} · {item.label}</option>)}
          </Select>
          <Select aria-label="Governorate" value={governorate} onChange={(event) => setGovernorate(event.target.value)}>
            <option value="">All governorates</option>
            {reference?.governorates.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </Select>
          <Select aria-label="Evaluation status" value={status} onChange={(event) => setStatus(event.target.value as JudgeProgressStatus | '')}>
            <option value="">Any status</option><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="submitted">Submitted</option>
          </Select>
          <Select className="md:col-span-2 xl:col-span-2" aria-label="Judge" value={judge} onChange={(event) => setJudge(event.target.value)}>
            <option value="">All judges</option>
            {activeJudges.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={<Users />} title="No judges match these filters" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Judge</th><th className="px-3 py-3">Organization(s)</th><th className="px-3 py-3 text-center">Assigned</th><th className="px-3 py-3 text-center">Completed</th><th className="px-3 py-3 text-center">In progress</th><th className="px-3 py-3 text-center">Not started</th><th className="min-w-[180px] px-3 py-3">Progress</th><th className="w-10 px-3 py-3" />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => <tr key={row.judge.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3"><button className="text-left font-semibold text-brand-700 hover:underline" onClick={() => setSelectedJudge(row.judge.id)}>{row.judge.full_name || 'Unnamed judge'}</button><span className="block text-xs text-slate-500">{row.judge.email}</span></td>
                  <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{row.organizations.length ? row.organizations.map((item) => <OrgBadge key={item} org={item as 'DEMI' | 'DECI'} />) : <span className="text-slate-400">—</span>}</div></td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums">{row.assigned}</td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums text-emerald-700">{row.completed}</td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums text-amber-700">{row.inProgress}</td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums text-slate-600">{row.notStarted}</td>
                  <td className="px-3 py-3"><div className="mb-1 flex justify-between text-xs"><span>{row.completionPercentage}%</span><span className="text-slate-400">{row.completed}/{row.assigned}</span></div><ProgressBar value={row.completed} max={row.assigned} tone={row.completionPercentage === 100 && row.assigned > 0 ? 'green' : 'blue'} /></td>
                  <td className="px-3 py-3"><button aria-label={`View ${row.judge.full_name || row.judge.email} assignments`} className="rounded-full p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-700" onClick={() => setSelectedJudge(row.judge.id)}><ChevronRight size={17} /></button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelectedJudge(null)} title={selected ? `Assigned teams · ${selected.judge.full_name || selected.judge.email}` : 'Assigned teams'} size="xl">
        {!selected || selected.assignments.length === 0 ? <EmptyState title="No assigned teams in this view" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">Team ID</th><th className="px-3 py-3">Team / project</th><th className="px-3 py-3">Organization</th><th className="px-3 py-3">Grade / level</th><th className="px-3 py-3">Governorate</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last activity</th><th className="px-3 py-3">Submitted</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">{selected.assignments.map((row) => {
                const levelRow = reference?.levels.find((item) => item.code === row.team.level_code);
                const governorateRow = reference?.governorates.find((item) => item.code === row.team.governorate_code);
                return <tr key={row.team.id}>
                  <td className="px-3 py-3 font-semibold">{row.team.team_code}</td>
                  <td className="px-3 py-3"><p className="font-medium text-slate-900">{row.team.name}</p><p className="text-xs text-slate-500">{row.team.project_name}</p></td>
                  <td className="px-3 py-3"><OrgBadge org={row.team.organization} /></td>
                  <td className="px-3 py-3">{levelRow?.label ?? row.team.level_code}</td>
                  <td className="px-3 py-3">{governorateRow?.name ?? row.team.governorate_code}</td>
                  <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.evaluation?.updated_at)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.evaluation?.submitted_at)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
