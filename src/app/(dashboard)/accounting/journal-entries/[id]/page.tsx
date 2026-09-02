import Link from "next/link";
import { notFound } from "next/navigation";

import { getJournalEntryById } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryDetailActions } from "@/modules/accounting/components/JournalEntryDetailActions";
import { JournalEntryTaxApplications } from "@/modules/accounting/components/JournalEntryTaxApplications";
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

  // Tax can only be attached before the entry is posted — once POSTED, the
  // real ledger lines already exist and adding tax after the fact would
  // require re-posting, which is out of scope here (see
  // postTaxApplicationLines in tax-posting.service.ts).
  const [partners, vatRates] =
    entry.status === "DRAFT"
      ? await Promise.all([listPartners({ isActive: true }), listTaxRates({ type: "VAT" })])
      : [[], []];

  const totalDebit = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{entry.documentNumber}</h1>
          <p className="text-sm text-muted-foreground">{VOUCHER_TYPE_LABELS[entry.voucherType]}</p>
        </div>
        <JournalEntryDetailActions entry={entry} />
      </div>

      {(entry.reversalOfEntry || entry.reversedByEntry) && (
        <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-sm">
          {entry.reversalOfEntry && (
            <p>
              Reverses{" "}
              <Link
                href={`/accounting/journal-entries/${entry.reversalOfEntry.id}`}
                className="font-mono text-primary underline-offset-4 hover:underline"
              >
                {entry.reversalOfEntry.documentNumber}
              </Link>
            </p>
          )}
          {entry.reversedByEntry && (
            <p>
              Reversed by{" "}
              <Link
                href={`/accounting/journal-entries/${entry.reversedByEntry.id}`}
                className="font-mono text-primary underline-offset-4 hover:underline"
              >
                {entry.reversedByEntry.documentNumber}
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Date</div>
          <div className="text-sm">{entry.date.toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Branch</div>
          <div className="text-sm">
            {entry.branch.name} ({entry.branch.code})
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="text-sm">{entry.status}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Reference</div>
          <div className="text-sm">{entry.reference ?? "—"}</div>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <div className="text-xs text-muted-foreground">Description</div>
          <div className="text-sm">{entry.description}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Memo</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div>
                    {line.account.code} — {line.account.name}
                  </div>
                  {(line.bankName || line.chequeNo || line.chequeDate) && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {line.bankName ?? "—"} · Cheque {line.chequeNo ?? "—"} ·{" "}
                      {line.chequeDate ? line.chequeDate.toLocaleDateString() : "—"}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {line.branchId === entry.branchId ? "—" : `${line.branch.name} (${line.branch.code})`}
                </td>
                <td className="px-3 py-2">{line.memo ?? "—"}</td>
                <td className="px-3 py-2 text-right">{Number(line.debit).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(line.credit).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-medium">
              <td className="px-3 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-3 py-2 text-right">{totalDebit.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{totalCredit.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <JournalEntryTaxApplications
        taxApplications={entry.taxApplications}
        isDraft={entry.status === "DRAFT"}
      />

      {entry.status === "DRAFT" && (
        <AddTaxApplicationForm journalEntryId={entry.id} partners={partners} vatRates={vatRates} />
      )}

      <Link href="/accounting" className="text-sm text-primary underline-offset-4 hover:underline">
        ← Back to journal entries
      </Link>
    </div>
  );
}
