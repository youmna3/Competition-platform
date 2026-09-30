import { useEffect, useState } from 'react';
import { ChevronLeft, Eye } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import RubricForm from '@/components/RubricForm';
import { Alert, Spinner } from '@/components/ui';
import { fetchRubricVersions, loadReference, loadScoreLevels, loadTemplate } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { RubricTemplate, ScoreLevel } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';

export default function RubricPreviewPage() {
  const { templateId = '' } = useParams<{ templateId: string }>();
  const { isAdmin, profile } = useAuth();
  const [template, setTemplate] = useState<RubricTemplate | null>(null);
  const [scale, setScale] = useState<ScoreLevel[]>([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ref, versions] = await Promise.all([loadReference(), fetchRubricVersions()]);
        const version = versions.find((item) => item.id === templateId);
        const competition = ref.competitions.find((item) => item.template_id === templateId || item.code === version?.family_id);
        if (!competition || !version) throw new Error('Rubric not found.');
        const [rubric, levels] = await Promise.all([loadTemplate(templateId), loadScoreLevels(templateId)]);
        if (cancelled) return;
        setTemplate(rubric);
        setScale(levels);
        setLabel(`${competition.organization} · ${competition.label} · Version ${version.version} (${version.lifecycle})`);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  if (error) return <Alert tone="error" title="Could not open rubric preview">{error}</Alert>;
  if (!template) return <Spinner label="Opening rubric preview…" />;

  return (
    <div className="pb-10" data-testid="rubric-preview">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={isAdmin ? '/admin/rubrics' : '/judge'} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"><ChevronLeft size={16} /> {isAdmin ? 'Rubric Management' : 'My evaluations'}</Link>
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <Alert tone="info" title="Read-only rubric preview" className="mb-5">
        <span className="inline-flex items-center gap-2"><Eye size={16} /> This is the real evaluation form in preview mode. It cannot create an evaluation, save scores, submit, or affect results.</span>
      </Alert>
      <RubricForm
        template={template}
        scale={scale}
        header={{ team: 'Preview only — no team', project: 'Rubric preview', judge: profile?.full_name || profile?.email || (isAdmin ? 'Administrator' : 'Judge'), date: '—' }}
        scores={{}}
        notes={{}}
        sectionNotes={{}}
        overallNotes=""
        readOnly
      />
    </div>
  );
}
