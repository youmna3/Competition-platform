import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, History, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { countTemplateEvaluations, createRubricDraft, fetchRubricVersions, loadReference, loadScoreLevels, loadTemplate, publishRubric, saveRubricDraft, type Reference, type RubricDraftPayload } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Competition, Organization, RubricSection, RubricTemplate, RubricVersionSummary, ScoreLevel } from '@/lib/types';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '@/components/ui';

interface CatalogEntry { competition: Competition; template: RubricTemplate }

export default function RubricManagementPage() {
  const toast = useToast();
  const [reference, setReference] = useState<Reference | null>(null);
  const [versions, setVersions] = useState<RubricVersionSummary[]>([]);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [organization, setOrganization] = useState<Organization>('DEMI');
  const [scale, setScale] = useState<ScoreLevel[]>([]);
  const [editing, setEditing] = useState<RubricTemplate | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<RubricTemplate | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [evaluationCount, setEvaluationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferred?: string) => {
    setLoading(true);
    try {
      const [ref, allVersions] = await Promise.all([loadReference(true), fetchRubricVersions()]);
      const active = await Promise.all(ref.competitions.map(async (competition) => ({ competition, template: await loadTemplate(competition.template_id) })));
      setReference(ref); setVersions(allVersions); setEntries(active);
      setSelectedId(preferred || selectedId || active[0]?.template.id || ''); setError(null);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, [selectedId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedSummary = versions.find(x => x.id === selectedId);
  const family = selectedSummary?.family_id ?? selectedTemplate?.family_id ?? selectedTemplate?.id;
  const selectedEntry = entries.find(x => (x.template.family_id ?? x.template.id) === family);
  const visibleEntries = entries.filter(x => x.competition.organization === organization);
  const familyVersions = versions.filter(x => (x.family_id ?? x.id) === family).sort((a,b)=>(b.version??1)-(a.version??1));

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true); setError(null);
    Promise.all([loadTemplate(selectedId), loadScoreLevels(selectedId)])
      .then(([template, levels]) => { if (!cancelled) { setSelectedTemplate(template); setScale(levels); } })
      .catch(e => { if (!cancelled) { setSelectedTemplate(null); setError(errorMessage(e)); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const startEdit = async () => {
    if (!selectedTemplate) return; setBusy(true);
    try {
      const draftId = selectedTemplate.lifecycle === 'draft' ? selectedTemplate.id : await createRubricDraft(selectedTemplate.id);
      const protectedVersion = selectedTemplate.lifecycle === 'draft' ? (selectedTemplate.based_on_id ?? selectedTemplate.id) : selectedTemplate.id;
      const [draft, levels, count] = await Promise.all([loadTemplate(draftId), loadScoreLevels(draftId), countTemplateEvaluations(protectedVersion)]);
      setEvaluationCount(count); setScale(levels); setEditing(draft); setSelectedId(draftId); await load(draftId);
    } catch(e) { toast('error',errorMessage(e)); } finally { setBusy(false); }
  };
  if (loading && !reference) return <Spinner label="Loading all rubric versions…"/>;
  if (error && !reference) return <Alert tone="error" title="Could not load rubrics">{error}</Alert>;
  return <div data-testid="rubric-management">
    <PageHeader title="Rubric Management" subtitle="Create immutable drafts, validate and preview them, then publish without changing historical evaluations." actions={selectedTemplate&&<div className="flex flex-wrap gap-2"><Link className="inline-flex h-10 items-center gap-2 rounded-full border border-brand-600 px-5 text-sm text-brand-700" to={`/admin/rubrics/${selectedTemplate.id}/preview`}><Eye size={16}/>Preview</Link><Button onClick={startEdit} loading={busy}><Pencil size={16}/>{selectedTemplate.lifecycle==='draft'?'Continue editing':'Edit as new version'}</Button></div>}/>
    {error&&<Alert tone="error" className="mb-4">{error}</Alert>}
    <Card className="mb-6 p-4"><div className="flex gap-2">{(['DEMI','DECI'] as Organization[]).map(org=><button key={org} onClick={()=>{setOrganization(org);const e=entries.find(x=>x.competition.organization===org);if(e)setSelectedId(e.template.id)}} className={clsx('rounded-full px-5 py-2 text-sm font-semibold',organization===org?(org==='DEMI'?'bg-demi-500 text-white':'bg-deci-500 text-white'):'bg-slate-100 text-slate-600')}>{org}</button>)}</div><div className="mt-3 flex flex-wrap gap-2">{visibleEntries.map(e=><button key={e.competition.code} onClick={()=>setSelectedId(e.template.id)} className={clsx('rounded-full border px-4 py-2 text-sm',family===(e.template.family_id??e.template.id)?'border-brand-600 bg-brand-50 text-brand-800':'border-slate-200')}>{e.competition.label}</button>)}</div>{familyVersions.length>0&&<div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4"><History size={15}/><span className="text-xs font-semibold uppercase text-slate-500">History</span>{familyVersions.map(v=><button key={v.id} onClick={()=>setSelectedId(v.id)} className={clsx('rounded-full px-3 py-1 text-xs',selectedId===v.id?'bg-slate-800 text-white':'bg-slate-100')}>v{v.version??1} · {v.lifecycle??'published'}</button>)}</div>}</Card>
    {detailLoading ? <Spinner label="Loading complete rubric…"/> : editing&&editing.id===selectedId?<RubricEditor template={editing} scale={scale} evaluationCount={evaluationCount} onCancel={()=>setEditing(null)} onChanged={async id=>{setEditing(null);await load(id)}}/>:selectedTemplate&&selectedEntry?<RubricDetails template={selectedTemplate} competition={selectedEntry.competition} scale={scale}/>:<Card><EmptyState title="Rubric data unavailable">{error ? 'The database returned an error. Review the message above and verify the rubric-management migration.' : 'Select a rubric version.'}</EmptyState></Card>}
  </div>;
}

const toPayload=(t:RubricTemplate,scale:ScoreLevel[]):RubricDraftPayload=>({title:t.title,subtitle:t.subtitle,scale_instruction:t.scale_instruction,guidance:t.guidance,score_levels:scale.map(x=>({...x})),sections:[...t.sections,...(t.bonus?[t.bonus]:[])].map(s=>({title:s.title,weight:s.weight,is_bonus:s.is_bonus,criteria:s.criteria.map(c=>({title:c.title,description:c.description}))}))});
export function validateRubricDraft(p:RubricDraftPayload){const e:string[]=[];const core=p.sections.filter(s=>!s.is_bonus),bonus=p.sections.filter(s=>s.is_bonus);if(!p.title.trim()||!p.subtitle.trim()||!p.scale_instruction.trim()||!p.guidance.trim())e.push('Title, subtitle and instructions are required.');const total=core.reduce((n,s)=>n+s.weight,0);if(total!==100)e.push(`Core section weights must total 100 (currently ${total}).`);if(bonus.length!==1)e.push('Exactly one optional bonus section is required.');p.sections.forEach(s=>{if(!s.title.trim())e.push('Every section needs a title.');if(!s.criteria.length)e.push(`${s.title||'A section'} needs a criterion.`);if(s.criteria.length*5!==s.weight)e.push(`${s.title||'Section'}: ${s.criteria.length} criteria × 5 = ${s.criteria.length*5}, not ${s.weight}.`);s.criteria.forEach(c=>{if(!c.title.trim()||!c.description.trim())e.push(`${s.title||'Section'} has an incomplete criterion.`)})});if(p.score_levels.length!==5||p.score_levels.some((x,i)=>x.value!==i+1||!x.label.trim()||!x.description.trim()))e.push('Scoring levels 1 through 5 must be complete.');return [...new Set(e)]}
function move<T>(a:T[],from:number,to:number){const x=[...a];const[v]=x.splice(from,1);x.splice(to,0,v);return x}

function RubricEditor({template,scale,evaluationCount,onCancel,onChanged}:{template:RubricTemplate;scale:ScoreLevel[];evaluationCount:number;onCancel:()=>void;onChanged:(id:string)=>Promise<void>}){
  const toast=useToast(),[draft,setDraft]=useState(()=>toPayload(template,scale)),[busy,setBusy]=useState(false),[handling,setHandling]=useState<'keep_existing'|'move_unevaluated'>('keep_existing');
  const errors=useMemo(()=>validateRubricDraft(draft),[draft]),core=draft.sections.filter(s=>!s.is_bonus).reduce((n,s)=>n+s.weight,0),bonus=draft.sections.filter(s=>s.is_bonus).reduce((n,s)=>n+s.weight,0);
  const section=(i:number,patch:Partial<RubricDraftPayload['sections'][number]>)=>setDraft(d=>({...d,sections:d.sections.map((s,j)=>j===i?{...s,...patch}:s)}));
  const save=async()=>{setBusy(true);try{await saveRubricDraft(template.id,draft);toast('success','Draft saved');await onChanged(template.id)}catch(e){toast('error',errorMessage(e))}finally{setBusy(false)}};
  const publish=async()=>{if(errors.length)return;setBusy(true);try{await saveRubricDraft(template.id,draft);await publishRubric(template.id,handling);toast('success','Rubric version published');await onChanged(template.id)}catch(e){toast('error',errorMessage(e))}finally{setBusy(false)}};
  return <div className="space-y-5">{evaluationCount>0&&<Alert tone="warning" title="Existing evaluations are protected">The previous version has {evaluationCount} evaluation{evaluationCount===1?'':'s'}. This draft is a new version; those scores remain unchanged.</Alert>}
    <Card className="p-5"><div className="grid gap-4 md:grid-cols-2"><Field label="Title"><Input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></Field><Field label="Subtitle"><Input value={draft.subtitle} onChange={e=>setDraft({...draft,subtitle:e.target.value})}/></Field></div><div className="mt-4"><Field label="Scoring instruction"><Textarea rows={2} value={draft.scale_instruction} onChange={e=>setDraft({...draft,scale_instruction:e.target.value})}/></Field></div><div className="mt-4"><Field label="Judge guidance"><Textarea rows={3} value={draft.guidance} onChange={e=>setDraft({...draft,guidance:e.target.value})}/></Field></div></Card>
    <Card className="p-5"><h3 className="font-bold">Scoring configuration</h3><div className="mt-3 grid gap-2">{draft.score_levels.map((l,i)=><div key={l.value} className="grid gap-2 md:grid-cols-[3rem_12rem_1fr]"><b className="pt-2 text-center">{l.value}</b><Input value={l.label} onChange={e=>setDraft({...draft,score_levels:draft.score_levels.map((x,j)=>j===i?{...x,label:e.target.value}:x)})}/><Input value={l.description} onChange={e=>setDraft({...draft,score_levels:draft.score_levels.map((x,j)=>j===i?{...x,description:e.target.value}:x)})}/></div>)}</div></Card>
    {draft.sections.map((s,i)=><Card key={i} className={clsx('overflow-hidden',s.is_bonus&&'border-amber-300')}><div className={clsx('flex flex-wrap items-center gap-2 p-4',s.is_bonus?'bg-amber-100':'bg-brand-50')}><Input className="min-w-[220px] flex-1" value={s.title} onChange={e=>section(i,{title:e.target.value})}/><Input className="w-24" aria-label="Section weight" type="number" min={5} step={5} value={s.weight} onChange={e=>section(i,{weight:Number(e.target.value)})}/><span className="text-xs">Calculated {s.criteria.length*5}</span><Button size="sm" variant="ghost" disabled={i===0||s.is_bonus} onClick={()=>setDraft({...draft,sections:move(draft.sections,i,i-1)})}><ArrowUp size={14}/></Button><Button size="sm" variant="ghost" disabled={i===draft.sections.length-1||draft.sections[i+1]?.is_bonus} onClick={()=>setDraft({...draft,sections:move(draft.sections,i,i+1)})}><ArrowDown size={14}/></Button>{!s.is_bonus&&<Button size="sm" variant="danger" onClick={()=>setDraft({...draft,sections:draft.sections.filter((_,j)=>j!==i)})}><Trash2 size={14}/></Button>}</div><div className="divide-y">{s.criteria.map((c,j)=><div key={j} className="grid gap-2 p-4 md:grid-cols-[1fr_2fr_auto]"><Input value={c.title} onChange={e=>section(i,{criteria:s.criteria.map((x,k)=>k===j?{...x,title:e.target.value}:x)})}/><Textarea rows={2} value={c.description} onChange={e=>section(i,{criteria:s.criteria.map((x,k)=>k===j?{...x,description:e.target.value}:x)})}/><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={j===0} onClick={()=>section(i,{criteria:move(s.criteria,j,j-1)})}><ArrowUp size={14}/></Button><Button size="sm" variant="ghost" disabled={j===s.criteria.length-1} onClick={()=>section(i,{criteria:move(s.criteria,j,j+1)})}><ArrowDown size={14}/></Button><Button size="sm" variant="danger" onClick={()=>section(i,{criteria:s.criteria.filter((_,k)=>k!==j)})}><Trash2 size={14}/></Button></div></div>)}</div><div className="p-4"><Button size="sm" variant="secondary" onClick={()=>section(i,{criteria:[...s.criteria,{title:'New criterion',description:''}]})}><Plus size={14}/>Add criterion</Button></div></Card>)}
    <Button variant="secondary" onClick={()=>{const bi=draft.sections.findIndex(s=>s.is_bonus),sections=[...draft.sections];sections.splice(bi<0?sections.length:bi,0,{title:'New Section',weight:5,is_bonus:false,criteria:[{title:'New criterion',description:''}]});setDraft({...draft,sections})}}><Plus size={15}/>Add section</Button>
    <Card className="p-5"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-brand-50 p-3 font-semibold">Calculated core maximum: {core}</div><div className="rounded-lg bg-amber-50 p-3 font-semibold">Calculated bonus maximum: {bonus}</div></div>{errors.length>0&&<Alert tone="error" title="Fix before publishing" className="mt-4"><ul className="list-disc pl-5">{errors.map(x=><li key={x}>{x}</li>)}</ul></Alert>}<div className="mt-4"><Field label="Existing teams when publishing"><Select value={handling} onChange={e=>setHandling(e.target.value as typeof handling)}><option value="keep_existing">Keep all existing teams on their current version</option><option value="move_unevaluated">Move only teams with no evaluations</option></Select></Field></div><p className="mt-2 text-xs text-slate-500">Teams with evaluations never move automatically. New teams use the new version.</p></Card>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Link className="inline-flex h-10 items-center gap-2 rounded-full border border-brand-600 px-5 text-sm text-brand-700" to={`/admin/rubrics/${template.id}/preview`}><Eye size={15}/>Preview draft</Link><Button variant="secondary" loading={busy} onClick={save}><Save size={15}/>Save draft</Button><Button loading={busy} disabled={errors.length>0} onClick={publish}>Publish version</Button></div>
  </div>;
}

function RubricDetails({template,competition,scale}:{template:RubricTemplate;competition:Competition;scale:ScoreLevel[]}){return <div className="space-y-6"><Card className="p-6"><Badge tone={template.lifecycle==='draft'?'amber':template.lifecycle==='archived'?'slate':'green'}>v{template.version??1} · {template.lifecycle??'published'}</Badge><span className="ml-2 text-xs text-slate-500">{competition.organization} · {competition.label}</span><h2 className="mt-3 text-2xl font-bold">{template.title}</h2><p>{template.subtitle}</p><p className="mt-4 font-semibold">{template.scale_instruction}</p><p className="mt-2 text-sm text-slate-600">{template.guidance}</p></Card><Card className="p-5"><h3 className="font-bold">Scoring scale</h3><div className="mt-3 grid gap-2 sm:grid-cols-5">{scale.map(x=><div key={x.value} className="rounded-lg bg-slate-50 p-3"><b>{x.value} · {x.label}</b><p className="text-xs">{x.description}</p></div>)}</div></Card>{template.sections.map(s=><SectionDetails key={s.id} section={s}/>)}{template.bonus&&<SectionDetails section={template.bonus}/>}<Card className="p-5"><h3 className="font-bold">Score Summary</h3>{template.sections.map(s=><div key={s.id} className="flex justify-between border-b py-2"><span>{s.title}</span><b>{s.weight}</b></div>)}<div className="flex justify-between bg-brand-50 p-3 font-bold"><span>CORE TOTAL</span><span>{template.core_max}</span></div><div className="flex justify-between bg-amber-50 p-3 font-bold"><span>OPTIONAL BONUS</span><span>{template.bonus_max}</span></div></Card></div>}
function SectionDetails({section}:{section:RubricSection}){return <Card className="overflow-hidden"><div className={clsx('flex justify-between p-4 font-semibold',section.is_bonus?'bg-amber-300':'bg-brand-600 text-white')}><span className="flex gap-2">{section.is_bonus&&<Star size={16}/>} {section.title}</span><span>{section.weight} points</span></div>{section.criteria.map(c=><div key={c.id} className="grid gap-2 border-b p-4 md:grid-cols-3"><b>{c.title}</b><p className="md:col-span-2 text-sm text-slate-600">{c.description}</p></div>)}<div className="flex justify-between bg-slate-50 p-3 text-sm font-semibold"><span>Section subtotal</span><span>— / {section.weight}</span></div></Card>}
