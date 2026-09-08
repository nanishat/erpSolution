"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";
import type { OpenInvoiceOption } from "@/modules/payments/services/payment.service";
import { recordPaymentSchema } from "@/modules/payments/validations/payment.schema";

type PartnerOption = { id: string; name: string; type: "CUSTOMER" | "VENDOR" };

/**
 * General multi-invoice/bill payment form — distinct from
 * invoicing/RecordPaymentForm.tsx (the legacy single-invoice adapter, kept
 * unchanged for /accounting/invoices/[id]/payments/new and
 * /accounting/vendor-bills/[id]/payments/new). Posts straight to the
 * general POST /api/payments, letting one payment settle any number of a
 * partner's open invoices/bills at once, with any leftover recorded as a
 * PartnerCredit server-side.
 *
 * Matching is manual only, same convention already locked for
 * applyPartnerCredit and Cash Voucher direction — no auto-suggest/FIFO
 * pre-fill of the amountApplied rows.
 */
export function RecordPaymentForm({
  partners,
  accounts,
  branches,
}: {
  partners: PartnerOption[];
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const cashBankAccounts = accounts.filter((a) => a.subType === "CASH" || a.subType === "BANK");

  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState("");
  const [cashBankAccountId, setCashBankAccountId] = useState(
    cashBankAccounts.length === 1 ? cashBankAccounts[0].id : ""
  );
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");

  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceOption[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const selectedPartner = partners.find((p) => p.id === partnerId) ?? null;

  useEffect(() => {
    setAllocations({});
    if (!partnerId) {
      setOpenInvoices([]);
      return;
    }
    setIsLoadingInvoices(true);
    fetch(`/api/partners/${partnerId}/open-invoices`)
      .then((res) => res.json())
      .then((json) => setOpenInvoices(json.data ?? []))
      .finally(() => setIsLoadingInvoices(false));
  }, [partnerId]);

  const totalAllocated = Object.values(allocations).reduce((sum, value) => {
    const parsed = Number(value);
    return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }, 0);
  const numericAmount = Number(amount) || 0;
  const leftover = Math.round((numericAmount - totalAllocated) * 100) / 100;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const allocationRows = Object.entries(allocations)
      .filter(([, value]) => Number(value) > 0)
      .map(([invoiceId, value]) => ({ invoiceId, amountApplied: Number(value) }));

    const payload = {
      partnerId,
      branchId,
      amount,
      date: date ? new Date(date) : undefined,
      method: method || undefined,
      reference: reference || undefined,
      cashBankAccountId,
      allocations: allocationRows,
    };

    const parsed = recordPaymentSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please fix the errors below.");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to record payment.");
        return;
      }

      router.push(selectedPartner?.type === "VENDOR" ? "/accounting/vendor-bills" : "/accounting/invoices");
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
          <label className="text-sm font-medium" htmlFor="partnerId">
            Partner
          </label>
          <select
            id="partnerId"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select partner
            </option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {`${partner.name} (${partner.type === "CUSTOMER" ? "Customer" : "Vendor"})`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="amount">
            Total amount
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
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
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
                {branch.name}
              </option>
            ))}
          </select>
        </div>
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      {partnerId && (
        <div>
          <p className="mb-2 text-sm font-medium">
            {selectedPartner?.type === "VENDOR" ? "Open bills" : "Open invoices"}
          </p>
          {isLoadingInvoices && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!isLoadingInvoices && openInvoices.length === 0 && (
            <p className="text-sm text-muted-foreground">No open invoices for this partner.</p>
          )}
          {!isLoadingInvoices && openInvoices.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Invoice #</th>
                  <th className="py-1.5 pr-2 font-medium">Date</th>
                  <th className="py-1.5 pr-2 font-medium">Remaining</th>
                  <th className="py-1.5 pr-2 font-medium">Amount to apply</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2">{invoice.invoiceNumber}</td>
                    <td className="py-1.5 pr-2">{new Date(invoice.date).toLocaleDateString()}</td>
                    <td className="py-1.5 pr-2">{invoice.remainingBalance.toFixed(2)}</td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={invoice.remainingBalance}
                        value={allocations[invoice.id] ?? ""}
                        onChange={(e) =>
                          setAllocations((prev) => ({ ...prev, [invoice.id]: e.target.value }))
                        }
                        className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        <p>
          Allocated: {totalAllocated.toFixed(2)} / Entered: {numericAmount.toFixed(2)}
        </p>
        {leftover > 0 && (
          <p className="text-muted-foreground">
            Leftover of {leftover.toFixed(2)} will be recorded as partner credit.
          </p>
        )}
        {leftover < 0 && (
          <p className="text-destructive">
            Allocations exceed the entered amount by {Math.abs(leftover).toFixed(2)}.
          </p>
        )}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Record payment"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/accounting")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
