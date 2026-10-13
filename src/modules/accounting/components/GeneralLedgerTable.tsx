import Link from "next/link";

import type { GeneralLedgerResult } from "@/modules/accounting/services/general-ledger.service";

export function GeneralLedgerTable({ report }: { report: GeneralLedgerResult }) {
  if (report.sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity for the selected filters.</p>;
  }

  return (
    <div className="space-y-6">
      {report.sections.map((section) => (
        <section key={section.account.id} className="space-y-2">
          <h2 className="text-base font-semibold">
            {section.account.code} — {section.account.name}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Document number</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-right">Running balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border font-medium">
                  <td className="px-3 py-2" colSpan={4}>
                    Opening balance
                  </td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">
                    {section.openingBalance.toFixed(2)}
                  </td>
                </tr>
                {section.lines.map((line) => (
                  <tr key={line.lineId} className="border-t border-border">
                    <td className="px-3 py-2">{line.date.toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/accounting/journal-entries/${line.journalEntryId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {line.documentNumber}
                      </Link>
                      {line.status === "VOID" && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                          VOID
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{line.voucherType}</td>
                    <td className="px-3 py-2">
                      {line.memo ? `${line.description} — ${line.memo}` : line.description}
                    </td>
                    <td className="px-3 py-2 text-right">{line.debit.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{line.credit.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{line.runningBalance.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-3 py-2" colSpan={4}>
                    Closing balance
                  </td>
                  <td className="px-3 py-2 text-right">{section.periodDebit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{section.periodCredit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    {section.closingBalance.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
