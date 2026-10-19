import Link from "next/link";
import type { ReactNode } from "react";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReportDetailsControls } from "@/components/shared/ReportDetailsControls";
import { ActiveReportFilters, ReportQuickLinks, ReportSummary } from "@/components/shared/ReportLayout";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
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
  const hasActivity = Boolean(
    report &&
      (report.assets.groups.length ||
        report.liabilities.groups.length ||
    report.equity.groups.length ||
    report.currentProfit !== 0)
  );
  const groupCount = report
    ? report.assets.groups.length + report.liabilities.groups.length + report.equity.groups.length
    : 0;
  const renderTree = (group: BalanceSheetGroup, depth = 0): ReactNode[] => [
    <tr key={group.row.accountId} className="border-t border-border">
      <Td className="font-mono text-xs" style={{ paddingLeft: `${16 + depth * 20}px` }}>
        <Link href={accountHref(group.row.accountId)} className="hover:underline">
          {group.row.code}
        </Link>
      </Td>
      <Td>
        <Link href={accountHref(group.row.accountId)} className="hover:underline">
          {group.row.name}
        </Link>
      </Td>
      <Td alignment="right"><Amount value={group.row.amount} /></Td>
    </tr>,
    ...group.children.flatMap((child) => renderTree(child, depth + 1)),
  ];
  const renderSection = (
    title: string,
    section: BalanceSheetSection,
    totalLabel: string,
    summaryRows: { label: string; amount: number; emphasized?: boolean }[] = []
  ) => (
    <TableBox title={title}>
      {section.groups.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">No balances.</div>
      ) : (
        <ReportDetailsControls>
          {section.groups.map((group) => (
            <details
              key={group.row.accountId}
              className="report-details rounded-lg border border-border"
              open={groupCount <= 8}
            >
              <summary className="px-4 py-3 text-sm font-semibold">
                <span>{group.row.code} — {group.row.name}</span>
                <span className="ml-auto pr-2 text-right tabular-nums">
                  <Amount value={group.row.amount} />
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr><Th>Code</Th><Th>Account</Th><Th alignment="right">Balance</Th></tr>
                  </thead>
                  <tbody>{renderTree(group)}</tbody>
                </table>
              </div>
            </details>
          ))}
        </ReportDetailsControls>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <Td colSpan={2}>{totalLabel}</Td>
              <Td alignment="right"><Amount value={section.total} /></Td>
            </tr>
            {summaryRows.map((row) => (
              <tr key={row.label} className={row.emphasized ? "border-t border-border font-semibold" : ""}>
                <Td colSpan={2}>{row.label}</Td>
                <Td alignment="right"><Amount value={row.amount} /></Td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </TableBox>
  );

  return (
    <div className="accounting-report-page space-y-5">
      <PageHeader
        title="Balance Sheet"
        description="What the business owns and owes as of the selected date."
        actions={
          <ReportExportLinks
            path="/api/reports/balance-sheet"
            filters={{ asOf: params.asOf ?? report?.asOf }}
          />
        }
      />

      <Card title="Filters" className="report-filter-card">
        <ReportQuickLinks
          path="/accounting/reports/balance-sheet"
          filters={{ asOf: params.asOf ?? report?.asOf }}
          asOf
        />
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium" htmlFor="asOf">
            As of
            <input id="asOf" name="asOf" type="date" defaultValue={params.asOf ?? report?.asOf ?? ""} />
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/accounting/reports/balance-sheet">Clear</Link>
          </Button>
        </form>
        <ActiveReportFilters asOf={params.asOf ?? report?.asOf} />
      </Card>

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid as-of date."}
        </p>
      )}
      <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        No Fixed Asset register or Accumulated Depreciation is maintained; fixed
        assets are shown from journal activity only.
      </p>

      {hasActivity && report && (
        <ReportSummary
          items={[
            { label: "Total Assets", value: report.totalAssets },
            { label: "Total Liabilities", value: report.totalLiabilities },
            {
              label: "Total Equity",
              value: report.totalEquity,
              status: (
                <StatusBadge
                  status={Math.round((report.difference ?? 0) * 100) === 0 ? "BALANCED" : "UNBALANCED"}
                  label={Math.round((report.difference ?? 0) * 100) === 0 ? "Balanced" : "Unbalanced"}
                />
              ),
            },
          ]}
        />
      )}

      {report && !hasActivity ? (
        <TableBox title="Balance Sheet">
          <EmptyState
            title="No activity for the selected period"
            action={<Link href="/accounting/reports/balance-sheet" className="text-primary underline-offset-4 hover:underline">Clear filters</Link>}
          />
        </TableBox>
      ) : report ? (
        <>
          {renderSection("Assets", report.assets, "Total Assets")}
          {renderSection("Liabilities", report.liabilities, "Total Liabilities")}
          {renderSection("Equity", report.equity, "Total Equity Accounts", [
            { label: "Current Period Profit / (Loss)", amount: report.currentProfit },
            { label: "Total Equity", amount: report.totalEquity, emphasized: true },
          ])}
          {!report.balanced && (
            <p className="text-sm text-danger-foreground" role="status">
              Out of balance by <Amount value={Math.abs(report.difference ?? 0)} />.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
