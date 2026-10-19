import Link from "next/link";
import type { ReactNode } from "react";

import { Amount } from "@/components/shared/Amount";
import {
  Td,
  Th,
} from "@/components/shared/TableBox";
import { ReportDetailsControls } from "@/components/shared/ReportDetailsControls";
import type { TrialBalanceResult, TrialBalanceGroup } from "@/modules/accounting/services/trial-balance.service";

export function TrialBalanceTable({
  report,
  filters,
  view,
}: {
  report: TrialBalanceResult;
  filters: { from?: string; to?: string; branchId?: string };
  view: "flat" | "grouped";
}) {
  const accountHref = (accountId: string) => {
    const params = new URLSearchParams({ accountId });
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.branchId) params.set("branchId", filters.branchId);
    return `/accounting/reports/general-ledger?${params.toString()}`;
  };

  const renderRow = (
    row: TrialBalanceResult["rows"][number],
    indented = false
  ) => (
    <tr key={row.accountId} className="border-t border-border">
      <Td className={`font-mono text-xs${indented ? " pl-8" : ""}`}>
        <Link href={accountHref(row.accountId)} className="hover:underline">
          {row.code}
        </Link>
      </Td>
      <Td>
        <Link href={accountHref(row.accountId)} className="hover:underline">
          {row.name}
        </Link>
      </Td>
      <Td>{row.type}</Td>
      <Td alignment="right"><Amount value={row.totalDebit} /></Td>
      <Td alignment="right"><Amount value={row.totalCredit} /></Td>
    </tr>
  );

  const renderGroupRows = (group: TrialBalanceGroup, indented = false): ReactNode[] => [
    renderRow(group.row, indented),
    ...group.children.flatMap((child) => renderGroupRows(child, true)),
  ];

  const table = (rows: ReactNode, footer = true) => (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th alignment="right">Debit</Th>
          <Th alignment="right">Credit</Th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
      {footer && (
        <tfoot>
          <tr className="border-t-2 border-border font-semibold">
            <Td colSpan={3}>Grand total</Td>
            <Td alignment="right"><Amount value={report.totalDebit} /></Td>
            <Td alignment="right"><Amount value={report.totalCredit} /></Td>
          </tr>
        </tfoot>
      )}
    </table>
  );

  if (view === "flat") {
    return table(report.rows.map((row) => renderRow(row)));
  }

  return (
    <ReportDetailsControls>
      {report.groups.map((group) => (
        <details
          key={group.row.accountId}
          className="report-details rounded-lg border border-border"
          open={report.groups.length <= 8}
        >
          <summary className="px-4 py-3 text-sm font-semibold">
              <span>
                <Link href={accountHref(group.row.accountId)} className="hover:underline">
                  {group.row.code} — {group.row.name}
                </Link>
              </span>
            <span className="ml-auto flex gap-6 pr-2 text-right tabular-nums">
              <span>Debit <Amount value={group.row.totalDebit} /></span>
              <span>Credit <Amount value={group.row.totalCredit} /></span>
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            {table(
              group.children.length > 0
                ? group.children.flatMap((child) => renderGroupRows(child, true))
                : renderGroupRows(group),
              false
            )}
          </div>
        </details>
      ))}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <Td colSpan={3}>Grand total</Td>
              <Td alignment="right"><Amount value={report.totalDebit} /></Td>
              <Td alignment="right"><Amount value={report.totalCredit} /></Td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ReportDetailsControls>
  );
}
