import Link from "next/link";
import { notFound } from "next/navigation";

import { getJournalEntryById } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryTaxApplications } from "@/modules/accounting/components/JournalEntryTaxApplications";
import { InvoiceDetailActions } from "@/modules/invoicing/components/InvoiceDetailActions";
import { InvoiceStatusBadge } from "@/modules/invoicing/components/InvoiceStatusBadge";
import { PaymentHistoryTable } from "@/modules/invoicing/components/PaymentHistoryTable";
import { getInvoiceById } from "@/modules/invoicing/services/invoice.service";
import { listPartners } from "@/modules/partners/services/partner.service";
import { AddTaxApplicationForm } from "@/modules/tax/components/AddTaxApplicationForm";
import { listTaxRates } from "@/modules/tax/services/tax-rate.service";

export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/vendor-bills";

export default async function VendorBillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoiceById(id);

  if (!invoice) {
    notFound();
  }

  const journalEntry = await getJournalEntryById(invoice.journalEntryId);

  // Tax can only be attached before the bill's JournalEntry is posted — same
  // gate as the Customer Invoice detail page / JournalEntryDetailPage.
  const [partners, vatRates] =
    invoice.journalEntry.status === "DRAFT"
      ? await Promise.all([listPartners({ isActive: true }), listTaxRates({ type: "VAT" })])
      : [[], []];

  const remaining = invoice.grandTotal - invoice.amountPaid;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{invoice.invoiceNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <InvoiceStatusBadge status={invoice.status} />
            <span className="text-sm text-muted-foreground">{invoice.partner.name}</span>
          </div>
        </div>
        <InvoiceDetailActions
          entry={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            amountPaid: invoice.amountPaid,
            basePath: BASE_PATH,
          }}
        />
      </div>

      {invoice.status === "VOID" && invoice.journalEntry.reversedByEntry && (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          Reversed by{" "}
          <Link
            href={`/accounting/journal-entries/${invoice.journalEntry.reversedByEntry.id}`}
            className="font-mono text-primary underline-offset-4 hover:underline"
          >
            {invoice.journalEntry.reversedByEntry.documentNumber}
          </Link>
        </div>
      )}

      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Date</div>
          <div className="text-sm">{invoice.date.toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Due date</div>
          <div className="text-sm">{invoice.dueDate ? invoice.dueDate.toLocaleDateString() : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Branch</div>
          <div className="text-sm">
            {invoice.branch.name} ({invoice.branch.code})
          </div>
        </div>
        {invoice.notes && (
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="text-xs text-muted-foreground">Notes</div>
            <div className="text-sm">{invoice.notes}</div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit price</th>
              <th className="px-3 py-2 text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 text-right">{line.quantity.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{line.unitPrice.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{line.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg border border-border p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{invoice.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span>{invoice.taxTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 font-medium">
          <span>Grand total</span>
          <span>{invoice.grandTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Paid</span>
          <span>{invoice.amountPaid.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Remaining</span>
          <span>{remaining.toFixed(2)}</span>
        </div>
      </div>

      {journalEntry && <JournalEntryTaxApplications taxApplications={journalEntry.taxApplications} />}

      {invoice.journalEntry.status === "DRAFT" && (
        <AddTaxApplicationForm
          journalEntryId={invoice.journalEntryId}
          partners={partners}
          vatRates={vatRates}
        />
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Payments</h2>
        <PaymentHistoryTable payments={invoice.payments} />
      </div>

      <Link href={BASE_PATH} className="text-sm text-primary underline-offset-4 hover:underline">
        ← Back to vendor bills
      </Link>
    </div>
  );
}
