"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import { recordPaymentSchema } from "@/modules/payments/validations/payment.schema";

/**
 * Records a payment against one POSTED/PARTIALLY_PAID invoice — built now
 * rather than stubbed (flagged as a call in the task): recordPayment and its
 * POST /api/invoices/[id]/payments route already exist and are already
 * tested (payment-manual-test.ts), so this is just the missing UI layer on
 * top of a finished backend, same shape of gap AddTaxApplicationForm filled
 * for tax applications.
 */
export function RecordPaymentForm({
  invoiceId,
  remaining,
  accounts,
  detailHref,
}: {
  invoiceId: string;
  remaining: number;
  accounts: ChartOfAccountOption[];
  detailHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const cashBankAccounts = accounts.filter((a) => a.subType === "CASH" || a.subType === "BANK");

  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [cashBankAccountId, setCashBankAccountId] = useState(
    cashBankAccounts.length === 1 ? cashBankAccounts[0].id : ""
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const payload = {
      amount,
      date: date ? new Date(date) : undefined,
      method: method || undefined,
      reference: reference || undefined,
      cashBankAccountId,
    };

    const parsed = recordPaymentSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please fix the errors below.");
      return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to record payment.");
        return;
      }

      router.push(detailHref);
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
          <label className="text-sm font-medium" htmlFor="amount">
            Amount (remaining: {remaining.toFixed(2)})
          </label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            max={remaining}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="cashBankAccountId">
            Cash / Bank account
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
          <label className="text-sm font-medium" htmlFor="method">
            Method
          </label>
          <input
            id="method"
            type="text"
            placeholder="Cash, Bank Transfer, Cheque, ..."
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="reference">
          Reference
        </label>
        <input
          id="reference"
          type="text"
          placeholder="Cheque number, transaction ref, ..."
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Record payment"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(detailHref)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
