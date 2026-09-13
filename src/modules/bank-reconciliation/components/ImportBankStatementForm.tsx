"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";

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

type MappingState = {
  date: string;
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
  const base = { date: mapping.date, description: mapping.description, referenceNo: mapping.referenceNo || undefined };
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
    description: "",
    amountMode: "amount",
    amount: "",
    debit: "",
    credit: "",
    referenceNo: "",
  });
  const [appliedMapping, setAppliedMapping] = useState<Record<string, string | undefined> | null>(null);

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
    if (!accountId || !periodStart || !periodEnd || !openingBalance || !closingBalance) {
      setError("Please fill in account, period, and opening/closing balance.");
      return;
    }
    if (!file) {
      setError("Please choose a CSV file to upload.");
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
          description: detected.description ?? "",
          amountMode: detected.amount ? "amount" : "debitCredit",
          amount: detected.amount ?? "",
          debit: detected.debit ?? "",
          credit: detected.credit ?? "",
          referenceNo: detected.referenceNo ?? "",
        });
        setAppliedMapping(null);
        setStep("mapping");
        return;
      }

      if (status !== 200) {
        setError(json.error ?? "Failed to parse the CSV file.");
        return;
      }

      setAppliedMapping(null);
      setPreviewLines(json.data.lines);
      setStep("preview");
    });
  }

  function handleApplyMapping() {
    setError(null);
    if (!mapping.date || !mapping.description) {
      setError("Date and description columns are required.");
      return;
    }
    if (mapping.amountMode === "amount" && !mapping.amount) {
      setError("An amount column is required.");
      return;
    }
    if (mapping.amountMode === "debitCredit" && !mapping.debit && !mapping.credit) {
      setError("At least one of debit/credit column is required.");
      return;
    }

    const columnMapping = buildColumnMapping(mapping);

    startTransition(async () => {
      const { status, json } = await parseCsv(true, columnMapping);

      if (status !== 200) {
        setError(json.error ?? "Failed to parse the CSV file with this column mapping.");
        return;
      }

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
    <div className="space-y-4 rounded-lg border border-border p-4">
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
                Bank account
              </label>
              <select
                id="accountId"
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
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="file">
                CSV file
              </label>
              <input
                id="file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="periodStart">
                Period start
              </label>
              <input
                id="periodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="periodEnd">
                Period end
              </label>
              <input
                id="periodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="openingBalance">
                Opening balance
              </label>
              <input
                id="openingBalance"
                type="number"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="closingBalance">
                Closing balance
              </label>
              <input
                id="closingBalance"
                type="number"
                step="0.01"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" disabled={isPending} onClick={handleParse}>
            {isPending ? "Parsing..." : "Parse CSV"}
          </Button>
        </div>
      )}

      {step === "mapping" && (
        <div className="space-y-4">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            The CSV&apos;s columns couldn&apos;t be auto-detected. Map each field to a column
            below.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="mapDate">
                Date column
              </label>
              <select
                id="mapDate"
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
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="mapDescription">
                Description column
              </label>
              <select
                id="mapDescription"
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
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="mapDebit">
                  Debit column
                </label>
                <select
                  id="mapDebit"
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
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="mapCredit">
                  Credit column
                </label>
                <select
                  id="mapCredit"
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

          {error && <p className="text-sm text-destructive">{error}</p>}

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

          {error && <p className="text-sm text-destructive">{error}</p>}

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
