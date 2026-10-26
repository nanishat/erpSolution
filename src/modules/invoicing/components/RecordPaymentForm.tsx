"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { AccountPicker } from "@/components/shared/AccountPicker";
import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import { recordPaymentForInvoiceSchema } from "@/modules/payments/validations/payment.schema";
import Link from "next/link";

/**
 * Records a payment against one POSTED/PARTIALLY_PAID invoice — built now
 * rather than stubbed (flagged as a call in the task): recordPayment and its
 * POST /api/invoices/[id]/payments route already exist and are already
 * tested (payment-manual-test.ts), so this is just the missing UI layer on
 * top of a finished backend, same shape of gap AddTaxApplicationForm filled
 * for tax applications. POST /api/invoices/[id]/payments is now a thin
 * adapter over the general recordPayment (Phase 4's multi-invoice
 * allocation + overpayment credit ledger rework) — this form's shape is
 * unaffected, since branchId/partnerId/allocations are all derived
 * server-side from the invoiceId in the URL.
 */
export function RecordPaymentForm({
  invoiceId,
  remaining,
  accounts,
  detailHref,
  cancelHref,
  description,
}: {
  invoiceId: string;
  remaining: number;
  accounts: ChartOfAccountOption[];
  detailHref: string;
  cancelHref: string;
  description?: string;
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
  const [initialValues] = useState(
    () => JSON.stringify({ amount, date, method, reference, cashBankAccountId })
  );
  const isDirty =
    JSON.stringify({ amount, date, method, reference, cashBankAccountId }) !== initialValues;
  const { markSubmitted } = useUnsavedChangesWarning(isDirty);

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

    const parsed = recordPaymentForInvoiceSchema.safeParse(payload);
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

      markSubmitted();
      router.push(detailHref);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Record Payment" description={description ?? "Record a payment against this invoice or bill."} />
      <form onSubmit={onSubmit} className="space-y-6">
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      <Card title="Basic Details">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="amount">
            Amount * <span className="font-normal text-muted-foreground">(remaining: <Amount value={remaining} />)</span>
          </label>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max={remaining}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
          />
        </div>
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
      </div>
      </Card>

      <Card title="Payment Details">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="cashBankAccountId">Cash / Bank account *</label>
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
      </Card>

      <div className="flex items-center gap-4 border-t border-border pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save Payment"}
        </Button>
        <Link href={cancelHref} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Cancel
        </Link>
      </div>
      </form>
    </div>
  );
}
