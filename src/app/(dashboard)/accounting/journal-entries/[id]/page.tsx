import Link from "next/link";
import { notFound } from "next/navigation";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
import { getJournalEntryById } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryDetailActions } from "@/modules/accounting/components/JournalEntryDetailActions";
import { JournalEntryTaxApplications } from "@/modules/accounting/components/JournalEntryTaxApplications";
import { CREDIT_VOUCHER_SECTOR_CODES, CREDIT_VOUCHER_SECTOR_LABELS } from "@/modules/accounting/constants/sector";
import { VOUCHER_TYPE_LABELS } from "@/modules/accounting/constants/voucher-type";
import { listPartners } from "@/modules/partners/services/partner.service";
import { AddTaxApplicationForm } from "@/modules/tax/components/AddTaxApplicationForm";
import { listTaxRates } from "@/modules/tax/services/tax-rate.service";

export const dynamic = "force-dynamic";

export default async function JournalEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await getJournalEntryById(id);

  if (!entry) {
    notFound();
  }

  const [partners, vatRates] =
    entry.status === "DRAFT"
      ? await Promise.all([listPartners({ isActive: true }), listTaxRates({ type: "VAT" })])
      : [[], []];
  const totalDebitPaisa = entry.lines.reduce((sum, line) => sum + Math.round(line.debit * 100), 0);
  const totalCreditPaisa = entry.lines.reduce((sum, line) => sum + Math.round(line.credit * 100), 0);
  const totalDebit = totalDebitPaisa / 100;
  const totalCredit = totalCreditPaisa / 100;
  const sectorCode = CREDIT_VOUCHER_SECTOR_CODES.find((code) => code === entry.sector);
  const sectorName = sectorCode ? CREDIT_VOUCHER_SECTOR_LABELS[sectorCode] : entry.sector;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            <span className="font-mono">{entry.documentNumber}</span>
            <StatusBadge status={entry.status} />
          </>
        }
        description={`${VOUCHER_TYPE_LABELS[entry.voucherType]}${sectorName ? ` · ${sectorName}` : ""} · ${entry.date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`}
        actions={<JournalEntryDetailActions entry={entry} />}
      />

      <Card title="Entry details">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Date</dt>
            <dd className="text-sm">{entry.date.toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Branch</dt>
            <dd className="text-sm">{entry.branch.name}</dd>
          </div>
          {sectorName && (
            <div>
              <dt className="text-xs text-muted-foreground">Sector</dt>
              <dd className="text-sm">{sectorName}</dd>
            </div>
          )}
          {entry.reference && (
            <div>
              <dt className="text-xs text-muted-foreground">Reference</dt>
              <dd className="text-sm">{entry.reference}</dd>
            </div>
          )}
          {entry.description && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted-foreground">Description</dt>
              <dd className="text-sm">{entry.description}</dd>
            </div>
          )}
        </dl>
      </Card>

      <TableBox title="Entries">
        {entry.lines.length === 0 ? (
          <EmptyState title="No journal entry lines" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Branch</Th>
                <Th>Memo</Th>
                <Th alignment="right">Debit</Th>
                <Th alignment="right">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={line.id} className="border-t border-border">
                  <Td>
                    <div>{line.account.code} — {line.account.name}</div>
                    {(line.bankName || line.chequeNo || line.chequeDate) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {line.bankName ?? "—"} · Cheque {line.chequeNo ?? "—"} ·{" "}
                        {line.chequeDate ? line.chequeDate.toLocaleDateString() : "—"}
                      </div>
                    )}
                  </Td>
                  <Td>{line.branchId === entry.branchId ? "—" : line.branch.name}</Td>
                  <Td>{line.memo ?? "—"}</Td>
                  <Td alignment="right"><Amount value={line.debit} className="text-foreground" /></Td>
                  <Td alignment="right"><Amount value={line.credit} className="text-foreground" /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableBox>

      <div className="flex flex-wrap items-center justify-end gap-6 rounded-xl border border-border bg-card px-5 py-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Total Debit </span>
          <Amount value={totalDebit} className="text-foreground" />
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Total Credit </span>
          <Amount value={totalCredit} className="text-foreground" />
        </div>
        <StatusBadge status={totalDebitPaisa === totalCreditPaisa ? "BALANCED" : "UNBALANCED"} />
      </div>

      {entry.taxApplications.length > 0 && (
        <JournalEntryTaxApplications
          taxApplications={entry.taxApplications}
          isDraft={entry.status === "DRAFT"}
        />
      )}
      {entry.status === "DRAFT" && (
        <Card title="Add Tax Application">
          <AddTaxApplicationForm journalEntryId={entry.id} partners={partners} vatRates={vatRates} />
        </Card>
      )}

      {(entry.invoice || entry.reversalOfEntry || entry.reversedByEntry) && (
        <Card title="Related Records">
          <ul className="space-y-2 text-sm">
            {entry.invoice && (
              <li>
                {entry.invoice.direction === "CUSTOMER" ? "Customer invoice" : "Vendor bill"}:{" "}
                <Link
                  href={`${entry.invoice.direction === "CUSTOMER" ? "/accounting/invoices" : "/accounting/vendor-bills"}/${entry.invoice.id}`}
                  className="font-mono text-primary underline-offset-4 hover:underline"
                >
                  {entry.invoice.invoiceNumber}
                </Link>
              </li>
            )}
            {entry.reversalOfEntry && (
              <li>
                Reverses:{" "}
                <Link href={`/accounting/journal-entries/${entry.reversalOfEntry.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                  {entry.reversalOfEntry.documentNumber}
                </Link>
              </li>
            )}
            {entry.reversedByEntry && (
              <li>
                Reversed by:{" "}
                <Link href={`/accounting/journal-entries/${entry.reversedByEntry.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                  {entry.reversedByEntry.documentNumber}
                </Link>
              </li>
            )}
          </ul>
        </Card>
      )}

      <Link href="/accounting/journal-entries" className="text-sm text-primary underline-offset-4 hover:underline">
        ← Back to journal entries
      </Link>
    </div>
  );
}
