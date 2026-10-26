"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { VoucherType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { AccountPicker } from "@/components/shared/AccountPicker";
import { BalanceSummary, toPaisa } from "@/components/shared/BalanceSummary";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import {
  CREDIT_VOUCHER_SECTOR_CODES,
  CREDIT_VOUCHER_SECTOR_LABELS,
  type CreditVoucherSector,
} from "@/modules/accounting/constants/sector";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";
import type { BranchOption } from "@/modules/core/services/branch.service";
import Link from "next/link";

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
  const [sector, setSector] = useState<CreditVoucherSector | "">("");
  const [amount, setAmount] = useState("");
  const [chosenDirection, setChosenDirection] = useState<Direction>("in");
  const [initialValues] = useState(
    () => JSON.stringify({ date, description, branchId, cashBankAccountId, otherAccountId, sector, amount, chosenDirection })
  );
  const isDirty =
    JSON.stringify({ date, description, branchId, cashBankAccountId, otherAccountId, sector, amount, chosenDirection }) !==
    initialValues;
  const { markSubmitted } = useUnsavedChangesWarning(isDirty);

  const effectiveDirection = direction === "user-choice" ? chosenDirection : direction;
  const otherAccounts = accounts.filter((a) => a.id !== cashBankAccountId);
  const amountPaisa = toPaisa(Number(amount) || 0);

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
      ...(voucherType === "CREDIT_VOUCHER" ? { sector: sector || null } : {}),
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

      markSubmitted();
      router.push("/accounting/journal-entries");
      router.refresh();
    });
  };

  const title =
    voucherType === "CASH_VOUCHER"
      ? "New Cash Voucher"
      : voucherType === "CREDIT_VOUCHER"
        ? "New Credit Voucher"
        : "New Debit Voucher";

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Record a Cash or Bank transaction and its matching account." />
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

      {voucherType === "CREDIT_VOUCHER" && (
        <div>
          <label className="text-sm font-medium" htmlFor="sector">Sector</label>
          <select
            id="sector"
            value={sector}
            onChange={(event) =>
              setSector(CREDIT_VOUCHER_SECTOR_CODES.find((code) => code === event.target.value) ?? "")
            }
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm sm:max-w-md"
          >
            <option value="">No sector</option>
            {CREDIT_VOUCHER_SECTOR_CODES.map((code) => (
              <option key={code} value={code}>{CREDIT_VOUCHER_SECTOR_LABELS[code]}</option>
            ))}
          </select>
        </div>
      )}
      </Card>

      <Card title="Entries">
      <div className="grid gap-4 sm:grid-cols-2">
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
              onChange={setCashBankAccountId}
            />
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="otherAccountId">{otherAccountLabel} *</label>
          {otherAccounts.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No other accounts available. <Link className="underline" href="/accounting/chart-of-accounts">Create one</Link>.
            </p>
          ) : (
            <AccountPicker
              id="otherAccountId"
              options={otherAccounts}
              value={otherAccountId}
              onChange={setOtherAccountId}
            />
          )}
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
          Amount *
        </label>
        <input
          id="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums sm:max-w-md"
        />
      </div>
      <BalanceSummary debitPaisa={amountPaisa} creditPaisa={amountPaisa} />
      </Card>

      <Card title="Notes">
        <div>
          <label className="text-sm font-medium" htmlFor="description">Description *</label>
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
        <Button type="submit" disabled={isPending}>
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
