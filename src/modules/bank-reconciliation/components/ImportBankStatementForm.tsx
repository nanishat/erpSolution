"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/shared/FieldError";
import { focusFirstFieldError } from "@/components/shared/form-validation";
import { useFieldErrors } from "@/components/shared/useFieldErrors";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import { importBankStatementSchema } from "@/modules/bank-reconciliation/validations/bank-reconciliation.schema";

type Step = "form" | "mapping" | "preview";

type DetectedColumns = {
  date?: string;
  description?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  referenceNo?: string;
};

// Matches ParsedBankStatementLine from bank-statement-csv-parser.ts, minus
// `date` being a JS Date server-side — it crosses the wire as an ISO string.
type PreviewLine = {
  date: string;
  description: string;
  amount: number;
  referenceNo?: string;
};

type AmountMode = "amount" | "debitCredit";
type DateFormat = "ISO" | "DMY" | "MDY";

type MappingState = {
  date: string;
  dateFormat: DateFormat | "";
  description: string;
  amountMode: AmountMode;
  amount: string;
  debit: string;
  credit: string;
  referenceNo: string;
};

const IMPORT_CSV_URL = "/api/bank-reconciliation/statements/import-csv";

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// Only ever sends amount OR debit/credit, never both — resolveMapping on the
// server rejects a mapping that specifies neither, and importBankStatement
// itself has no concept of "both" (the parser already collapsed debit/credit
// into a single signed amount per line before this mapping is even built).
function buildColumnMapping(mapping: MappingState): Record<string, string | undefined> {
  const base = {
    date: mapping.date,
    dateFormat: mapping.dateFormat || undefined,
    description: mapping.description,
    referenceNo: mapping.referenceNo || undefined,
  };
  return mapping.amountMode === "amount"
    ? { ...base, amount: mapping.amount }
    : { ...base, debit: mapping.debit || undefined, credit: mapping.credit || undefined };
}

/**
 * Multi-step import flow: fill in the statement header fields, upload a CSV,
 * resolve a column-mapping step if Part C's auto-detection couldn't resolve
 * one, preview the parsed lines (with a client-computed balance check so a
 * mismatch is visible before submitting, not just after a rejected commit),
 * then confirm. Every parse before the final confirm is a `dryRun` call
 * against the same import-csv route (see its own doc comment) — nothing is
 * written to the database until the last step's submit.
 */
