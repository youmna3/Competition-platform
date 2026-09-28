import { useState } from 'react';
import { CheckCircle2, FileSpreadsheet, XCircle } from 'lucide-react';
import type { Reference } from '@/lib/api';
import { importTeams } from '@/lib/api';
import { buildImportRows, readSpreadsheet, TEMPLATE_HEADERS, type ParsedImportRow } from '@/lib/importTeams';
import { downloadImportTemplate } from '@/lib/exportResults';
import { errorMessage } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { Alert, Badge, Button, Modal, useToast } from '@/components/ui';

export default function ImportTeamsModal({ open, onClose, reference, judges, onImported }: {
  open: boolean; onClose: () => void; reference: Reference; judges: Profile[]; onImported: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [serverErrors, setServerErrors] = useState<{ row: number; message: string }[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const reset = () => {
    setFileName(''); setRows([]); setHeaderErrors([]); setServerErrors([]); setReadError(null); setReplace(false);
  };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      const records = await readSpreadsheet(file);
      const known = new Set(judges.map((j) => j.email.toLowerCase()));
      const res = buildImportRows(records, reference.levels, reference.governorates, known);
      setRows(res.rows);
      setHeaderErrors(res.headerErrors);
    } catch (e) {
      setReadError(errorMessage(e));
    }
  };

  const invalid = rows.filter((r) => r.errors.length > 0);
  const canImport = rows.length > 0 && invalid.length === 0 && headerErrors.length === 0;

  const run = async () => {
    setBusy(true);
    setServerErrors([]);
    try {
      const res = await importTeams(
        rows.map(({ team_code, name, project_name, level_code, governorate, judge_emails }) => ({ team_code, name, project_name, level_code, governorate, judge_emails })),
        replace,
      );
      if (!res.ok) {
        setServerErrors(res.errors);
        return;
      }
      toast('success', `Imported: ${res.inserted} new, ${res.updated} updated, ${res.assignments_added} judge assignments added`);
      await onImported();
      reset();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const levelLabel = (code: string) => reference.levels.find((l) => l.code === code);
  const govName = (code: string) => reference.governorates.find((g) => g.code === code)?.name ?? code;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bulk import teams"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={!canImport} loading={busy}>Import {rows.length || ''} team{rows.length === 1 ? '' : 's'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p>
            Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file with the columns:{' '}
            {TEMPLATE_HEADERS.map((h, i) => <span key={h}><code className="rounded bg-white px-1 py-0.5 text-xs">{h}</code>{i < TEMPLATE_HEADERS.length - 1 ? ', ' : ''}</span>)}.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
            <li>Organization: DEMI or DECI. Grade or Level: Grade 4, Grade 5, Level 1, Level 2, Level 3, Level 4 or Level 5.</li>
            <li>Governorate: Alexandria, Cairo, Monufia, Assiut or Suez.</li>
            <li>Judge Emails (optional): e-mails of approved judges separated by “;”. Existing Team IDs are updated.</li>
            <li>The import is all-or-nothing: if any row is invalid, nothing is written.</li>
          </ul>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void downloadImportTemplate()}><FileSpreadsheet size={14} /> Download template</Button>
        </div>

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-brand-400 hover:bg-brand-50/40">
          <FileSpreadsheet className="mb-2 h-8 w-8 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">{fileName || 'Choose a CSV or Excel file'}</span>
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>

        {readError && <Alert tone="error" title="Could not read the file">{readError}</Alert>}
        {headerErrors.length > 0 && <Alert tone="error" title="Column problems">{headerErrors.join('. ')}</Alert>}
        {serverErrors.length > 0 && (
          <Alert tone="error" title="The server rejected the import (nothing was written)">
            <ul className="list-disc pl-4">{serverErrors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
          </Alert>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-700">
                {rows.length} rows · {invalid.length === 0 ? <span className="font-medium text-emerald-700">all valid</span> : <span className="font-medium text-rose-700">{invalid.length} with errors</span>}
              </p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Replace existing judge assignments for these teams
              </label>
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">#</th><th className="px-3 py-2">Team ID</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Project</th>
                    <th className="px-3 py-2">Category</th><th className="px-3 py-2">Governorate</th><th className="px-3 py-2">Judges</th><th className="px-3 py-2">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const l = levelLabel(r.level_code);
                    return (
                      <tr key={r.rowNumber} className={r.errors.length ? 'bg-rose-50' : ''}>
                        <td className="px-3 py-2 text-slate-400">{r.rowNumber}</td>
                        <td className="px-3 py-2 font-mono">{r.team_code}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2">{r.project_name}</td>
                        <td className="px-3 py-2">{l ? `${l.organization} ${l.label}` : `${r.organization} ${r.gradeLevel}`}</td>
                        <td className="px-3 py-2">{govName(r.governorate)}</td>
                        <td className="px-3 py-2">{r.judge_emails.length ? r.judge_emails.map((e) => <Badge key={e} className="mb-0.5 mr-0.5">{e}</Badge>) : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2">
                          {r.errors.length ? (
                            <span className="flex items-start gap-1 text-rose-700"><XCircle size={12} className="mt-0.5 shrink-0" />{r.errors.join('; ')}</span>
                          ) : <CheckCircle2 size={14} className="text-emerald-600" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
