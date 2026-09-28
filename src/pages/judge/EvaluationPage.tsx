import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronLeft, CloudOff, Loader2, Lock, Send } from 'lucide-react';
import {
  fetchEvaluation, fetchTeam, loadReference, loadScoreLevels, loadTemplate, saveEvaluation, startEvaluation, submitEvaluation,
} from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { computeTotals, type ScoreMap } from '@/lib/scoring';
import type { Evaluation, RubricTemplate, ScoreChange, ScoreLevel, Team } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import RubricForm from '@/components/RubricForm';
import { Alert, Button, Modal, ProgressBar, Spinner, formatDate, useToast } from '@/components/ui';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface Pending {
  scores: Map<string, ScoreChange>;
  sections: Record<string, string>;
  overall: string | null;
}
const emptyPending = (): Pending => ({ scores: new Map(), sections: {}, overall: null });
const isEmpty = (p: Pending) => p.scores.size === 0 && Object.keys(p.sections).length === 0 && p.overall === null;

export default function EvaluationPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { profile } = useAuth();
  const toast = useToast();

  const [team, setTeam] = useState<Team | null>(null);
  const [levelLabel, setLevelLabel] = useState('');
  const [template, setTemplate] = useState<RubricTemplate | null>(null);
  const [scale, setScale] = useState<ScoreLevel[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [scores, setScores] = useState<ScoreMap>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pending = useRef<Pending>(emptyPending());
  const scoresRef = useRef<ScoreMap>({});
  const notesRef = useRef<Record<string, string>>({});
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalId = evaluation?.id;
  const locked = evaluation?.status === 'submitted';

  // ------------------------------------------------------------------ load
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await fetchTeam(teamId);
        if (!t) throw new Error('This team is not assigned to you, or it does not exist.');
        const ref = await loadReference();
        const level = ref.levels.find((l) => l.code === t.level_code);
        const comp = ref.competitions.find((c) => c.code === level?.competition_code);
        if (!comp) throw new Error('Team has no competition category.');
        const id = await startEvaluation(teamId); // idempotent: returns the existing evaluation if any
        const [tpl, sc, ev] = await Promise.all([loadTemplate(comp.template_id), loadScoreLevels(), fetchEvaluation(id)]);
        if (cancelled) return;
        setTeam(t);
        setLevelLabel(`${level?.organization} · ${level?.label}`);
        setTemplate(tpl);
        setScale(sc);
        setEvaluation(ev.evaluation);
        const s: ScoreMap = {};
        const n: Record<string, string> = {};
        ev.scores.forEach((row) => {
          s[row.criterion_id] = row.score;
          n[row.criterion_id] = row.note ?? '';
        });
        scoresRef.current = s;
        notesRef.current = n;
        setScores(s);
        setNotes(n);
        setSectionNotes(ev.evaluation.section_notes ?? {});
        setOverall(ev.evaluation.overall_notes ?? '');
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // ------------------------------------------------------------------ autosave
  const flush = useCallback(async (): Promise<void> => {
    if (!evalId) return;
    if (inFlight.current) {
      await inFlight.current;
    }
    if (isEmpty(pending.current)) return;
    const batch = pending.current;
    pending.current = emptyPending();
    setSaveState('saving');
    const p = (async () => {
      try {
        const row = await saveEvaluation(
          evalId,
          batch.scores.size ? [...batch.scores.values()] : null,
          Object.keys(batch.sections).length ? batch.sections : null,
          batch.overall,
        );
        setEvaluation(row);
        setLastSaved(new Date());
        setSaveError(null);
        setSaveState(isEmpty(pending.current) ? 'saved' : 'pending');
      } catch (e) {
        // put the batch back underneath any newer edits, then retry
        const cur = pending.current;
        batch.scores.forEach((v, k) => { if (!cur.scores.has(k)) cur.scores.set(k, v); });
        for (const [k, v] of Object.entries(batch.sections)) if (!(k in cur.sections)) cur.sections[k] = v;
        if (cur.overall === null) cur.overall = batch.overall;
        const msg = errorMessage(e);
        setSaveError(msg);
        setSaveState('error');
        if (/locked|submitted/i.test(msg)) return; // evaluation was locked elsewhere; don't retry
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => void flush(), 5000);
      }
    })();
    inFlight.current = p;
    await p;
    inFlight.current = null;
    if (!isEmpty(pending.current) && saveStateRef.current !== 'error') schedule(400);
  }, [evalId]);

  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;

  const schedule = useCallback((delay: number) => {
    setSaveState((s) => (s === 'saving' ? s : 'pending'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }, [flush]);

  // flush when leaving / hiding the tab; warn about unsaved edits
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isEmpty(pending.current) || inFlight.current) {
        void flush();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
      if (timer.current) clearTimeout(timer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      void flush(); // save on in-app navigation away
    };
  }, [flush]);

  // ------------------------------------------------------------------ edits
  const onScore = useCallback((id: string, v: number | null) => {
    scoresRef.current = { ...scoresRef.current, [id]: v };
    setScores(scoresRef.current);
    pending.current.scores.set(id, { criterion_id: id, score: v, note: notesRef.current[id] ?? '' });
    schedule(250);
  }, [schedule]);

  const onNote = useCallback((id: string, v: string) => {
    notesRef.current = { ...notesRef.current, [id]: v };
    setNotes(notesRef.current);
    pending.current.scores.set(id, { criterion_id: id, score: (scoresRef.current[id] ?? null) as number | null, note: v });
    schedule(1000);
  }, [schedule]);

  const onSectionNote = useCallback((id: string, v: string) => {
    setSectionNotes((n) => ({ ...n, [id]: v }));
    pending.current.sections[id] = v;
    schedule(1000);
  }, [schedule]);

  const onOverallNote = useCallback((v: string) => {
    setOverall(v);
    pending.current.overall = v;
    schedule(1000);
  }, [schedule]);

  const totals = useMemo(() => (template ? computeTotals(template, scores) : null), [template, scores]);

  const jumpToMissing = () => {
    setShowMissing(true);
    const id = totals?.missing[0];
    if (id) document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ------------------------------------------------------------------ submit
  const doSubmit = async () => {
    if (!evaluation || !template || !totals?.complete || submitting) return;
    setSubmitting(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      if (inFlight.current) await inFlight.current;
      // Send the complete on-screen state: the server stores exactly what the judge sees.
      const all: ScoreChange[] = [...template.sections, ...(template.bonus ? [template.bonus] : [])]
        .flatMap((s) => s.criteria)
        .map((c) => ({ criterion_id: c.id, score: (scores[c.id] ?? null) as number | null, note: notes[c.id] ?? '' }));
      const row = await submitEvaluation(evaluation.id, all, sectionNotes, overall);
      pending.current = emptyPending();
      setEvaluation(row);
      setSaveState('saved');
      setConfirmOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('success', 'Evaluation submitted. Thank you!');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------ render
  if (loadError) {
    return (
      <div className="mx-auto max-w-xl">
        <Alert tone="error" title="Cannot open this evaluation">{loadError}</Alert>
        <Link to="/judge" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700"><ChevronLeft size={14} /> Back to my teams</Link>
      </div>
    );
  }
  if (!team || !template || !evaluation || !totals) return <Spinner label="Opening rubric…" />;

  return (
    <div className="pb-28">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/judge" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ChevronLeft size={16} /> My teams
        </Link>
        <span className="text-xs font-medium text-slate-500">{levelLabel}</span>
      </div>

      {locked && (
        <Alert tone="success" title="Submitted" className="mb-5">
          Submitted {formatDate(evaluation.submitted_at)}. Submitted evaluations are locked; contact an administrator if a correction is needed.
        </Alert>
      )}
      {!locked && evaluation.reopened_count > 0 && (
        <Alert tone="warning" title="Reopened by an administrator" className="mb-5">
          Review your scores and submit again when ready.
        </Alert>
      )}

      <RubricForm
        template={template}
        scale={scale}
        header={{
          team: `${team.name} / #${team.team_code}`,
          project: team.project_name,
          judge: profile?.full_name || profile?.email || '',
          date: new Date(evaluation.submitted_at ?? evaluation.updated_at).toLocaleDateString(),
        }}
        scores={scores}
        notes={notes}
        sectionNotes={sectionNotes}
        overallNotes={overall}
        readOnly={locked}
        showMissing={showMissing}
        onScore={onScore}
        onNote={onNote}
        onSectionNote={onSectionNote}
        onOverallNote={onOverallNote}
      />

      {/* sticky summary bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Core</p>
              <p className="text-xl font-bold tabular-nums text-slate-900">{totals.core}<span className="text-sm font-medium text-slate-400">/{template.core_max}</span></p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Bonus</p>
              <p className="text-xl font-bold tabular-nums text-amber-700">{totals.bonus}<span className="text-sm font-medium text-amber-400">/{template.bonus_max}</span></p>
            </div>
          </div>
          <div className="min-w-[140px] flex-1">
            <div className="mb-1 flex justify-between text-xs text-slate-600">
              <span>{totals.coreScored}/{totals.coreCount} core rows</span>
              {!locked && <SaveIndicator state={saveState} lastSaved={lastSaved} error={saveError} />}
            </div>
            <ProgressBar value={totals.coreScored} max={totals.coreCount} tone={totals.complete ? 'green' : 'blue'} />
          </div>
          {locked ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><Lock size={16} /> Submitted</span>
          ) : (
            <div className="flex gap-2">
              {!totals.complete && (
                <Button variant="secondary" onClick={jumpToMissing}>Next missing</Button>
              )}
              <Button
                variant="accent"
                onClick={() => (totals.complete ? setConfirmOpen(true) : jumpToMissing())}
                disabled={!totals.complete}
                title={totals.complete ? 'Submit evaluation' : `${totals.coreCount - totals.coreScored} core rows still need a score`}
              >
                <Send size={16} /> Submit
              </Button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Submit evaluation?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>Keep editing</Button>
            <Button variant="accent" onClick={doSubmit} loading={submitting}><Send size={16} /> Submit final scores</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          You are submitting your evaluation of <strong>{team.name}</strong> (#{team.team_code}). After submission the scores are locked.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {totals.sections.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 text-slate-700">{s.title}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{s.subtotal}/{s.weight}</td>
                </tr>
              ))}
              <tr className="bg-brand-50 font-bold text-brand-800">
                <td className="px-3 py-2">CORE TOTAL</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.core}/{template.core_max}</td>
              </tr>
              <tr className="bg-amber-50 font-semibold text-amber-900">
                <td className="px-3 py-2">Optional bonus (separate)</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.bonus}/{template.bonus_max}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

function SaveIndicator({ state, lastSaved, error }: { state: SaveState; lastSaved: Date | null; error: string | null }) {
  if (state === 'saving') return <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 size={12} className="animate-spin" /> Saving…</span>;
  if (state === 'pending') return <span className="text-slate-500">Unsaved changes…</span>;
  if (state === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-rose-600" title={error ?? ''}>
        {/fetch|network/i.test(error ?? '') ? <CloudOff size={12} /> : <AlertCircle size={12} />} Not saved – retrying
      </span>
    );
  if (state === 'saved' && lastSaved)
    return <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> Draft saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
  return <span className="text-slate-400">Drafts save automatically</span>;
}
