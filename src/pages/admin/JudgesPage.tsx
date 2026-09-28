import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Check, RotateCcw, Search, Shield, ShieldOff, Users, X } from 'lucide-react';
import { fetchAllEvaluations, fetchAssignments, fetchProfiles, updateProfileAccess } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { AccountStatus, Evaluation, Profile, TeamJudge } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, formatDate, useToast } from '@/components/ui';

const TABS: { key: AccountStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'all', label: 'All' },
];

export default function JudgesPage() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as AccountStatus | 'all') || 'pending';
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assign, setAssign] = useState<TeamJudge[]>([]);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ p: Profile; patch: Partial<Profile>; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, a, e] = await Promise.all([fetchProfiles(), fetchAssignments(), fetchAllEvaluations()]);
      setProfiles(p); setAssign(a); setEvals(e); setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const m = new Map<string, { assigned: number; submitted: number; drafts: number }>();
    assign.forEach((a) => {
      const s = m.get(a.judge_id) ?? { assigned: 0, submitted: 0, drafts: 0 };
      s.assigned++;
      const e = evals.find((x) => x.team_id === a.team_id && x.judge_id === a.judge_id);
      if (e?.status === 'submitted') s.submitted++;
      else if (e) s.drafts++;
      m.set(a.judge_id, s);
    });
    return m;
  }, [assign, evals]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: profiles.length };
    profiles.forEach((p) => { c[p.status] = (c[p.status] ?? 0) + 1; });
    return c;
  }, [profiles]);

  const list = profiles.filter((p) => {
    if (tab !== 'all' && p.status !== tab) return false;
    const s = q.trim().toLowerCase();
    return !s || p.full_name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s);
  });

  const apply = async (p: Profile, patch: Partial<Profile>, msg: string) => {
    setBusy(p.id);
    try {
      await updateProfileAccess(p.id, patch);
      toast('success', msg);
      await load();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load accounts">{error}</Alert>;

  return (
    <div>
      <PageHeader title="Judges & accounts" subtitle="Approve new judge sign-ups, manage access and administrator roles" />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setParams({ status: t.key })}
              className={clsx('rounded-full px-3.5 py-1.5 text-sm font-medium', tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
            >
              {t.label} <span className={clsx('ml-1 text-xs', tab === t.key ? 'text-white/80' : 'text-slate-400')}>{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-8" placeholder="Search name or e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={<Users />} title="No accounts in this view" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Registered</th>
                  <th className="px-3 py-3">Evaluations</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => {
                  const s = stats.get(p.id);
                  const self = p.id === me?.id;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-900">{p.full_name || '—'} {self && <span className="text-xs font-normal text-slate-400">(you)</span>}</p>
                        <p className="text-xs text-slate-500">{p.email}</p>
                      </td>
                      <td className="px-3 py-3">{p.role === 'admin' ? <Badge tone="violet"><Shield size={12} /> Admin</Badge> : <Badge>Judge</Badge>}</td>
                      <td className="px-3 py-3">
                        <Badge tone={p.status === 'approved' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>{p.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{formatDate(p.created_at)}</td>
                      <td className="px-3 py-3 text-xs text-slate-700">
                        {s ? (
                          <Link to={`/admin/results?judge=${p.id}`} className="hover:underline">
                            <span className="font-semibold text-emerald-700">{s.submitted}</span> submitted · {s.drafts} draft · {s.assigned - s.submitted - s.drafts} not started
                            <span className="block text-slate-400">{s.assigned} assigned teams</span>
                          </Link>
                        ) : <span className="text-slate-400">No assignments</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {p.status === 'pending' && (
                            <>
                              <Button size="sm" variant="success" loading={busy === p.id} onClick={() => void apply(p, { status: 'approved' }, `${p.email} approved`)}><Check size={14} /> Approve</Button>
                              <Button size="sm" variant="secondary" onClick={() => setConfirm({ p, patch: { status: 'rejected' }, label: 'Reject this sign-up?' })}><X size={14} /> Reject</Button>
                            </>
                          )}
                          {p.status === 'approved' && !self && (
                            <Button size="sm" variant="ghost" onClick={() => setConfirm({ p, patch: { status: 'disabled' }, label: 'Disable this account? The user immediately loses access; existing submissions are kept.' })}><Ban size={14} /> Disable</Button>
                          )}
                          {(p.status === 'rejected' || p.status === 'disabled') && (
                            <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => void apply(p, { status: 'approved' }, `${p.email} re-enabled`)}><RotateCcw size={14} /> Approve</Button>
                          )}
                          {p.status === 'approved' && p.role === 'judge' && (
                            <Button size="sm" variant="ghost" onClick={() => setConfirm({ p, patch: { role: 'admin' }, label: 'Grant administrator rights? Administrators can see every evaluation and manage all data.' })}><Shield size={14} /> Make admin</Button>
                          )}
                          {p.role === 'admin' && !self && (
                            <Button size="sm" variant="ghost" onClick={() => setConfirm({ p, patch: { role: 'judge' }, label: 'Remove administrator rights?' })}><ShieldOff size={14} /> Remove admin</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Please confirm"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" loading={busy === confirm?.p.id} onClick={() => confirm && void apply(confirm.p, confirm.patch, 'Account updated')}>Confirm</Button></>}
      >
        <p className="text-sm text-slate-700">{confirm?.label}</p>
        <p className="mt-2 text-sm font-medium text-slate-900">{confirm?.p.full_name} · {confirm?.p.email}</p>
      </Modal>
    </div>
  );
}
