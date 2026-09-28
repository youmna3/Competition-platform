import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Check, Copy, KeyRound, MailPlus, RotateCcw, Search, Send, Shield, ShieldOff, UserCog, Users, X } from 'lucide-react';
import { fetchAllEvaluations, fetchAssignments, fetchInvitations, fetchProfiles, fetchTeams, loadReference, manageInvitation, setJudgeTeams, updateProfileAccess, type Reference } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { AccountStatus, Evaluation, InvitationStatus, Profile, Team, TeamJudge, UserInvitation } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, formatDate, useToast } from '@/components/ui';

const TABS: { key: AccountStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Invited / pending' }, { key: 'approved', label: 'Active' },
  { key: 'disabled', label: 'Disabled' }, { key: 'rejected', label: 'Rejected' }, { key: 'all', label: 'All' },
];
export const invitationStatus = (invitation: UserInvitation): InvitationStatus => invitation.status === 'pending' && new Date(invitation.expires_at).getTime() <= Date.now() ? 'expired' : invitation.status;

export default function JudgesPage() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as AccountStatus | 'all') || 'approved';
  const [profiles, setProfiles] = useState<Profile[]>([]), [assignments, setAssignments] = useState<TeamJudge[]>([]), [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]), [teams, setTeams] = useState<Team[]>([]), [reference, setReference] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [q, setQ] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ p: Profile; patch: Partial<Profile>; label: string } | null>(null);
  const [invite, setInvite] = useState<{ method: 'invite' | 'create-temporary'; fullName: string; email: string; teams: Set<string> } | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [temporaryResult, setTemporaryResult] = useState<{ email: string; password: string } | null>(null);
  const [manage, setManage] = useState<{ profile: Profile; teams: Set<string> } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, a, e, i, t, r] = await Promise.all([fetchProfiles(), fetchAssignments(), fetchAllEvaluations(), fetchInvitations(), fetchTeams(), loadReference()]);
      setProfiles(p); setAssignments(a); setEvaluations(e); setInvitations(i); setTeams(t); setReference(r); setError(null);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const map = new Map<string, { assigned: number; submitted: number; drafts: number }>();
    assignments.forEach((assignment) => {
      const value = map.get(assignment.judge_id) ?? { assigned: 0, submitted: 0, drafts: 0 }; value.assigned++;
      const evaluation = evaluations.find((item) => item.team_id === assignment.team_id && item.judge_id === assignment.judge_id);
      if (evaluation?.status === 'submitted') value.submitted++; else if (evaluation) value.drafts++;
      map.set(assignment.judge_id, value);
    }); return map;
  }, [assignments, evaluations]);
  const invitationsByUser = useMemo(() => new Map(invitations.map((item) => [item.auth_user_id, item])), [invitations]);
  const counts = useMemo(() => profiles.reduce<Record<string, number>>((result, profile) => ({ ...result, [profile.status]: (result[profile.status] ?? 0) + 1 }), { all: profiles.length }), [profiles]);
  const list = profiles.filter((profile) => (tab === 'all' || profile.status === tab) && (!q.trim() || `${profile.full_name} ${profile.email}`.toLowerCase().includes(q.trim().toLowerCase())));

  const apply = async (profile: Profile, patch: Partial<Profile>, message: string) => {
    setBusy(profile.id); try { await updateProfileAccess(profile.id, patch); toast('success', message); await load(); }
    catch (err) { toast('error', errorMessage(err)); } finally { setBusy(null); setConfirm(null); }
  };
  const createAccount = async () => {
    if (!invite || !invite.fullName.trim() || !invite.email.trim()) return;
    setBusy('create-account'); setAccountError(null); try {
      const result = await manageInvitation({ action: invite.method, fullName: invite.fullName.trim(), email: invite.email.trim(), teamIds: [...invite.teams] });
      if (invite.method === 'create-temporary') {
        setTemporaryResult({ email: invite.email.trim(), password: result.temporaryPassword as string });
        toast('success', `Account created for ${invite.email}`);
      } else toast('success', `Invitation sent to ${invite.email}`);
      setInvite(null); await load();
    } catch (err) { setAccountError(errorMessage(err)); } finally { setBusy(null); }
  };
  const invitationAction = async (item: UserInvitation, action: 'resend' | 'revoke') => {
    setBusy(item.id); try { await manageInvitation({ action, invitationId: item.id }); toast('success', action === 'resend' ? 'Invitation resent' : 'Invitation revoked'); await load(); }
    catch (err) { toast('error', errorMessage(err)); } finally { setBusy(null); }
  };
  const saveAssignments = async () => {
    if (!manage) return; setBusy(manage.profile.id);
    try { await setJudgeTeams(manage.profile.id, [...manage.teams]); toast('success', 'Team assignments updated'); setManage(null); await load(); }
    catch (err) { toast('error', errorMessage(err)); } finally { setBusy(null); }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load accounts">{error}</Alert>;
  return <div>
    <PageHeader title="Judges & accounts" subtitle="Administrators create accounts, send secure invitations and control team access" actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setAccountError(null); setInvite({ method: 'create-temporary', fullName: '', email: '', teams: new Set() }); }}><KeyRound size={16}/>Temporary password</Button><Button onClick={() => { setAccountError(null); setInvite({ method: 'invite', fullName: '', email: '', teams: new Set() }); }}><MailPlus size={16}/>Invite by email</Button></div>} />

    <Card className="mb-6 overflow-hidden">
      <div className="border-b p-4"><h2 className="font-semibold">Invitation history</h2><p className="text-xs text-slate-500">Links expire automatically; revoked links cannot be accepted.</p></div>
      {invitations.length === 0 ? <EmptyState title="No invitations sent" /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">Judge</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Sent</th><th className="px-3 py-3">Expires</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{invitations.map((item) => { const status=invitationStatus(item); return <tr key={item.id}><td className="px-4 py-3"><b>{item.full_name}</b><span className="block text-xs text-slate-500">{item.email}</span></td><td className="px-3 py-3"><Badge tone={status==='accepted'?'green':status==='revoked'?'red':status==='expired'?'amber':'blue'}>{status}</Badge></td><td className="px-3 py-3 text-xs">{formatDate(item.last_sent_at)} · {item.send_count} send{item.send_count===1?'':'s'}</td><td className="px-3 py-3 text-xs">{formatDate(item.expires_at)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{(status==='pending'||status==='expired')&&<><Button size="sm" variant="secondary" loading={busy===item.id} onClick={() => void invitationAction(item,'resend')}><Send size={13}/>Resend</Button><Button size="sm" variant="danger" onClick={() => void invitationAction(item,'revoke')}><X size={13}/>Revoke</Button></>}</div></td></tr>})}</tbody></table></div>}
    </Card>

    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="flex flex-wrap gap-1">{TABS.map((item)=><button key={item.key} onClick={()=>setParams({status:item.key})} className={clsx('rounded-full px-3.5 py-1.5 text-sm font-medium',tab===item.key?'bg-brand-600 text-white':'bg-white text-slate-600 ring-1 ring-slate-200')}>{item.label} <span className="ml-1 text-xs">{counts[item.key]??0}</span></button>)}</div><div className="relative md:w-72"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input className="pl-8" placeholder="Search name or e-mail" value={q} onChange={(event)=>setQ(event.target.value)}/></div></div>
    <Card className="overflow-hidden">{list.length===0?<EmptyState icon={<Users/>} title="No accounts in this view"/>:<div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="px-5 py-3">Name</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Access</th><th className="px-3 py-3">Onboarding</th><th className="px-3 py-3">Evaluations</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{list.map((profile)=>{const stat=stats.get(profile.id),self=profile.id===me?.id,invitation=invitationsByUser.get(profile.id);return <tr key={profile.id}><td className="px-5 py-3"><b>{profile.full_name||'—'} {self&&<small>(you)</small>}</b><span className="block text-xs text-slate-500">{profile.email}</span></td><td className="px-3 py-3"><Badge tone={profile.role==='admin'?'violet':'slate'}>{profile.role}</Badge></td><td className="px-3 py-3"><Badge tone={profile.status==='approved'?'green':profile.status==='pending'?'amber':'red'}>{profile.status}</Badge></td><td className="px-3 py-3">{profile.password_change_required?<Badge tone="amber">Password change required</Badge>:invitation?<Badge tone={invitationStatus(invitation)==='accepted'?'green':'blue'}>{invitationStatus(invitation)}</Badge>:<span className="text-xs text-slate-400">Complete</span>}</td><td className="px-3 py-3 text-xs">{stat?<Link className="hover:underline" to={`/admin/results?judge=${profile.id}`}><b>{stat.submitted}</b> submitted · {stat.drafts} draft<span className="block text-slate-400">{stat.assigned} assigned teams</span></Link>:<span className="text-slate-400">No assignments</span>}</td><td className="px-5 py-3"><div className="flex flex-wrap justify-end gap-1">{profile.role==='judge'&&<Button size="sm" variant="secondary" onClick={()=>setManage({profile,teams:new Set(assignments.filter((a)=>a.judge_id===profile.id).map((a)=>a.team_id))})}><UserCog size={13}/>Teams</Button>}{profile.status==='pending'&&!invitation&&<Button size="sm" variant="success" onClick={()=>void apply(profile,{status:'approved'},'Account activated')}><Check size={13}/>Activate</Button>}{profile.status==='approved'&&!self&&<Button size="sm" variant="ghost" onClick={()=>setConfirm({p:profile,patch:{status:'disabled'},label:'Deactivate this account immediately? Existing evaluations remain unchanged.'})}><Ban size={13}/>Deactivate</Button>}{(profile.status==='disabled'||profile.status==='rejected')&&<Button size="sm" variant="secondary" onClick={()=>void apply(profile,{status:'approved'},'Account reactivated')}><RotateCcw size={13}/>Reactivate</Button>}{profile.status==='approved'&&profile.role==='judge'&&<Button size="sm" variant="ghost" onClick={()=>setConfirm({p:profile,patch:{role:'admin'},label:'Grant administrator access?'})}><Shield size={13}/>Make admin</Button>}{profile.role==='admin'&&!self&&<Button size="sm" variant="ghost" onClick={()=>setConfirm({p:profile,patch:{role:'judge'},label:'Remove administrator access?'})}><ShieldOff size={13}/>Remove admin</Button>}</div></td></tr>})}</tbody></table></div>}</Card>

    <Modal open={!!invite} onClose={()=>setInvite(null)} title={invite?.method==='create-temporary'?'Create judge with temporary password':'Invite judge by email'} size="xl" footer={<><Button variant="secondary" onClick={()=>setInvite(null)}>Cancel</Button><Button loading={busy==='create-account'} onClick={()=>void createAccount()}>{invite?.method==='create-temporary'?<KeyRound size={14}/>:<Send size={14}/>} {invite?.method==='create-temporary'?'Create account':'Send secure invitation'}</Button></>}>
      {invite&&<div className="space-y-4">{accountError&&<Alert tone="error" title="Account could not be created">{accountError}</Alert>}<div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" required><Input value={invite.fullName} onChange={(e)=>setInvite({...invite,fullName:e.target.value})}/></Field><Field label="E-mail" required><Input type="email" value={invite.email} onChange={(e)=>setInvite({...invite,email:e.target.value})}/></Field></div><TeamAccessPicker teams={teams} reference={reference} selected={invite.teams} onChange={(selected)=>setInvite({...invite,teams:selected})}/><Alert tone="info">{invite.method==='invite'?'The judge receives an expiring link and creates their own password.':'A strong temporary password will be shown once. The judge must replace it immediately after signing in. It is never stored in application tables or logs.'}</Alert></div>}
    </Modal>
    <Modal open={!!temporaryResult} onClose={()=>setTemporaryResult(null)} title="Temporary password created" footer={<Button onClick={()=>setTemporaryResult(null)}>I have stored it securely</Button>}>
      {temporaryResult&&<div className="space-y-4"><Alert tone="warning" title="Shown only once">Copy this password now. It cannot be retrieved after this window is closed.</Alert><div><p className="text-sm text-slate-600">{temporaryResult.email}</p><div className="mt-2 flex items-center gap-2 rounded-xl border bg-slate-50 p-3"><code className="min-w-0 flex-1 break-all text-base font-semibold">{temporaryResult.password}</code><Button variant="secondary" size="sm" onClick={async()=>{await navigator.clipboard.writeText(temporaryResult.password);toast('success','Temporary password copied')}}><Copy size={14}/>Copy</Button></div></div></div>}
    </Modal>
    <Modal open={!!manage} onClose={()=>setManage(null)} title={`Team access · ${manage?.profile.full_name??''}`} size="xl" footer={<><Button variant="secondary" onClick={()=>setManage(null)}>Cancel</Button><Button loading={busy===manage?.profile.id} onClick={()=>void saveAssignments()}>Save assignments</Button></>}>
      {manage&&<TeamAccessPicker teams={teams} reference={reference} selected={manage.teams} onChange={(selected)=>setManage({...manage,teams:selected})}/>} </Modal>
    <Modal open={!!confirm} onClose={()=>setConfirm(null)} title="Please confirm" footer={<><Button variant="secondary" onClick={()=>setConfirm(null)}>Cancel</Button><Button variant="danger" loading={busy===confirm?.p.id} onClick={()=>confirm&&void apply(confirm.p,confirm.patch,'Account updated')}>Confirm</Button></>}><p className="text-sm">{confirm?.label}</p><p className="mt-2 font-medium">{confirm?.p.full_name} · {confirm?.p.email}</p></Modal>
  </div>;
}

function TeamAccessPicker({teams,reference,selected,onChange}:{teams:Team[];reference:Reference|null;selected:Set<string>;onChange:(value:Set<string>)=>void}) {
  const [organization,setOrganization]=useState(''),[level,setLevel]=useState(''),[query,setQuery]=useState('');
  const levelMap=new Map(reference?.levels.map((item)=>[item.code,item])??[]);
  const visible=teams.filter((team)=>{const item=levelMap.get(team.level_code);return(!organization||item?.organization===organization)&&(!level||team.level_code===level)&&(!query.trim()||`${team.team_code} ${team.name} ${team.project_name}`.toLowerCase().includes(query.toLowerCase()))});
  const toggle=(id:string)=>{const next=new Set(selected);if(next.has(id))next.delete(id);else next.add(id);onChange(next)};
  return <div><h3 className="mb-2 font-semibold">Organizations, grades, levels and teams</h3><div className="grid gap-2 sm:grid-cols-3"><Select value={organization} onChange={(e)=>{setOrganization(e.target.value);setLevel('')}}><option value="">All organizations</option><option>DEMI</option><option>DECI</option></Select><Select value={level} onChange={(e)=>setLevel(e.target.value)}><option value="">All grades / levels</option>{reference?.levels.filter((item)=>!organization||item.organization===organization).map((item)=><option key={item.code} value={item.code}>{item.label}</option>)}</Select><Input placeholder="Search teams" value={query} onChange={(e)=>setQuery(e.target.value)}/></div><div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={()=>onChange(new Set([...selected,...visible.map((team)=>team.id)]))}>Select filtered</Button><Button size="sm" variant="ghost" onClick={()=>{const ids=new Set(visible.map((team)=>team.id));onChange(new Set([...selected].filter((id)=>!ids.has(id))))}}>Clear filtered</Button></div><div className="mt-2 max-h-72 overflow-y-auto rounded-xl border"><ul className="divide-y">{visible.map((team)=>{const item=levelMap.get(team.level_code);return <li key={team.id}><label className="flex cursor-pointer gap-3 p-3 hover:bg-slate-50"><input type="checkbox" checked={selected.has(team.id)} onChange={()=>toggle(team.id)}/><span><b>{team.team_code} · {team.name}</b><span className="block text-xs text-slate-500">{item?.organization} · {item?.label} · {team.project_name}</span></span></label></li>})}</ul></div><p className="mt-2 text-xs text-slate-500">{selected.size} team{selected.size===1?'':'s'} selected. Access is enforced by database row-level security.</p></div>;
}
