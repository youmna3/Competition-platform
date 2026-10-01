import { useState } from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  XCircle,
} from "lucide-react";
import { manageInvitation } from "@/lib/api";
import {
  buildUserImportRows,
  downloadUserCsv,
  readUserSpreadsheet,
  type ParsedUserImportRow,
} from "@/lib/importUsers";
import { errorMessage } from "@/lib/supabase";
import type { Governorate } from "@/lib/types";
import { Alert, Badge, Button, Modal } from "@/components/ui";

type Result = {
  row: number;
  fullName: string;
  email: string;
  governorate: string;
  status: "created" | "already_exists" | "failed";
  reason?: string;
};

export default function BulkUsersModal({
  open,
  governorates,
  onClose,
  onImported,
}: {
  open: boolean;
  governorates: Governorate[];
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState<ParsedUserImportRow[]>([]),
    [results, setResults] = useState<Result[]>([]);
  const [fileName, setFileName] = useState(""),
    [headerErrors, setHeaderErrors] = useState<string[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const reset = () => {
    setRows([]);
    setResults([]);
    setFileName("");
    setHeaderErrors([]);
    setError(null);
  };
  const close = () => {
    if (!busy) {
      reset();
      onClose();
    }
  };
  const choose = async (file?: File) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const records = await readUserSpreadsheet(file);
      let parsed = buildUserImportRows(records, governorates);
      if (!parsed.headerErrors.length) {
        const checked = await manageInvitation({
          action: "bulk-check-users",
          emails: parsed.rows.map((row) => row.email),
        });
        parsed = buildUserImportRows(
          records,
          governorates,
          new Set<string>(
            (checked.existingEmails ?? []).map((email: string) =>
              email.toLowerCase(),
            ),
          ),
        );
      }
      setRows(parsed.rows);
      setHeaderErrors(parsed.headerErrors);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const ready = rows.filter((row) => row.errors.length === 0).length;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await manageInvitation({
        action: "bulk-create-users",
        users: rows.map((row) => ({
          fullName: row.fullName,
          email: row.email,
          password: row.password,
          governorate: row.governorateCode || row.governorate,
        })),
      });
      setResults(response.results as Result[]);
      setRows([]);
      await onImported();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const failed = results.filter((result) => result.status !== "created");
  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload Users"
      size="xl"
      footer={
        results.length ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void create()}
              loading={busy}
              disabled={!ready}
            >
              Create {ready} user{ready === 1 ? "" : "s"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 p-3 text-sm">
          <span>
            CSV or Excel columns: <b>Full Name, Email, Password, Governorate</b>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => downloadUserCsv("judge-user-import-template.csv")}
          >
            <Download size={14} />
            Download Template
          </Button>
        </div>
        {!results.length && (
          <label className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed p-6">
            <FileSpreadsheet className="mb-2 text-slate-400" />
            <span className="text-sm font-medium">
              {fileName || "Choose CSV or Excel file"}
            </span>
            <input
              className="sr-only"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                void choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {headerErrors.length > 0 && (
          <Alert tone="error" title="Column problems">
            {headerErrors.join(". ")}
          </Alert>
        )}
        {rows.length > 0 && (
          <>
            <p className="text-sm">
              {rows.length} rows ·{" "}
              <b className="text-emerald-700">{ready} ready</b> ·{" "}
              <b className="text-rose-700">
                {rows.length - ready} need attention
              </b>
            </p>
            <div className="max-h-[48vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Full Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Governorate</th>
                    <th className="p-3">Status/check</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      className={row.errors.length ? "bg-rose-50" : ""}
                    >
                      <td className="p-3">{row.rowNumber}</td>
                      <td className="p-3">{row.fullName}</td>
                      <td className="p-3">{row.email}</td>
                      <td className="p-3">{row.governorateName}</td>
                      <td className="p-3">
                        {row.errors.length ? (
                          <span className="flex gap-1 text-rose-700">
                            <XCircle size={15} />
                            {row.errors.join("; ")}
                          </span>
                        ) : (
                          <span className="flex gap-1 text-emerald-700">
                            <CheckCircle2 size={15} />
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Alert tone="warning">
              Passwords are sent only to the secure account service after
              confirmation and are removed from this page when processing
              finishes.
            </Alert>
          </>
        )}
        {results.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">
                {results.filter((x) => x.status === "created").length} created
                successfully
              </Badge>
              <Badge tone="amber">
                {results.filter((x) => x.status === "already_exists").length}{" "}
                already exists
              </Badge>
              <Badge tone="red">
                {results.filter((x) => x.status === "failed").length} failed
              </Badge>
              {failed.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadUserCsv(
                      "failed-user-import.csv",
                      failed.map((x) => ({
                        fullName: x.fullName,
                        email: x.email,
                        password: "",
                        governorate: x.governorate,
                      })),
                    )
                  }
                >
                  <Download size={14} />
                  Download failed rows
                </Button>
              )}
            </div>
            <div className="max-h-[48vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Governorate</th>
                    <th className="p-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {results.map((result) => (
                    <tr key={`${result.row}-${result.email}`}>
                      <td className="p-3">{result.fullName}</td>
                      <td className="p-3">{result.email}</td>
                      <td className="p-3">{result.governorate}</td>
                      <td className="p-3">
                        <Badge
                          tone={
                            result.status === "created"
                              ? "green"
                              : result.status === "already_exists"
                                ? "amber"
                                : "red"
                          }
                        >
                          {result.status.replace("_", " ")}
                        </Badge>
                        {result.reason && (
                          <span className="ml-2 text-xs text-rose-700">
                            {result.reason}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
