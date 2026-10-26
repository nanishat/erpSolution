"use client";

import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { AccountPicker } from "@/components/shared/AccountPicker";
import { BalanceSummary, toPaisa } from "@/components/shared/BalanceSummary";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";
import Link from "next/link";

const MAX_LINES = 5;

type LineState = {
  expenseAccountId: string;
  amount: string;
  description: string;
  bankName: string;
  chequeNo: string;
  chequeDate: string;
};

function emptyLine(): LineState {
  return { expenseAccountId: "", amount: "", description: "", bankName: "", chequeNo: "", chequeDate: "" };
}

// Debit Voucher records a payment/expense: 1-5 debit lines (Expense/Payable
// accounts) against one shared credit — the paying Cash/Bank account, for
// their combined total. When that Cash/Bank account is a Bank-type account,
// the paper form's Cash/Cheque No, Dated, and Drawn On fields are also
// collected. Posts to POST /api/debit-vouchers, not the generic
// /api/journal-entries route CashBankVoucherForm uses — the multi-line/
// single-credit shape and bank fields don't fit that generic 2-line schema.
export function DebitVoucherForm({
  accounts,
  branches,
}: {
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const cashBankAccounts = accounts.filter((a) => a.subType === "CASH" || a.subType === "BANK");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState("");
  const [description, setDescription] = useState("");
  const [cashBankAccountId, setCashBankAccountId] = useState(
    cashBankAccounts.length === 1 ? cashBankAccounts[0].id : ""
  );
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [initialValues] = useState(
    () => JSON.stringify({ date, branchId, description, cashBankAccountId, lines })
  );
  const isDirty =
    JSON.stringify({ date, branchId, description, cashBankAccountId, lines }) !== initialValues;
  const { markSubmitted } = useUnsavedChangesWarning(isDirty);

  const isBankAccount = cashBankAccounts.find((a) => a.id === cashBankAccountId)?.subType === "BANK";
  const lineAccounts = accounts.filter((a) => a.id !== cashBankAccountId);
  const totalPaisa = lines.reduce((sum, line) => sum + toPaisa(Number(line.amount) || 0), 0);

  const selectCashBankAccount = (id: string) => {
    setCashBankAccountId(id);
    const account = cashBankAccounts.find((a) => a.id === id);
    if (account?.subType !== "BANK") {
      setLines((prev) => prev.map((line) => ({ ...line, bankName: "", chequeNo: "", chequeDate: "" })));
    }
  };

  const updateLine = (index: number, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const addLine = () => {
    setLines((prev) => (prev.length >= MAX_LINES ? prev : [...prev, emptyLine()]));
  };

  const removeLine = (index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-line-cell")) return;
    const cells = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-line-cell]"));
    const cellIndex = cells.indexOf(target);
    if (cellIndex < 0) return;

    event.preventDefault();
    if (cellIndex < cells.length - 1) {
      cells[cellIndex + 1].focus();
      return;
    }

    if (lines.length >= MAX_LINES) return;
    const nextRowIndex = lines.length;
    addLine();
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-line-row="${nextRowIndex}"] [data-line-cell]`)
        ?.focus();
    });
  };

  const canSubmit =
    Boolean(cashBankAccountId) &&
    Boolean(branchId) &&
    description.trim().length > 0 &&
    lines.every((line) => line.expenseAccountId && Number(line.amount) > 0) &&
    (!isBankAccount || lines.every((line) => line.bankName.trim() && line.chequeNo.trim() && line.chequeDate));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!cashBankAccountId) {
      setFormError("Select a Cash/Bank account.");
      return;
    }
    if (!branchId) {
      setFormError("Select a branch.");
      return;
    }
    if (!description.trim()) {
      setFormError("Description is required.");
      return;
    }
    for (const line of lines) {
      if (!line.expenseAccountId) {
        setFormError("Select an account for every line.");
        return;
      }
      if (!(Number(line.amount) > 0)) {
        setFormError("Every line amount must be greater than zero.");
        return;
      }
      if (isBankAccount && (!line.bankName.trim() || !line.chequeNo.trim() || !line.chequeDate)) {
        setFormError("Bank Name, Cheque No, and Cheque Date are required on every line for a Bank account.");
        return;
      }
    }

    const payload = {
      date: new Date(date),
      branchId,
      description,
      cashBankAccountId,
      lines: lines.map((line) => ({
        expenseAccountId: line.expenseAccountId,
        amount: Number(line.amount),
        description: line.description.trim() || undefined,
        ...(isBankAccount
          ? {
              bankName: line.bankName.trim(),
              chequeNo: line.chequeNo.trim(),
              chequeDate: new Date(line.chequeDate),
            }
          : {}),
      })),
    };

    startTransition(async () => {
      const res = await fetch("/api/debit-vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to create debit voucher.");
        return;
      }

      markSubmitted();
      router.push("/accounting/journal-entries");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="New Debit Voucher" description="Record expenses or payments against a Cash or Bank account." />
      <form onSubmit={onSubmit} className="space-y-6">
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      <Card title="Basic Details">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="date">
            Date *
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="branchId">
            Branch *
          </label>
          <select
            id="branchId"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select branch
            </option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="cashBankAccountId">Cash / Bank Account *</label>
        {cashBankAccounts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No active Cash or Bank account. <Link className="underline" href="/accounting/chart-of-accounts">Create one</Link>.
          </p>
        ) : (
          <AccountPicker
            id="cashBankAccountId"
            options={cashBankAccounts}
            value={cashBankAccountId}
            onChange={selectCashBankAccount}
          />
        )}
      </div>
      </Card>

      <Card title="Entries">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Add each expense or payable as a separate entry.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          disabled={lines.length >= MAX_LINES}
        >
          Add another line
        </Button>
      </div>
      <div className="space-y-3" ref={gridRef} onKeyDown={handleGridKeyDown}>
        {lines.map((line, index) => (
          <div key={index} data-line-row={index} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Entry {index + 1}</h3>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove entry ${index + 1}`} onClick={() => removeLine(index)}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium" htmlFor={`expenseAccount-${index}`}>Expense / Payable Account *</label>
                {lineAccounts.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    No other accounts available. <Link className="underline" href="/accounting/chart-of-accounts">Create one</Link>.
                  </p>
                ) : (
                  <AccountPicker
                    id={`expenseAccount-${index}`}
                    options={lineAccounts}
                    value={line.expenseAccountId}
                    onChange={(expenseAccountId) => updateLine(index, { expenseAccountId })}
                  />
                )}
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor={`amount-${index}`}>Amount *</label>
                <input
                  id={`amount-${index}`}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={line.amount}
                  onChange={(e) => updateLine(index, { amount: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
                  data-line-cell
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor={`lineDescription-${index}`}>Description</label>
                <input
                  id={`lineDescription-${index}`}
                  type="text"
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  data-line-cell
                />
              </div>
            </div>

            {isBankAccount && (
              <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
                <div>
                  <label className="text-sm font-medium" htmlFor={`bankName-${index}`}>Drawn On (Bank Name) *</label>
                  <input
                    id={`bankName-${index}`}
                    type="text"
                    value={line.bankName}
                    onChange={(e) => updateLine(index, { bankName: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    data-line-cell
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor={`chequeNo-${index}`}>Cash/Cheque No *</label>
                  <input
                    id={`chequeNo-${index}`}
                    type="text"
                    value={line.chequeNo}
                    onChange={(e) => updateLine(index, { chequeNo: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    data-line-cell
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor={`chequeDate-${index}`}>Dated *</label>
                  <input
                    id={`chequeDate-${index}`}
                    type="date"
                    value={line.chequeDate}
                    onChange={(e) => updateLine(index, { chequeDate: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    data-line-cell
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <BalanceSummary debitPaisa={totalPaisa} creditPaisa={totalPaisa} />
      </Card>

      <Card title="Notes">
        <div>
          <label className="text-sm font-medium" htmlFor="description">Voucher Description *</label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </Card>

      <div className="flex items-center gap-4 border-t border-border pt-4">
        <Button type="submit" disabled={isPending || !canSubmit}>
          {isPending ? "Saving..." : "Save as Draft"}
        </Button>
        <Link href="/accounting/journal-entries" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Cancel
        </Link>
      </div>
      </form>
    </div>
  );
}
