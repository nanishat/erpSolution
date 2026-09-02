"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";

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

  const isBankAccount = cashBankAccounts.find((a) => a.id === cashBankAccountId)?.subType === "BANK";
  const lineAccounts = accounts.filter((a) => a.id !== cashBankAccountId);

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

      router.push("/accounting");
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border p-4">
      {cashBankAccounts.length === 0 && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          No active Cash or Bank account exists in the Chart of Accounts.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="date">
            Date
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
            Branch
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
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="cashBankAccountId">
          Cash / Bank Account
        </label>
        <select
          id="cashBankAccountId"
          value={cashBankAccountId}
          onChange={(e) => selectCashBankAccount(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="" disabled>
            Select account
          </option>
          {cashBankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={index} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Line {index + 1}</span>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium">Expense / Payable Account</label>
                <select
                  value={line.expenseAccountId}
                  onChange={(e) => updateLine(index, { expenseAccountId: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="" disabled>
                    Select account
                  </option>
                  {lineAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.amount}
                  onChange={(e) => updateLine(index, { amount: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            {isBankAccount && (
              <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
                <div>
                  <label className="text-sm font-medium">Drawn On (Bank Name)</label>
                  <input
                    type="text"
                    value={line.bankName}
                    onChange={(e) => updateLine(index, { bankName: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Cash/Cheque No</label>
                  <input
                    type="text"
                    value={line.chequeNo}
                    onChange={(e) => updateLine(index, { chequeNo: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Dated</label>
                  <input
                    type="date"
                    value={line.chequeDate}
                    onChange={(e) => updateLine(index, { chequeDate: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addLine}
        disabled={lines.length >= MAX_LINES}
      >
        Add another line
      </Button>

      <div>
        <label className="text-sm font-medium" htmlFor="description">
          Voucher Description
        </label>
        <input
          id="description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !canSubmit}>
          {isPending ? "Saving..." : "Create journal entry"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/accounting")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
