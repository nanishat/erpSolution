"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { VoucherType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";
import type { BranchOption } from "@/modules/core/services/branch.service";

type Direction = "in" | "out";

/**
 * Shared plumbing behind the Cash/Debit/Credit Voucher forms — all three are
 * "one side fixed to a Cash/Bank account, pick the other side, pick a
 * direction" and differ only in labels and whether direction is fixed or
 * user-chosen. Builds the same 2-line JournalEntryInput shape
 * JournalEntryForm would and posts it through the same
 * POST /api/journal-entries route — no separate creation logic.
 */
export function CashBankVoucherForm({
  voucherType,
  otherAccountLabel,
  direction,
  accounts,
  branches,
}: {
  voucherType: VoucherType;
  otherAccountLabel: string;
  /** "in"/"out" fixes the direction (Debit/Credit Voucher); "user-choice" shows a toggle (Cash Voucher). */
  direction: Direction | "user-choice";
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const cashBankAccounts = accounts.filter((a) => a.subType === "CASH" || a.subType === "BANK");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [branchId, setBranchId] = useState("");
  const [cashBankAccountId, setCashBankAccountId] = useState(
    cashBankAccounts.length === 1 ? cashBankAccounts[0].id : ""
  );
  const [otherAccountId, setOtherAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [chosenDirection, setChosenDirection] = useState<Direction>("in");

  const effectiveDirection = direction === "user-choice" ? chosenDirection : direction;
  const otherAccounts = accounts.filter((a) => a.id !== cashBankAccountId);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const numericAmount = Number(amount);
    if (!cashBankAccountId) {
      setFormError("Select a Cash/Bank account.");
      return;
    }
    if (!otherAccountId) {
      setFormError(`Select ${otherAccountLabel.toLowerCase()}.`);
      return;
    }
    if (cashBankAccountId === otherAccountId) {
      setFormError("The two accounts must be different.");
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
    if (!(numericAmount > 0)) {
      setFormError("Amount must be greater than zero.");
      return;
    }

    // "in" = money coming into cash/bank (debit cash/bank, credit the other
    // account); "out" = money leaving cash/bank (credit cash/bank, debit the
    // other account).
    const cashBankLine =
      effectiveDirection === "in"
        ? { accountId: cashBankAccountId, branchId, debit: numericAmount, credit: 0, memo: "" }
        : { accountId: cashBankAccountId, branchId, debit: 0, credit: numericAmount, memo: "" };
    const otherLine =
      effectiveDirection === "in"
        ? { accountId: otherAccountId, branchId, debit: 0, credit: numericAmount, memo: "" }
        : { accountId: otherAccountId, branchId, debit: numericAmount, credit: 0, memo: "" };

    const payload: JournalEntryInput = {
      date: new Date(date),
      description,
      reference: undefined,
      branchId,
      voucherType,
      lines: [cashBankLine, otherLine],
    };

    startTransition(async () => {
      const res = await fetch("/api/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to create journal entry.");
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="cashBankAccountId">
            Cash / Bank Account
          </label>
          <select
            id="cashBankAccountId"
            value={cashBankAccountId}
            onChange={(e) => setCashBankAccountId(e.target.value)}
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
        <div>
          <label className="text-sm font-medium" htmlFor="otherAccountId">
            {otherAccountLabel}
          </label>
          <select
            id="otherAccountId"
            value={otherAccountId}
            onChange={(e) => setOtherAccountId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select account
            </option>
            {otherAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {direction === "user-choice" && (
        <div>
          <span className="text-sm font-medium">Direction</span>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="direction"
                checked={chosenDirection === "in"}
                onChange={() => setChosenDirection("in")}
              />
              Money In (receipt)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="direction"
                checked={chosenDirection === "out"}
                onChange={() => setChosenDirection("out")}
              />
              Money Out (payment)
            </label>
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium" htmlFor="amount">
          Amount
        </label>
        <input
          id="amount"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="description">
          Description
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
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Create journal entry"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/accounting")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
