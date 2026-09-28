import clsx from 'clsx';
import { memo, useState } from 'react';
import { ChevronDown, ChevronUp, Info, Star } from 'lucide-react';
import type { RubricCriterion, RubricSection, RubricTemplate, ScoreLevel } from '@/lib/types';
import { computeTotals, sectionSubtotal, type ScoreMap } from '@/lib/scoring';
import { Card, Input, Textarea } from './ui';

export interface RubricFormProps {
  template: RubricTemplate;
  scale: ScoreLevel[];
  header: { team: string; project: string; judge: string; date: string };
  scores: ScoreMap;
  notes: Record<string, string>;
  sectionNotes: Record<string, string>;
  overallNotes: string;
  readOnly?: boolean;
  showMissing?: boolean;
  onScore?: (criterionId: string, value: number | null) => void;
  onNote?: (criterionId: string, value: string) => void;
  onSectionNote?: (sectionId: string, value: string) => void;
  onOverallNote?: (value: string) => void;
}

export default function RubricForm(props: RubricFormProps) {
  const { template, scale, header, scores } = props;
  const totals = computeTotals(template, scores);
  const [guideOpen, setGuideOpen] = useState(!props.readOnly);

  return (
    <div className="space-y-6">
      {/* Title block (mirrors the PDF header) */}
      <Card className="overflow-hidden">
        <div className="brand-stripe h-1.5" />
        <div className="px-5 py-5 sm:px-6">
          <h2 className="text-xl font-bold text-brand-950">{template.title}</h2>
          <p className="text-sm text-slate-500">{template.subtitle}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Team Name / #', header.team],
              ['Project Name', header.project],
              ['Judge Name', header.judge],
              ['Date', header.date],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="truncate text-sm font-medium text-slate-900" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      {/* How to score every row */}
      <Card>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
          onClick={() => setGuideOpen((o) => !o)}
          aria-expanded={guideOpen}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Info size={16} className="text-brand-600" /> How to Score Every Row
          </span>
          {guideOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>
        {guideOpen && (
          <div className="border-t border-slate-100 px-5 pb-5 pt-4 sm:px-6">
            <p className="text-sm font-medium text-slate-800">{template.scale_instruction}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              {scale.map((s) => (
                <div key={s.value} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <span className={clsx('flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-white', scoreColor(s.value))}>{s.value}</span>
                    <span className="text-sm font-semibold text-slate-900">{s.label}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">{s.description}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-900">{template.guidance}</p>
          </div>
        )}
      </Card>

      {template.sections.map((s) => (
        <SectionCard key={s.id} section={s} {...props} />
      ))}
      {template.bonus && <SectionCard section={template.bonus} {...props} />}

      {/* Score summary (mirrors the PDF) */}
      <Card className="overflow-hidden">
        <div className="bg-brand-800 px-5 py-3 sm:px-6">
          <h3 className="text-sm font-semibold text-white">Score Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 sm:px-6">Section</th>
                <th className="px-3 py-2.5 text-center">Maximum</th>
                <th className="px-3 py-2.5 text-center">Section Subtotal</th>
                <th className="px-3 py-2.5">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {totals.sections.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-2.5 font-medium text-slate-800 sm:px-6">{s.title}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{s.weight}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={clsx('inline-block min-w-[3.5rem] rounded-md px-2 py-1 font-semibold tabular-nums', s.scored === s.count ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700')}>
                      {s.subtotal}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {props.readOnly ? (
                      <span className="text-slate-600">{props.sectionNotes[s.id] || '—'}</span>
                    ) : (
                      <Input
                        value={props.sectionNotes[s.id] ?? ''}
                        maxLength={2000}
                        onChange={(e) => props.onSectionNote?.(s.id, e.target.value)}
                        placeholder="Optional"
                        aria-label={`Notes for ${s.title}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-brand-50">
                <td className="px-5 py-3 font-bold text-brand-800 sm:px-6">CORE TOTAL</td>
                <td className="px-3 py-3 text-center font-bold tabular-nums text-brand-800">{template.core_max}</td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-block min-w-[3.5rem] rounded-md bg-brand-700 px-2 py-1 font-bold tabular-nums text-white">{totals.core}</span>
                </td>
                <td className="px-3 py-3 text-xs text-slate-500">{totals.coreScored}/{totals.coreCount} rows scored</td>
              </tr>
              {template.bonus && (
                <tr className="bg-amber-50">
                  <td className="px-5 py-3 font-semibold text-amber-900 sm:px-6" colSpan={2}>
                    OPTIONAL BONUS (record separately, max {template.bonus_max})
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-block min-w-[3.5rem] rounded-md bg-amber-500 px-2 py-1 font-bold tabular-nums text-white">{totals.bonus}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-amber-800">Not added to the core total</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-5 py-4 sm:px-6">
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="overall-notes">Notes</label>
          {props.readOnly ? (
            <p className="min-h-[3rem] whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{props.overallNotes || '—'}</p>
          ) : (
            <Textarea
              id="overall-notes"
              rows={4}
              maxLength={8000}
              value={props.overallNotes}
              onChange={(e) => props.onOverallNote?.(e.target.value)}
              placeholder="Overall comments for this evaluation (optional)"
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionCard({ section, ...props }: RubricFormProps & { section: RubricSection }) {
  const subtotal = sectionSubtotal(section, props.scores);
  const scored = section.criteria.filter((c) => props.scores[c.id] != null).length;
  const bonus = section.is_bonus;
  return (
    <Card className={clsx('overflow-hidden', bonus && 'border-amber-300')} id={`section-${section.id}`}>
      <div className={clsx('flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6', bonus ? 'bg-amber-300 text-slate-900' : 'bg-brand-600 text-white')}>
        <h3 className="flex items-center gap-2 text-sm font-semibold sm:text-base">
          {bonus && <Star size={16} />}
          {section.title}
        </h3>
        <div className="flex items-center gap-3 text-xs font-semibold sm:text-sm">
          <span>{bonus ? `Optional Bonus - max ${section.weight}` : `Section Weight: ${section.weight} points`}</span>
          <span className={clsx('rounded-md px-2 py-0.5 tabular-nums', bonus ? 'bg-white/50' : 'bg-white/20')}>
            {subtotal}/{section.weight}
          </span>
        </div>
      </div>
      {bonus && (
        <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900 sm:px-6">
          Optional — score only if the team presented this extra requirement. Bonus points are recorded separately from the 100-point core total.
        </p>
      )}
      <div className="hidden grid-cols-12 gap-4 border-b border-slate-100 bg-slate-50 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
        <div className="col-span-3">Specific Judging Task</div>
        <div className="col-span-4">What the Judge Should Look For</div>
        <div className="col-span-3 text-center">Score (1-5)</div>
        <div className="col-span-2">Judge Note</div>
      </div>
      <div className="divide-y divide-slate-100">
        {section.criteria.map((c) => (
          <CriterionRow
            key={c.id}
            criterion={c}
            bonus={bonus}
            value={props.scores[c.id] ?? null}
            note={props.notes[c.id] ?? ''}
            scale={props.scale}
            readOnly={props.readOnly}
            missing={!!props.showMissing && !bonus && props.scores[c.id] == null}
            onScore={props.onScore}
            onNote={props.onNote}
          />
        ))}
      </div>
      {!bonus && (
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-600 sm:px-6">
          <span>{scored}/{section.criteria.length} rows scored</span>
          <span className="font-semibold text-slate-800">Section subtotal: <span className="tabular-nums">{subtotal}</span> / {section.weight}</span>
        </div>
      )}
    </Card>
  );
}

const CriterionRow = memo(function CriterionRow({
  criterion, value, note, scale, readOnly, missing, bonus, onScore, onNote,
}: {
  criterion: RubricCriterion; value: number | null; note: string; scale: ScoreLevel[]; readOnly?: boolean;
  missing?: boolean; bonus?: boolean;
  onScore?: (id: string, v: number | null) => void; onNote?: (id: string, v: string) => void;
}) {
  const labelId = `crit-${criterion.id}`;
  return (
    <div
      id={`row-${criterion.id}`}
      className={clsx('grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-12 lg:gap-4', missing && 'bg-rose-50/70 ring-1 ring-inset ring-rose-200', bonus && 'bg-amber-50/40')}
    >
      <div className="lg:col-span-3">
        <p id={labelId} className="text-sm font-semibold text-slate-900">{criterion.title}</p>
        {missing && <p className="mt-1 text-xs font-medium text-rose-600">Score required</p>}
      </div>
      <p className="text-sm leading-relaxed text-slate-600 lg:col-span-4">{criterion.description}</p>
      <div className="lg:col-span-3">
        <div role="radiogroup" aria-labelledby={labelId} className="flex items-center justify-start gap-1.5 lg:justify-center">
          {scale.map((s) => {
            const selected = value === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={readOnly}
                title={`${s.value} – ${s.label}: ${s.description}`}
                onClick={() => onScore?.(criterion.id, selected && bonus ? null : s.value)}
                className={clsx(
                  'flex h-11 w-11 flex-col items-center justify-center rounded-full text-base font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 sm:h-10 sm:w-10',
                  selected ? clsx(scoreColor(s.value), 'text-white shadow-sm ring-2 ring-offset-1 ring-slate-300') : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
                  readOnly && !selected && 'opacity-40',
                  readOnly && 'cursor-default',
                )}
              >
                {s.value}
              </button>
            );
          })}
          {bonus && !readOnly && value !== null && (
            <button type="button" className="ml-1 text-xs font-medium text-slate-500 underline hover:text-slate-800" onClick={() => onScore?.(criterion.id, null)}>
              Clear
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-slate-500 lg:text-center">
          {value ? `${value} · ${scale.find((s) => s.value === value)?.label}` : bonus ? 'Not scored (optional)' : 'Not scored'}
        </p>
      </div>
      <div className="lg:col-span-2">
        {readOnly ? (
          <p className="whitespace-pre-wrap text-sm text-slate-600">{note || <span className="text-slate-400">—</span>}</p>
        ) : (
          <Textarea
            rows={2}
            maxLength={4000}
            value={note}
            onChange={(e) => onNote?.(criterion.id, e.target.value)}
            placeholder="Judge note"
            aria-label={`Judge note for ${criterion.title}`}
            className="text-sm"
          />
        )}
      </div>
    </div>
  );
});

export function scoreColor(v: number) {
  return ['bg-rose-500', 'bg-orange-600', 'bg-amber-700', 'bg-brand-600', 'bg-emerald-600'][v - 1] ?? 'bg-slate-400';
}
