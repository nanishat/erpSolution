import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import {
  getBalanceSheet,
  type BalanceSheetGroup,
  type BalanceSheetSection,
} from "@/modules/accounting/services/balance-sheet.service";
import { balanceSheetQuerySchema } from "@/modules/accounting/services/report-utils";

export const dynamic = "force-dynamic";

type BalanceSheetSearchParams = {
  asOf?: string;
};

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<BalanceSheetSearchParams>;
}) {
  const params = await searchParams;
  const parsed = balanceSheetQuerySchema.safeParse(params);
  const report = parsed.success ? await getBalanceSheet(parsed.data) : null;

  const accountHref = (accountId: string) => {
    const query = new URLSearchParams({
      accountId,
      to: report?.asOf ?? params.asOf ?? "",
    });
    return `/accounting/reports/general-ledger?${query.toString()}`;
  };

  const renderTree = (
    group: BalanceSheetGroup,
    depth = 0,
    keyPrefix = ""
  ): ReactNode[] => [
    <tr
      key={`${keyPrefix}${group.row.accountId}`}
      className={`border-t border-border${group.children.length > 0 ? " bg-muted/50 font-semibold" : ""}`}
    >
      <td className="px-3 py-2" style={{ paddingLeft: `${12 + depth * 24}px` }}>
        <Link href={accountHref(group.row.accountId)} className="hover:underline">
          {group.row.code}
        </Link>
      </td>
      <td className="px-3 py-2">
        <Link href={accountHref(group.row.accountId)} className="hover:underline">
          {group.row.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-right">{group.row.amount.toFixed(2)}</td>
    </tr>,
    ...group.children.flatMap((child) =>
      renderTree(child, depth + 1, `${keyPrefix}${group.row.accountId}/`)
    ),
  ];

  const renderSection = (
    title: string,
    section: BalanceSheetSection,
    totalLabel: string,
    summaryRows: { label: string; amount: number; emphasized?: boolean }[] = []
  ) => (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {section.groups.length === 0 ? (
              <tr>
                <td className="px-3 py-2 text-muted-foreground" colSpan={3}>
                  No balances.
                </td>
              </tr>
            ) : (
              section.groups.flatMap((group) => renderTree(group))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-3 py-2" colSpan={2}>
                {totalLabel}
              </td>
              <td className="px-3 py-2 text-right">{section.total.toFixed(2)}</td>
            </tr>
            {summaryRows.map((row) => (
              <tr
                key={row.label}
                className={row.emphasized ? "border-t border-border font-semibold" : ""}
              >
                <td className="px-3 py-2" colSpan={2}>
                  {row.label}
                </td>
                <td className="px-3 py-2 text-right">{row.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Balance Sheet</h1>
        <p className="text-sm text-muted-foreground">
          Cumulative account balances through the selected date.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4"
      >
        <div>
          <label className="text-sm font-medium" htmlFor="asOf">
            As of
          </label>
          <input
            id="asOf"
            name="asOf"
            type="date"
            defaultValue={params.asOf ?? report?.asOf ?? ""}
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <Button type="submit">Apply</Button>
      </form>

      <ReportExportLinks
        path="/api/reports/balance-sheet"
        filters={{ asOf: params.asOf ?? report?.asOf }}
      />

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid as-of date."}
        </p>
      )}
      <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        No Fixed Asset register or Accumulated Depreciation is maintained; fixed
        assets are shown from journal activity only.
      </p>

      {report && (
        <>
          {renderSection("Assets", report.assets, "Total Assets")}
          {renderSection("Liabilities", report.liabilities, "Total Liabilities")}
          {renderSection("Equity", report.equity, "Total Equity Accounts", [
            {
              label: "Current Period Profit / (Loss)",
              amount: report.currentProfit,
            },
            {
              label: "Total Equity",
              amount: report.totalEquity,
              emphasized: true,
            },
          ])}
          <p
            className={`font-semibold ${report.balanced ? "text-success-foreground" : "text-danger-foreground"}`}
            role="status"
          >
            {report.balanced
              ? "Balanced"
              : `Out of balance by ${Math.abs(report.difference ?? 0).toFixed(2)}`}
          </p>
        </>
      )}
    </div>
  );
}
