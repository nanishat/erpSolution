import Link from "next/link";
import { notFound } from "next/navigation";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
import { getJournalEntryById } from "@/modules/accounting/services/journal-entry.service";
import { CREDIT_VOUCHER_SECTOR_CODES, CREDIT_VOUCHER_SECTOR_LABELS } from "@/modules/accounting/constants/sector";
import { JournalEntryTaxApplications } from "@/modules/accounting/components/JournalEntryTaxApplications";
import { InvoiceDetailActions } from "@/modules/invoicing/components/InvoiceDetailActions";
import { PaymentHistoryTable } from "@/modules/invoicing/components/PaymentHistoryTable";
import { getInvoiceById } from "@/modules/invoicing/services/invoice.service";
import { listPartners } from "@/modules/partners/services/partner.service";
import { AddTaxApplicationForm } from "@/modules/tax/components/AddTaxApplicationForm";
import { listTaxRates } from "@/modules/tax/services/tax-rate.service";

export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/invoices";

export default async function CustomerInvoiceDetailPage({
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
  const [partners, vatRates] =
    invoice.journalEntry.status === "DRAFT"
      ? await Promise.all([listPartners({ isActive: true }), listTaxRates({ type: "VAT" })])
      : [[], []];
  const sectorCode = CREDIT_VOUCHER_SECTOR_CODES.find((code) => code === invoice.sector);
  const sectorName = sectorCode ? CREDIT_VOUCHER_SECTOR_LABELS[sectorCode] : invoice.sector;
  const remaining = invoice.grandTotal - invoice.amountPaid;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            <span className="font-mono">{invoice.invoiceNumber}</span>
            <StatusBadge status={invoice.status} />
          </>
        }
        description={`Customer Invoice${sectorName ? ` · ${sectorName}` : ""} · ${invoice.date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`}
        actions={
          <InvoiceDetailActions
            entry={{
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: invoice.status,
              amountPaid: invoice.amountPaid,
              basePath: BASE_PATH,
            }}
            printUrl={`${BASE_PATH}/${invoice.id}/print`}
          />
        }
      />

      <Card title="Invoice details">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Date</dt>
            <dd className="text-sm">{invoice.date.toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Due date</dt>
            <dd className="text-sm">{invoice.dueDate?.toLocaleDateString() ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Customer</dt>
            <dd className="text-sm">
              <Link href={`/accounting/partners/${invoice.partner.id}/edit`} className="text-primary underline-offset-4 hover:underline">
                {invoice.partner.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Branch</dt>
            <dd className="text-sm">{invoice.branch.name}</dd>
          </div>
          {sectorName && (
            <div>
              <dt className="text-xs text-muted-foreground">Sector</dt>
              <dd className="text-sm">{sectorName}</dd>
            </div>
          )}
          {invoice.notes && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted-foreground">Reference / description</dt>
              <dd className="text-sm">{invoice.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <TableBox title="Items">
        {invoice.lines.length === 0 ? (
          <EmptyState title="No invoice items" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th alignment="right">Qty</Th>
                <Th alignment="right">Unit price</Th>
                <Th alignment="right">Line total</Th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-t border-border">
                  <Td>{line.description}</Td>
                  <Td alignment="right">{line.quantity.toFixed(2)}</Td>
                  <Td alignment="right"><Amount value={line.unitPrice} className="text-foreground" /></Td>
                  <Td alignment="right"><Amount value={line.lineTotal} className="text-foreground" /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableBox>

      <Card title="Totals" className="ml-auto w-full max-w-sm">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd><Amount value={invoice.subtotal} className="text-foreground" /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">VAT</dt>
            <dd><Amount value={invoice.taxTotal} className="text-foreground" /></dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-medium">
            <dt>Total</dt>
            <dd><Amount value={invoice.grandTotal} className="text-foreground" /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Paid</dt>
            <dd><Amount value={invoice.amountPaid} className="text-foreground" /></dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Balance Due</dt>
            <dd><Amount value={remaining} className="text-foreground" /></dd>
          </div>
        </dl>
      </Card>

      {journalEntry && journalEntry.taxApplications.length > 0 && (
        <JournalEntryTaxApplications
          taxApplications={journalEntry.taxApplications}
          isDraft={invoice.journalEntry.status === "DRAFT"}
        />
      )}
      {invoice.journalEntry.status === "DRAFT" && (
        <Card title="Add Tax Application">
          <AddTaxApplicationForm
            journalEntryId={invoice.journalEntryId}
            partners={partners}
            vatRates={vatRates}
            invoiceLinked
          />
        </Card>
      )}

      {invoice.payments.length > 0 && <PaymentHistoryTable payments={invoice.payments} />}

      <Card title="Related Records">
        <ul className="space-y-2 text-sm">
          <li>
            Customer:{" "}
            <Link href={`/accounting/partners/${invoice.partner.id}/edit`} className="text-primary underline-offset-4 hover:underline">
              {invoice.partner.name}
            </Link>
          </li>
          <li>
            Journal entry:{" "}
            <Link href={`/accounting/journal-entries/${invoice.journalEntry.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
              {invoice.journalEntry.documentNumber}
            </Link>
          </li>
          {invoice.journalEntry.reversedByEntry && (
            <li>
              Reversed by:{" "}
              <Link href={`/accounting/journal-entries/${invoice.journalEntry.reversedByEntry.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                {invoice.journalEntry.reversedByEntry.documentNumber}
              </Link>
            </li>
          )}
        </ul>
      </Card>

      <Link href={BASE_PATH} className="text-sm text-primary underline-offset-4 hover:underline">
        ← Back to invoices
      </Link>
    </div>
  );
}
