import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, ClipboardList, PencilLine, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchAssignments, fetchMyEvaluations, fetchTeams, loadReference, subscribeToResults, type Reference } from '@/lib/api';
import { buildJudgeAssignments, type JudgeAssignmentStatus } from '@/lib/judgeAssignments';
import { errorMessage } from '@/lib/supabase';
import type { Evaluation, Team, TeamJudge } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Alert, Badge, Button, Card, EmptyState, Input, OrgBadge, PageHeader, Select, Spinner, StatCard } from '@/components/ui';

function EvaluationStatusBadge({ status }: { status: JudgeAssignmentStatus }) {
  if (status === 'submitted') return <Badge tone="green"><CheckCircle2 size={12} /> Submitted</Badge>;
  if (status === 'in_progress') return <Badge tone="amber"><PencilLine size={12} /> In Progress</Badge>;
  return <Badge tone="slate"><CircleDashed size={12} /> Not Started</Badge>;
}

export default function AssignedTeamsPage() {
  const { profile } = useAuth();
  const [reference, setReference] = useState<Reference | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [assignments, setAssignments] = useState<TeamJudge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [organization, setOrganization] = useState('');
  const [level, setLevel] = useState('');
  const [governorate, setGovernorate] = useState('');
  const [status, setStatus] = useState<JudgeAssignmentStatus | ''>('');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [nextReference, nextTeams, nextEvaluations, nextAssignments] = await Promise.all([
        loadReference(true), fetchTeams(), fetchMyEvaluations(), fetchAssignments(),
      ]);
      setReference(nextReference); setTeams(nextTeams); setEvaluations(nextEvaluations); setAssignments(nextAssignments); setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToResults(() => void load(true));
    const poll = window.setInterval(() => void load(true), 30_000);
    return () => { unsubscribe(); window.clearInterval(poll); };
  }, [load]);

  const rows = useMemo(() => buildJudgeAssignments(profile?.id ?? '', teams, assignments, evaluations), [profile?.id, teams, assignments, evaluations]);
  const counts = useMemo(() => ({
    notStarted: rows.filter((row) => row.status === 'not_started').length,
    inProgress: rows.filter((row) => row.status === 'in_progress').length,
    submitted: rows.filter((row) => row.status === 'submitted').length,
  }), [rows]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (organization && row.team.organization !== organization) return false;
    if (level && row.team.level_code !== level) return false;
    if (governorate && row.team.governorate_code !== governorate) return false;
    if (status && row.status !== status) return false;
    return !normalizedQuery || [row.team.team_code, row.team.name, row.team.project_name].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  if (loading) return <Spinner label="Loading your assigned teams…" />;
  if (!reference) return <Alert tone="error" title="Could not load your assignments">{error ?? 'Reference data is unavailable.'}</Alert>;

  return <div>
    <PageHeader title="Assigned Teams" subtitle="Track every team assigned to you and continue each evaluation from its current status." actions={<Button variant="secondary" loading={refreshing} onClick={() => void load(true)}><RefreshCw size={16} /> Refresh</Button>} />
    {error && <Alert tone="error" title="Could not refresh your assignments" className="mb-4">{error}</Alert>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total Assigned" value={rows.length} icon={<ClipboardList size={20} />} tone="blue" />
      <StatCard label="Not Started" value={counts.notStarted} icon={<CircleDashed size={20} />} tone="slate" />
      <StatCard label="In Progress" value={counts.inProgress} icon={<PencilLine size={20} />} tone="amber" />
      <StatCard label="Submitted" value={counts.submitted} icon={<CheckCircle2 size={20} />} tone="green" />
    </div>
    <Card className="mb-4 p-3"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
      <div className="relative md:col-span-2"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="pl-8" aria-label="Search assigned teams" placeholder="Search Team ID, team name or project" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <Select aria-label="Organization" value={organization} onChange={(event) => { setOrganization(event.target.value); setLevel(''); }}><option value="">All organizations</option><option value="DEMI">DEMI</option><option value="DECI">DECI</option></Select>
      <Select aria-label="Grade or level" value={level} onChange={(event) => setLevel(event.target.value)}><option value="">All grades / levels</option>{reference.levels.filter((item) => !organization || item.organization === organization).map((item) => <option key={item.code} value={item.code}>{item.organization} · {item.label}</option>)}</Select>
      <Select aria-label="Governorate" value={governorate} onChange={(event) => setGovernorate(event.target.value)}><option value="">All governorates</option>{reference.governorates.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</Select>
      <Select aria-label="Evaluation status" value={status} onChange={(event) => setStatus(event.target.value as JudgeAssignmentStatus | '')}><option value="">Any status</option><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="submitted">Submitted</option></Select>
    </div></Card>
    <Card className="overflow-hidden">{rows.length === 0 ? <EmptyState icon={<ClipboardList />} title="No teams assigned yet">An administrator will assign teams to you. New assignments appear here automatically.</EmptyState> : filtered.length === 0 ? <EmptyState title="No assigned teams match these filters" /> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm">
      <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><th className="px-5 py-3">Team ID</th><th className="px-3 py-3">Team</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Organization</th><th className="px-3 py-3">Grade / level</th><th className="px-3 py-3">Governorate</th><th className="px-3 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{filtered.map((row) => {
        const levelRow = reference.levels.find((item) => item.code === row.team.level_code);
        const governorateRow = reference.governorates.find((item) => item.code === row.team.governorate_code);
        return <tr key={row.team.id} className="hover:bg-slate-50"><td className="px-5 py-3 font-semibold text-slate-900">{row.team.team_code}</td><td className="px-3 py-3 font-medium text-slate-900">{row.team.name}</td><td className="max-w-[260px] px-3 py-3 text-slate-600"><span className="block truncate">{row.team.project_name}</span></td><td className="px-3 py-3"><OrgBadge org={row.team.organization} /></td><td className="px-3 py-3">{levelRow?.label ?? row.team.level_code}</td><td className="px-3 py-3">{governorateRow?.name ?? row.team.governorate_code}</td><td className="px-3 py-3"><EvaluationStatusBadge status={row.status} /></td><td className="px-5 py-3 text-right"><Link to={`/evaluate/${row.team.id}`} className={`inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-semibold transition ${row.status === 'submitted' ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-brand-600 text-white hover:bg-brand-700'}`}>{row.action}</Link></td></tr>;
      })}</tbody>
    </table></div>}</Card>
  </div>;
}
