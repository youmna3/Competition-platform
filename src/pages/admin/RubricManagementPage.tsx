import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Eye, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loadReference, loadScoreLevels, loadTemplate, type Reference } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { Organization, RubricSection, RubricTemplate, ScoreLevel } from '@/lib/types';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

interface CatalogEntry {
  code: string;
  organization: Organization;
  label: string;
  template: RubricTemplate;
}

export default function RubricManagementPage() {
  const [reference, setReference] = useState<Reference | null>(null);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [scale, setScale] = useState<ScoreLevel[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [organization, setOrganization] = useState<Organization>('DEMI');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ref = await loadReference(true);
        const templateIds = [...new Set(ref.competitions.map((competition) => competition.template_id))];
        const [templates, scoreScale] = await Promise.all([
          Promise.all(templateIds.map((id) => loadTemplate(id))),
          loadScoreLevels(),
        ]);
        if (cancelled) return;
        const byId = new Map(templates.map((template) => [template.id, template]));
        const catalog = ref.competitions
          .map((competition) => ({ ...competition, template: byId.get(competition.template_id) }))
          .filter((entry): entry is CatalogEntry & typeof entry => !!entry.template);
        setReference(ref);
        setEntries(catalog);
        setScale(scoreScale);
        setSelectedId(catalog.find((entry) => entry.organization === 'DEMI')?.template.id ?? catalog[0]?.template.id ?? '');
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const visibleEntries = useMemo(() => entries.filter((entry) => entry.organization === organization), [entries, organization]);
  const selected = entries.find((entry) => entry.template.id === selectedId);

  const switchOrganization = (next: Organization) => {
    setOrganization(next);
    setSelectedId(entries.find((entry) => entry.organization === next)?.template.id ?? '');
  };

  if (loading) return <Spinner label="Loading all rubrics…" />;
  if (error) return <Alert tone="error" title="Could not load rubrics">{error}</Alert>;

  return (
    <div data-testid="rubric-management">
      <PageHeader
        title="Rubric Management"
        subtitle="View the complete published judging structure. Rubrics are read-only and existing evaluations are never changed here."
        actions={selected && (
          <Link
            to={`/admin/rubrics/${selected.template.id}/preview`}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-medium text-white transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <Eye size={16} /> Preview Rubric
          </Link>
        )}
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Organization">
          {(['DEMI', 'DECI'] as Organization[]).map((org) => (
            <button
              key={org}
              type="button"
              role="tab"
              aria-selected={organization === org}
              onClick={() => switchOrganization(org)}
              className={clsx(
                'rounded-full px-5 py-2 text-sm font-semibold transition',
                organization === org
                  ? org === 'DEMI' ? 'bg-demi-500 text-white' : 'bg-deci-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {org}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2" aria-label={`${organization} rubrics`}>
          {visibleEntries.map((entry) => (
            <button
              key={entry.code}
              type="button"
              onClick={() => setSelectedId(entry.template.id)}
              className={clsx(
                'rounded-full border px-4 py-2 text-sm font-medium transition',
                selectedId === entry.template.id
                  ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </Card>

      {!selected || !reference ? (
        <Card><EmptyState title="No rubric available">Apply the latest Supabase migrations, then reload this page.</EmptyState></Card>
      ) : (
        <RubricDetails entry={selected} scale={scale} />
      )}
    </div>
  );
}

function RubricDetails({ entry, scale }: { entry: CatalogEntry; scale: ScoreLevel[] }) {
  const { template } = entry;
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className={clsx('h-1.5', entry.organization === 'DEMI' ? 'bg-demi-500' : 'bg-deci-500')} />
        <div className="p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{entry.organization} · {entry.label}</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">{template.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{template.subtitle}</p>
          <div className="mt-5 space-y-3 rounded-xl bg-brand-50 p-4 text-sm leading-relaxed text-brand-950">
            <p className="font-semibold">{template.scale_instruction}</p>
            <p>{template.guidance}</p>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h3 className="text-base font-bold text-slate-900">Scoring scale</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {scale.map((level) => (
            <div key={level.value} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-bold text-slate-900">{level.value} · {level.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{level.description}</p>
            </div>
          ))}
        </div>
      </Card>

      {template.sections.map((section) => <SectionDetails key={section.id} section={section} />)}
      {template.bonus && <SectionDetails section={template.bonus} />}

      <Card className="overflow-hidden">
        <div className="bg-brand-800 px-5 py-3 sm:px-6"><h3 className="font-semibold text-white">Score Summary</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3 sm:px-6">Section</th><th className="px-3 py-3 text-center">Maximum</th><th className="px-5 py-3 text-center">Section subtotal</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {template.sections.map((section) => (
                <tr key={section.id}><td className="px-5 py-3 font-medium sm:px-6">{section.title}</td><td className="px-3 py-3 text-center">{section.weight}</td><td className="px-5 py-3 text-center text-slate-400">— / {section.weight}</td></tr>
              ))}
              <tr className="bg-brand-50 font-bold text-brand-900"><td className="px-5 py-3 sm:px-6">CORE TOTAL</td><td className="px-3 py-3 text-center">{template.core_max}</td><td className="px-5 py-3 text-center">— / {template.core_max}</td></tr>
              {template.bonus && <tr className="bg-amber-50 font-semibold text-amber-900"><td className="px-5 py-3 sm:px-6">OPTIONAL BONUS (record separately)</td><td className="px-3 py-3 text-center">{template.bonus_max}</td><td className="px-5 py-3 text-center">— / {template.bonus_max}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SectionDetails({ section }: { section: RubricSection }) {
  return (
    <Card className={clsx('overflow-hidden', section.is_bonus && 'border-amber-300')}>
      <div className={clsx('flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6', section.is_bonus ? 'bg-amber-300 text-amber-950' : 'bg-brand-600 text-white')}>
        <h3 className="flex items-center gap-2 font-semibold">{section.is_bonus && <Star size={16} />}{section.title}</h3>
        <span className="text-sm font-semibold">{section.is_bonus ? `Optional Bonus - max ${section.weight}` : `Section Weight: ${section.weight} points`}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="w-1/3 px-5 py-3 sm:px-6">Specific judging task</th><th className="px-4 py-3">What the judge should look for</th><th className="w-24 px-5 py-3 text-center">Maximum</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {section.criteria.map((criterion) => (
              <tr key={criterion.id}><td className="px-5 py-3 font-semibold text-slate-900 sm:px-6">{criterion.title}</td><td className="px-4 py-3 leading-relaxed text-slate-600">{criterion.description}</td><td className="px-5 py-3 text-center font-semibold">{criterion.max_points}</td></tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold"><tr><td className="px-5 py-3 sm:px-6" colSpan={2}>Section subtotal</td><td className="px-5 py-3 text-center text-slate-500">— / {section.weight}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  );
}
