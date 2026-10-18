"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { TrialBalanceResult } from "@/modules/accounting/services/trial-balance.service";

type TrialBalanceView = "flat" | "grouped";

export function TrialBalanceTable({
  report,
  filters,
}: {
  report: TrialBalanceResult;
  filters: { from?: string; to?: string; branchId?: string };
}) {
  const [view, setView] = useState<TrialBalanceView>("flat");

  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity for the selected filters.
      </p>
    );
  }

  const accountHref = (accountId: string) => {
    const params = new URLSearchParams({ accountId });
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.branchId) params.set("branchId", filters.branchId);
    return `/accounting/reports/general-ledger?${params.toString()}`;
  };

  const renderRow = (
    row: TrialBalanceResult["rows"][number],
    options: { header?: boolean; indented?: boolean } = {}
  ) => (
    <tr
      key={row.accountId}
      className={`border-t border-border${options.header ? " bg-muted/50 font-semibold" : ""}`}
    >
      <td className={`px-3 py-2 font-mono text-xs${options.indented ? " pl-8" : ""}`}>
        <Link href={accountHref(row.accountId)} className="hover:underline">
          {row.code}
        </Link>
      </td>
      <td className="px-3 py-2">
        <Link href={accountHref(row.accountId)} className="hover:underline">
          {row.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{row.type}</td>
      <td className="px-3 py-2 text-right">{row.totalDebit.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">{row.totalCredit.toFixed(2)}</td>
    </tr>
  );
  const renderGroup = (
    group: TrialBalanceResult["groups"][number],
    indented = false
  ): ReactNode[] => [
    renderRow(group.row, { header: group.children.length > 0, indented }),
    ...group.children.flatMap((child) => renderGroup(child, true)),
  ];

  return (
    <div className="space-y-2">
      <div className="flex gap-2" aria-label="Trial balance view">
        <Button
          aria-pressed={view === "flat"}
          onClick={() => setView("flat")}
          variant={view === "flat" ? "default" : "outline"}
        >
          Flat
        </Button>
        <Button
          aria-pressed={view === "grouped"}
          onClick={() => setView("grouped")}
          variant={view === "grouped" ? "default" : "outline"}
        >
          Grouped by head
        </Button>
      </div>

      {!report.isBalanced && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          Trial balance is out of balance — total debits ({report.totalDebit.toFixed(2)}) do
          not equal total credits ({report.totalCredit.toFixed(2)}). This indicates a data
          integrity issue and should be investigated.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {view === "flat"
              ? report.rows.map((row) => renderRow(row))
              : report.groups.flatMap((group) => renderGroup(group))}
          </tbody>
          <tfoot>
            <tr
              className={
                "border-t-2 font-semibold " +
                (report.isBalanced
                  ? "border-success bg-success-soft text-success-foreground"
                  : "border-danger bg-danger-soft text-danger-foreground")
              }
            >
              <td className="px-3 py-2" colSpan={3}>
                Total{!report.isBalanced && " — NOT BALANCED"}
              </td>
              <td className="px-3 py-2 text-right">{report.totalDebit.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{report.totalCredit.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
