import Link from "next/link";
import { notFound } from "next/navigation";

import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { getJournalEntryById } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryForm } from "@/modules/accounting/components/JournalEntryForm";
import { getBranches } from "@/modules/core/services/branch.service";

const INVOICE_BASE_PATH = { CUSTOMER: "/accounting/invoices", VENDOR: "/accounting/vendor-bills" } as const;

export const dynamic = "force-dynamic";

export default async function EditJournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, accounts, branches] = await Promise.all([
    getJournalEntryById(id),
    getActiveChartOfAccounts(),
    getBranches(),
  ]);

  if (!entry) {
    notFound();
  }

  if (entry.status !== "DRAFT") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Edit journal entry</h1>
        <p className="text-sm text-destructive">
          {entry.documentNumber} is {entry.status.toLowerCase()} and can no longer be edited.
        </p>
      </div>
    );
  }

  // Mirrors the invoice-link guard in updateJournalEntry (which would
  // reject the submit either way) — surfaced here too so a user who
  // navigates straight to this URL doesn't fill out a form that can only
  // ever fail.
  if (entry.invoice) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Edit journal entry</h1>
        <p className="text-sm text-destructive">
          {entry.documentNumber} belongs to Invoice{" "}
          <Link
            href={`${INVOICE_BASE_PATH[entry.invoice.direction]}/${entry.invoice.id}`}
            className="underline-offset-4 hover:underline"
          >
            {entry.invoice.invoiceNumber}
          </Link>{" "}
          and cannot be edited directly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Edit journal entry</h1>
        <p className="text-sm text-muted-foreground">{entry.documentNumber}</p>
      </div>

      <JournalEntryForm mode="edit" entry={entry} accounts={accounts} branches={branches} />
    </div>
  );
}
