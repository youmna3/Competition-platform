import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, Upload, UserPlus, UsersRound } from 'lucide-react';
import {
  deleteTeam, fetchAssignments, fetchProfiles, fetchTeamResults, fetchTeams, loadReference, saveTeam, setTeamJudges, type Reference,
} from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Organization, Profile, Team, TeamJudge, TeamResult } from '@/lib/types';
import JudgePicker from '@/components/JudgePicker';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, OrgBadge, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import ImportTeamsModal from './ImportTeamsModal';

interface Draft { id?: string; team_code: string; name: string; project_name: string; organization: Organization | ''; level_code: string; governorate_code: string; judges: Set<string> }

export default function TeamsPage() {
  const toast = useToast();
  const [ref, setRef] = useState<Reference | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assign, setAssign] = useState<TeamJudge[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [results, setResults] = useState<Map<string, TeamResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [fOrg, setFOrg] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [fGov, setFGov] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkJudges, setBulkJudges] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, t, a, p, res] = await Promise.all([loadReference(), fetchTeams(), fetchAssignments(), fetchProfiles(), fetchTeamResults()]);
      setRef(r); setTeams(t); setAssign(a); setProfiles(p);
      setResults(new Map(res.map((x) => [x.team_id, x])));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const levelMap = useMemo(() => new Map(ref?.levels.map((l) => [l.code, l]) ?? []), [ref]);
  const govMap = useMemo(() => new Map(ref?.governorates.map((g) => [g.code, g.name]) ?? []), [ref]);
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const approvedJudges = useMemo(() => profiles.filter((p) => p.status === 'approved'), [profiles]);
  const judgesByTeam = useMemo(() => {
    const m = new Map<string, string[]>();
    assign.forEach((a) => m.set(a.team_id, [...(m.get(a.team_id) ?? []), a.judge_id]));
    return m;
  }, [assign]);
  const teamCount = useMemo(() => {
    const m = new Map<string, number>();
    assign.forEach((a) => m.set(a.judge_id, (m.get(a.judge_id) ?? 0) + 1));
    return m;
  }, [assign]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return teams.filter((t) => {
      const l = levelMap.get(t.level_code);
      const r = results.get(t.id);
      if (fOrg && l?.organization !== fOrg) return false;
      if (fLevel && t.level_code !== fLevel) return false;
      if (fGov && t.governorate_code !== fGov) return false;
      if (fStatus === 'unassigned' && (r?.judges_required ?? 0) > 0) return false;
      if (fStatus === 'pending' && (!r || r.is_complete || r.judges_required === 0)) return false;
      if (fStatus === 'complete' && !r?.is_complete) return false;
      if (s && ![t.team_code, t.name, t.project_name].some((x) => x.toLowerCase().includes(s))) return false;
      return true;
    });
  }, [teams, q, fOrg, fLevel, fGov, fStatus, levelMap, results]);

  const openNew = () => {
    setDraftError(null);
    setDraft({ team_code: '', name: '', project_name: '', organization: '', level_code: '', governorate_code: '', judges: new Set() });
  };
  const openEdit = (t: Team) => {
    setDraftError(null);
    setDraft({ ...t, organization: levelMap.get(t.level_code)?.organization ?? '', judges: new Set(judgesByTeam.get(t.id) ?? []) });
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.team_code.trim() || !draft.name.trim() || !draft.project_name.trim() || !draft.level_code || !draft.governorate_code) {
      setDraftError('Please complete all required fields.');
      return;
    }
    setSaving(true);
    setDraftError(null);
    try {
      const t = await saveTeam({ ...draft, id: draft.id });
      await setTeamJudges(t.id, [...draft.judges]);
      toast('success', draft.id ? 'Team updated' : 'Team registered');
      setDraft(null);
      await load();
    } catch (e) {
      const msg = errorMessage(e);
      setDraftError(/duplicate key/i.test(msg) ? `Team ID "${draft.team_code}" is already registered.` : msg);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteTeam(confirmDelete.id);
      toast('success', 'Team deleted');
      setConfirmDelete(null);
      await load();
    } catch (e) {
      const msg = errorMessage(e);
      toast('error', /foreign key|violates/i.test(msg) ? 'This team already has evaluations and cannot be deleted. Remove assignments instead.' : msg);
    }
  };

  const doBulkAssign = async () => {
    setSaving(true);
    try {
      for (const id of selected) {
        const current = new Set(judgesByTeam.get(id) ?? []);
        bulkJudges.forEach((j) => current.add(j));
        await setTeamJudges(id, [...current]);
      }
      toast('success', `Judges added to ${selected.size} team${selected.size === 1 ? '' : 's'}`);
      setBulkOpen(false);
      setBulkJudges(new Set());
      setSelected(new Set());
      await load();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load teams">{error}</Alert>;
  if (!ref) return null;

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle={`${teams.length} registered teams · assign one or more judges to each team`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={16} /> Import CSV / Excel</Button>
            <Button onClick={openNew}><Plus size={16} /> Register team</Button>
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-8" placeholder="Search ID, team or project" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={fOrg} onChange={(e) => { setFOrg(e.target.value); setFLevel(''); }}>
            <option value="">All organizations</option><option>DEMI</option><option>DECI</option>
          </Select>
          <Select value={fLevel} onChange={(e) => setFLevel(e.target.value)}>
            <option value="">All grades / levels</option>
            {ref.levels.filter((l) => !fOrg || l.organization === fOrg).map((l) => <option key={l.code} value={l.code}>{l.organization} {l.label}</option>)}
          </Select>
          <Select value={fGov} onChange={(e) => setFGov(e.target.value)}>
            <option value="">All governorates</option>
            {ref.governorates.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
          </Select>
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Any status</option><option value="unassigned">No judges</option><option value="pending">Pending</option><option value="complete">Finalized</option>
          </Select>
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-900">
          <span>{selected.size} team{selected.size === 1 ? '' : 's'} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" onClick={() => setBulkOpen(true)}><UserPlus size={14} /> Add judges</Button>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={<UsersRound />} title={teams.length ? 'No teams match the filters' : 'No teams registered yet'} action={!teams.length && <Button onClick={openNew}><Plus size={16} /> Register team</Button>}>
            {!teams.length && 'Register teams one by one or import a CSV / Excel file.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)))} />
                  </th>
                  <th className="px-3 py-3">Team ID</th>
                  <th className="px-3 py-3">Team / Project</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Governorate</th>
                  <th className="px-3 py-3">Assigned judges</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((t) => {
                  const l = levelMap.get(t.level_code);
                  const r = results.get(t.id);
                  const judges = judgesByTeam.get(t.id) ?? [];
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <input type="checkbox" aria-label={`Select ${t.team_code}`} className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={selected.has(t.id)}
                          onChange={() => { const n = new Set(selected); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setSelected(n); }} />
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-semibold text-slate-700">{t.team_code}</td>
                      <td className="px-3 py-3"><p className="font-semibold text-slate-900">{t.name}</p><p className="text-xs text-slate-500">{t.project_name}</p></td>
                      <td className="px-3 py-3"><div className="flex items-center gap-1.5">{l && <OrgBadge org={l.organization} />}<span className="text-slate-700">{l?.label}</span></div></td>
                      <td className="px-3 py-3 text-slate-700">{govMap.get(t.governorate_code)}</td>
                      <td className="px-3 py-3">
                        {judges.length === 0 ? <span className="text-xs text-rose-600">None</span> : (
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {judges.map((j) => <Badge key={j} tone="slate">{profileMap.get(j)?.full_name || profileMap.get(j)?.email || 'Unknown'}</Badge>)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {!r || r.judges_required === 0 ? <Badge tone="red">Unassigned</Badge>
                          : r.is_complete ? <Badge tone="green">Final {r.judges_submitted}/{r.judges_required}</Badge>
                          : <Badge tone="amber">Pending {r.judges_submitted}/{r.judges_required}</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(t)} title="Edit team & judges"><Pencil size={14} /> Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(t)} title="Delete team" aria-label="Delete team"><Trash2 size={14} className="text-rose-600" /></Button>
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

      {/* add / edit */}
      <Modal
        open={!!draft}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id ? `Edit team ${draft.team_code}` : 'Register team'}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button><Button onClick={saveDraft} loading={saving}>Save team</Button></>}
      >
        {draft && (
          <div className="space-y-4">
            {draftError && <Alert tone="error">{draftError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unique team ID" required hint="Used to identify the team in results and imports">
                <Input value={draft.team_code} maxLength={40} onChange={(e) => setDraft({ ...draft, team_code: e.target.value })} />
              </Field>
              <Field label="Team name" required>
                <Input value={draft.name} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Project name" required>
                <Input value={draft.project_name} maxLength={200} onChange={(e) => setDraft({ ...draft, project_name: e.target.value })} />
              </Field>
              <Field label="Governorate" required>
                <Select value={draft.governorate_code} onChange={(e) => setDraft({ ...draft, governorate_code: e.target.value })}>
                  <option value="">Select…</option>
                  {ref.governorates.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
                </Select>
              </Field>
              <Field label="Organization" required>
                <Select value={draft.organization} onChange={(e) => setDraft({ ...draft, organization: e.target.value as Organization, level_code: '' })}>
                  <option value="">Select…</option><option>DEMI</option><option>DECI</option>
                </Select>
              </Field>
              <Field label="Grade or level" required hint={draft.level_code === 'L4' || draft.level_code === 'L5' ? 'Uses the shared DECI Levels 4 & 5 rubric; actual level is kept for filtering' : undefined}>
                <Select value={draft.level_code} disabled={!draft.organization} onChange={(e) => setDraft({ ...draft, level_code: e.target.value })}>
                  <option value="">Select…</option>
                  {ref.levels.filter((l) => l.organization === draft.organization).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </Select>
              </Field>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Assigned judge(s)</p>
              <JudgePicker judges={approvedJudges} selected={draft.judges} counts={teamCount} onChange={(judges) => setDraft({ ...draft, judges })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => !saving && setBulkOpen(false)}
        title={`Add judges to ${selected.size} team${selected.size === 1 ? '' : 's'}`}
        footer={<><Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={saving}>Cancel</Button><Button onClick={doBulkAssign} loading={saving} disabled={bulkJudges.size === 0}>Add judges</Button></>}
      >
        <p className="mb-3 text-sm text-slate-600">Selected judges are added to each team; existing assignments are kept.</p>
        <JudgePicker judges={approvedJudges} selected={bulkJudges} counts={teamCount} onChange={setBulkJudges} />
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete team?"
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={doDelete}>Delete</Button></>}
      >
        <p className="text-sm text-slate-600">
          Delete <strong>{confirmDelete?.name}</strong> (#{confirmDelete?.team_code})? Teams that already have evaluations are protected and cannot be deleted.
        </p>
      </Modal>

      <ImportTeamsModal open={importOpen} onClose={() => setImportOpen(false)} reference={ref} judges={approvedJudges} onImported={load} />
    </div>
  );
}
