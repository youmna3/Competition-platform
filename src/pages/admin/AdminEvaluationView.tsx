import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import { fetchAdminPage, fetchEvaluation, fetchProfiles, fetchTeam, loadScoreLevels, loadTemplate, reopenEvaluation } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import type { AuditEntry, Evaluation, Profile, RubricTemplate, ScoreLevel, Team } from '@/lib/types';
import type { ScoreMap } from '@/lib/scoring';
import RubricForm from '@/components/RubricForm';
import { Alert, Badge, Button, Card, CardHeader, Field, Modal, Spinner, Textarea, formatDate, useToast } from '@/components/ui';
import { AuditList } from './AuditPage';
import Pagination from '@/components/Pagination';

export default function AdminEvaluationView() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [judge, setJudge] = useState<Profile | null>(null);
  const [template, setTemplate] = useState<RubricTemplate | null>(null);
  const [scale, setScale] = useState<ScoreLevel[]>([]);
  const [scores, setScores] = useState<ScoreMap>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditTotal,setAuditTotal]=useState(0),[auditPage,setAuditPage]=useState(1),[auditPageSize,setAuditPageSize]=useState(20);
  const [error, setError] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { evaluation: ev, scores: sc } = await fetchEvaluation(id);
      const [t, tpl, lv, profiles, au] = await Promise.all([
        fetchTeam(ev.team_id), loadTemplate(ev.template_id), loadScoreLevels(ev.template_id), fetchProfiles(), fetchAdminPage<AuditEntry>('audit',{evaluation_id:id},auditPage,auditPageSize),
      ]);
      const s: ScoreMap = {};
      const n: Record<string, string> = {};
      sc.forEach((r) => { s[r.criterion_id] = r.score; n[r.criterion_id] = r.note; });
      setEvaluation(ev); setTeam(t); setTemplate(tpl); setScale(lv); setScores(s); setNotes(n); setAudit(au.rows);setAuditTotal(au.total);
      setJudge(profiles.find((p) => p.id === ev.judge_id) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id,auditPage,auditPageSize]);
  useEffect(() => { void load(); }, [load]);

  const doReopen = async () => {
    if (!evaluation || !reason.trim()) return;
    setBusy(true);
    try {
      await reopenEvaluation(evaluation.id, reason.trim());
      toast('success', 'Evaluation reopened. The team is pending until the judge resubmits.');
      setReopenOpen(false);
      setReason('');
      await load();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert tone="error" title="Cannot open evaluation">{error}</Alert>;
  if (!evaluation || !template || !team) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/admin/results" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"><ChevronLeft size={16} /> Evaluations</Link>
        <div className="flex items-center gap-2">
          {evaluation.status === 'submitted' ? <Badge tone="green">Submitted {formatDate(evaluation.submitted_at)}</Badge> : <Badge tone="amber">Draft — not yet submitted</Badge>}
          {evaluation.status === 'submitted' && <Button variant="secondary" onClick={() => setReopenOpen(true)}><RotateCcw size={16} /> Reopen for correction</Button>}
        </div>
      </div>

      <Alert tone="info" className="mb-5">Read-only administrator view of <strong>{judge?.full_name || judge?.email}</strong>'s independent evaluation. Totals shown are the server-calculated values: core {evaluation.core_total}/100, bonus {evaluation.bonus_total}.</Alert>

      <RubricForm
        template={template}
        scale={scale}
        header={{
          team: `${team.name} / #${team.team_code}`,
          project: team.project_name,
          judge: judge?.full_name || judge?.email || '',
          date: new Date(evaluation.submitted_at ?? evaluation.updated_at).toLocaleDateString(),
        }}
        scores={scores}
        notes={notes}
        sectionNotes={evaluation.section_notes ?? {}}
        overallNotes={evaluation.overall_notes}
        readOnly
      />

      <Card className="mt-6">
        <CardHeader title="Change history" subtitle="Every score change, submission and reopen for this evaluation" />
        <AuditList entries={audit} />
        <Pagination page={auditPage} pageSize={auditPageSize} total={auditTotal} onPageChange={setAuditPage} onPageSizeChange={size=>{setAuditPageSize(size);setAuditPage(1)}}/>
      </Card>

      <Modal
        open={reopenOpen}
        onClose={() => !busy && setReopenOpen(false)}
        title="Reopen evaluation"
        footer={<><Button variant="secondary" onClick={() => setReopenOpen(false)} disabled={busy}>Cancel</Button><Button onClick={doReopen} loading={busy} disabled={!reason.trim()}>Reopen</Button></>}
      >
        <p className="mb-3 text-sm text-slate-600">
          The judge will be able to edit and resubmit. Until then the team's official score is withheld and it is removed from the leaderboard. The reason is recorded in the audit log.
        </p>
        <Field label="Reason" required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
      </Modal>
    </div>
  );
}
