import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loadReference, loadTemplate, type Reference } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Organization, RubricTemplate } from '@/lib/types';
import { Alert, Badge, Card, EmptyState, OrgBadge, PageHeader, Spinner } from '@/components/ui';

export default function JudgeRubricsPage() {
  const [reference, setReference] = useState<Reference | null>(null);
  const [templates, setTemplates] = useState<Map<string, RubricTemplate>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextReference = await loadReference();
        const uniqueTemplateIds = [...new Set(nextReference.competitions.map((competition) => competition.template_id))];
        const loaded = await Promise.all(uniqueTemplateIds.map(async (id) => [id, await loadTemplate(id)] as const));
        if (cancelled) return;
        setReference(nextReference);
        setTemplates(new Map(loaded));
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Loading the rubric library…" />;
  if (error) return <Alert tone="error" title="Could not load the rubric library">{error}</Alert>;
  if (!reference) return null;

  return <div>
    <PageHeader title="Rubrics" subtitle="Read-only library of every active DEMI and DECI competition rubric." />
    {(['DEMI', 'DECI'] as Organization[]).map((organization) => {
      const competitions = reference.competitions.filter((competition) => competition.organization === organization);
      return <section key={organization} className="mb-8">
        <div className="mb-3 flex items-center gap-2"><OrgBadge org={organization} /><h2 className="text-lg font-semibold text-slate-900">{organization} rubrics</h2></div>
        {competitions.length === 0 ? <Card><EmptyState title={`No ${organization} rubrics available`} /></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{competitions.map((competition) => {
          const template = templates.get(competition.template_id);
          return <Card key={competition.code} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{competition.label}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{template?.title ?? competition.label}</h3></div><Badge tone="slate">Read only</Badge></div>
            {template?.subtitle && <p className="mt-2 text-sm text-slate-600">{template.subtitle}</p>}
            <div className="mt-4 flex flex-wrap gap-2 text-xs"><Badge tone="blue">Core {template?.core_max ?? 100}</Badge><Badge tone="amber">Bonus max {template?.bonus_max ?? 0}</Badge><Badge tone="slate">Scale 1–5</Badge></div>
            <Link to={`/rubrics/${competition.template_id}/preview`} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><BookOpen size={16} /> Open Full Rubric</Link>
          </Card>;
        })}</div>}
      </section>;
    })}
  </div>;
}