export function ImportBankStatementForm({ accounts }: { accounts: ChartOfAccountOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { fieldErrors, setFieldErrors, showIssues, clearEditedField } = useFieldErrors("CSV row");
  const [step, setStep] = useState<Step>("form");

  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<MappingState>({
    date: "",
    dateFormat: "",
    description: "",
    amountMode: "amount",
    amount: "",
    debit: "",
    credit: "",
    referenceNo: "",
  });
  const [appliedMapping, setAppliedMapping] = useState<Record<string, string | undefined> | null>(null);
  const [dateFormatRequired, setDateFormatRequired] = useState(false);

  const [previewLines, setPreviewLines] = useState<PreviewLine[]>([]);

  async function parseCsv(dryRunOnly: boolean, columnMapping?: Record<string, string | undefined>) {
    const formData = new FormData();
    formData.append("file", file!);
    if (columnMapping) {
      formData.append("columnMapping", JSON.stringify(columnMapping));
    }
    if (dryRunOnly) {
      formData.append("dryRun", "true");
    } else {
      formData.append("accountId", accountId);
      formData.append("periodStart", periodStart);
      formData.append("periodEnd", periodEnd);
      formData.append("openingBalance", openingBalance);
      formData.append("closingBalance", closingBalance);
    }
    const res = await fetch(IMPORT_CSV_URL, { method: "POST", body: formData });
    const json = await res.json();
    return { ok: res.ok, status: res.status, json };
  }

  function handleParse() {
    setError(null);
    if (!accountId) {
      showIssues([{ path: ["accountId"], message: "Select an account." }]);
      return;
    }
    if (!periodStart) {
      showIssues([{ path: ["periodStart"], message: "Enter a valid period start date." }]);
      return;
    }
    if (!periodEnd) {
      showIssues([{ path: ["periodEnd"], message: "Enter a valid period end date." }]);
      return;
    }
    if (!openingBalance) {
      showIssues([{ path: ["openingBalance"], message: "Enter an opening balance." }]);
      return;
    }
    if (!closingBalance) {
      showIssues([{ path: ["closingBalance"], message: "Enter a closing balance." }]);
      return;
    }
    if (!file) {
      showIssues([{ path: ["file"], message: "Choose a CSV file to upload." }]);
      return;
    }

    startTransition(async () => {
      const { status, json } = await parseCsv(true);

      if (status === 422 && json.needsColumnMapping) {
        const detected: DetectedColumns = json.detected ?? {};
        setHeaders(json.headers ?? []);
        setSampleRows(json.sampleRows ?? []);
        setMapping({
          date: detected.date ?? "",
          dateFormat: "",
          description: detected.description ?? "",
          amountMode: detected.amount ? "amount" : "debitCredit",
          amount: detected.amount ?? "",
          debit: detected.debit ?? "",
          credit: detected.credit ?? "",
          referenceNo: detected.referenceNo ?? "",
        });
        setAppliedMapping(null);
        setDateFormatRequired(json.dateFormatRequired === true);
        setStep("mapping");
        return;
      }

      if (status !== 200) {
        setError(json.error ?? "Failed to parse the CSV file.");
        return;
      }

      setAppliedMapping(null);
      setDateFormatRequired(false);
      setPreviewLines(json.data.lines);
      setStep("preview");
    });
  }

  function handleApplyMapping() {
    setError(null);
    if (!mapping.date || !mapping.description) {
      showIssues([{ path: [!mapping.date ? "mapDate" : "mapDescription"], message: "Select a column." }]);
      return;
    }
    if (mapping.amountMode === "amount" && !mapping.amount) {
      showIssues([{ path: ["mapAmount"], message: "Select an amount column." }]);
      return;
    }
    if (mapping.amountMode === "debitCredit" && !mapping.debit && !mapping.credit) {
      showIssues([{ path: ["mapDebit"], message: "Select a debit or credit column." }]);
      return;
    }
    if (dateFormatRequired && !mapping.dateFormat) {
      showIssues([{ path: ["mapDateFormat"], message: "Choose a date format to continue." }]);
      return;
    }

    const columnMapping = buildColumnMapping(mapping);

    startTransition(async () => {
      const { status, json } = await parseCsv(true, columnMapping);

      if (status !== 200) {
        if (status === 422 && json.dateFormatRequired === true) {
          setDateFormatRequired(true);
        }
        setError(json.error ?? "Failed to parse the CSV file with this column mapping.");
        return;
      }

      setDateFormatRequired(false);
      setAppliedMapping(columnMapping);
      setPreviewLines(json.data.lines);
      setStep("preview");
    });
  }

  const linesSum = roundCurrency(previewLines.reduce((sum, line) => sum + line.amount, 0));
  const numericOpening = Number(openingBalance) || 0;
  const numericClosing = Number(closingBalance) || 0;
  const expectedClosing = roundCurrency(numericOpening + linesSum);
  const discrepancy = roundCurrency(expectedClosing - numericClosing);
  const balances = discrepancy === 0;

  function handleSubmit() {
    setError(null);
    const parsed = importBankStatementSchema.safeParse({
      accountId,
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
      lines: previewLines.map((line) => ({
        date: line.date,
        description: line.description,
        amount: line.amount,
        referenceNo: line.referenceNo,
      })),
    });
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) =>
        issue.path[0] === "lines" && typeof issue.path[1] === "number"
          ? { ...issue, path: ["file"], message: `CSV row ${issue.path[1] + 1}: ${issue.message}` }
          : issue
      );
      setStep("form");
      showIssues(issues);
      requestAnimationFrame(() =>
        focusFirstFieldError(
          Object.fromEntries(issues.map((issue) => [issue.path.map(String).join("."), issue.message]))
        )
      );
      return;
    }
    startTransition(async () => {
      const { ok, json } = await parseCsv(false, appliedMapping ?? undefined);

      if (!ok) {
        setError(json.error ?? "Import failed.");
        return;
      }

      router.push("/accounting/bank-reconciliation");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4" onChange={clearEditedField}>
      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {accounts.length === 0 && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          No active, reconcilable account exists in the Chart of Accounts.
        </p>
      )}

      {step === "form" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="accountId">
                Bank account *
              </label>
              <select
                id="accountId"
                name="accountId"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Select account
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {`${account.code} — ${account.name}`}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.accountId} />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="file">
                CSV file
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <FieldError message={fieldErrors.file} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="mapDateFormat">
              Date format
            </label>
            <select
              id="mapDateFormat"
              name="mapDateFormat"
              value={mapping.dateFormat}
              onChange={(e) =>
                setMapping((prev) => ({ ...prev, dateFormat: e.target.value as DateFormat | "" }))
              }
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Auto-detect</option>
              <option value="ISO">ISO (YYYY-MM-DD)</option>
              <option value="DMY">DMY (DD/MM/YYYY)</option>
              <option value="MDY">MDY (MM/DD/YYYY)</option>
            </select>
            <FieldError message={fieldErrors.mapDateFormat} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="periodStart">
                Period start *
              </label>
              <input
                id="periodStart"
                name="periodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <FieldError message={fieldErrors.periodStart} />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="periodEnd">
                Period end *
              </label>
              <input
                id="periodEnd"
                name="periodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <FieldError message={fieldErrors.periodEnd} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="openingBalance">
                Opening balance *
              </label>
              <input
                id="openingBalance"
                name="openingBalance"
                type="number"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <FieldError message={fieldErrors.openingBalance} />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="closingBalance">
                Closing balance *
              </label>
              <input
                id="closingBalance"
                name="closingBalance"
                type="number"
                step="0.01"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <FieldError message={fieldErrors.closingBalance} />
            </div>
          </div>

          <Button type="button" disabled={isPending} onClick={handleParse}>
            {isPending ? "Parsing..." : "Parse CSV"}
          </Button>
        </div>
      )}

      {step === "mapping" && (
        <div className="space-y-4">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            {dateFormatRequired
              ? "Date values are ambiguous. Choose a date format below."
              : "The CSV's columns couldn't be auto-detected. Map each field to a column below."}
          </p>
          <p className="text-xs text-muted-foreground">Match each statement field to the column that contains its values.</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="mapDate">
                Date column
              </label>
              <select
                id="mapDate"
                name="mapDate"
                value={mapping.date}
                onChange={(e) => setMapping((prev) => ({ ...prev, date: e.target.value }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Select column
                </option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.mapDate} />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="mapDescription">
                Description column
              </label>
              <select
                id="mapDescription"
                name="mapDescription"
                value={mapping.description}
                onChange={(e) => setMapping((prev) => ({ ...prev, description: e.target.value }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Select column
                </option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.mapDescription} />
            </div>
          </div>

          <div>
            <span className="text-sm font-medium">Amount columns</span>
            <div className="mt-1 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mapping.amountMode === "amount"}
                  onChange={() => setMapping((prev) => ({ ...prev, amountMode: "amount" }))}
                />
                Single signed amount column
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mapping.amountMode === "debitCredit"}
                  onChange={() => setMapping((prev) => ({ ...prev, amountMode: "debitCredit" }))}
                />
                Separate debit / credit columns
              </label>
            </div>
          </div>

          {mapping.amountMode === "amount" ? (
            <div>
              <label className="text-sm font-medium" htmlFor="mapAmount">
                Amount column
              </label>
              <select
                id="mapAmount"
                name="mapAmount"
                value={mapping.amount}
                onChange={(e) => setMapping((prev) => ({ ...prev, amount: e.target.value }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Select column
                </option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.mapAmount} />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="mapDebit">
                  Debit column
                </label>
                <select
                  id="mapDebit"
                  name="mapDebit"
                  value={mapping.debit}
                  onChange={(e) => setMapping((prev) => ({ ...prev, debit: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.mapDebit} />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="mapCredit">
                  Credit column
                </label>
                <select
                  id="mapCredit"
                  name="mapCredit"
                  value={mapping.credit}
                  onChange={(e) => setMapping((prev) => ({ ...prev, credit: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.mapCredit} />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium" htmlFor="mapReferenceNo">
              Reference column (optional)
            </label>
            <select
              id="mapReferenceNo"
              value={mapping.referenceNo}
              onChange={(e) => setMapping((prev) => ({ ...prev, referenceNo: e.target.value }))}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">None</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </div>

          {sampleRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    {headers.map((header) => (
                      <th key={header} className="px-2 py-1.5">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-border">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-1.5">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" disabled={isPending} onClick={handleApplyMapping}>
              {isPending ? "Parsing..." : "Apply mapping"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep("form")}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Reference</th>
                </tr>
              </thead>
              <tbody>
                {previewLines.map((line, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(line.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{line.description}</td>
                    <td className="px-3 py-2 text-right">{line.amount.toFixed(2)}</td>
                    <td className="px-3 py-2">{line.referenceNo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className={`rounded-md px-3 py-2 text-sm ${balances ? "bg-muted/50" : "bg-destructive/10 text-destructive"}`}
          >
            {balances ? (
              <p>{`Opening (${numericOpening.toFixed(2)}) + ${previewLines.length} line(s) totaling ${linesSum.toFixed(2)} = ${expectedClosing.toFixed(2)}, matching the stated closing balance.`}</p>
            ) : (
              <p>{`Opening (${numericOpening.toFixed(2)}) + ${previewLines.length} line(s) totaling ${linesSum.toFixed(2)} = ${expectedClosing.toFixed(2)}, which does not match the stated closing balance (${numericClosing.toFixed(2)}). Discrepancy: ${discrepancy > 0 ? "+" : ""}${discrepancy.toFixed(2)}. Adjust the closing balance or fix the CSV before importing.`}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="button" disabled={isPending || !balances} onClick={handleSubmit}>
              {isPending ? "Importing..." : "Confirm import"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep(headers.length > 0 ? "mapping" : "form")}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
