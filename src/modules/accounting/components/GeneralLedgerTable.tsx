import Link from "next/link";

import { Amount } from "@/components/shared/Amount";
import { ReportDetailsControls } from "@/components/shared/ReportDetailsControls";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Td, Th } from "@/components/shared/TableBox";
import type { GeneralLedgerResult } from "@/modules/accounting/services/general-ledger.service";

export function GeneralLedgerTable({ report }: { report: GeneralLedgerResult }) {
  return (
    <ReportDetailsControls>
      {report.sections.map((section, index) => (
        <details
          key={section.account.id}
          className="report-details rounded-lg border border-border"
          open={index === 0}
        >
          <summary className="px-4 py-3 text-sm">
            <span className="font-semibold">
              {section.account.code} — {section.account.name}
            </span>
            <span className="ml-auto flex items-center gap-3 pr-2 text-right text-xs text-muted-foreground">
              <span>{section.lines.length} entries</span>
              <span className="font-medium text-foreground">
                Closing <Amount value={section.closingBalance} />
              </span>
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th alignment="center">Date</Th>
                  <Th>Document number</Th>
                  <Th>Type</Th>
                  <Th>Description</Th>
                  <Th alignment="right">Debit</Th>
                  <Th alignment="right">Credit</Th>
                  <Th alignment="right">Running balance</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border font-medium">
                  <Td colSpan={4}>Opening balance</Td>
                  <Td alignment="right">—</Td>
                  <Td alignment="right">—</Td>
                  <Td alignment="right"><Amount value={section.openingBalance} /></Td>
                </tr>
                {section.lines.map((line) => (
                  <tr key={line.lineId} className="border-t border-border">
                    <Td alignment="center" className="whitespace-nowrap">
                      {line.date.toLocaleDateString()}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Link
                        href={`/accounting/journal-entries/${line.journalEntryId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {line.documentNumber}
                      </Link>
                      {line.status === "VOID" && (
                        <span className="ml-2"><StatusBadge status="VOID" /></span>
                      )}
                    </Td>
                    <Td>{line.voucherType}</Td>
                    <Td>{line.memo ? `${line.description} — ${line.memo}` : line.description}</Td>
                    <Td alignment="right"><Amount value={line.debit} /></Td>
                    <Td alignment="right"><Amount value={line.credit} /></Td>
                    <Td alignment="right"><Amount value={line.runningBalance} /></Td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <Td colSpan={4}>Closing balance</Td>
                  <Td alignment="right"><Amount value={section.periodDebit} /></Td>
                  <Td alignment="right"><Amount value={section.periodCredit} /></Td>
                  <Td alignment="right"><Amount value={section.closingBalance} /></Td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </ReportDetailsControls>
  );
}
