import Link from "next/link";
import type { ReactNode } from "react";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReportDetailsControls } from "@/components/shared/ReportDetailsControls";
import { ActiveReportFilters, ReportQuickLinks, ReportSummary } from "@/components/shared/ReportLayout";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
import { Button } from "@/components/ui/button";
import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import { getBranches } from "@/modules/core/services/branch.service";
import {
  getProfitAndLoss,
  ProfitAndLossBranchNotFoundError,
  UNASSIGNED_SECTOR,
  type ProfitAndLossGroup,
  type ProfitAndLossResult,
} from "@/modules/accounting/services/profit-and-loss.service";
import { profitAndLossQuerySchema } from "@/modules/accounting/services/report-utils";

export const dynamic = "force-dynamic";

type ProfitAndLossSearchParams = {
  from?: string;
  to?: string;
  branchId?: string;
  bySector?: string | string[];
};

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<ProfitAndLossSearchParams>;
}) {
  const params = await searchParams;
  const parsed = profitAndLossQuerySchema.safeParse(params);
  const [branches, reportResult] = await Promise.all([
    getBranches(),
    parsed.success
      ? getProfitAndLoss(parsed.data).then(
          (report) => ({ report, error: null }),
          (error: unknown) => {
            if (error instanceof ProfitAndLossBranchNotFoundError) {
              return { report: null, error: error.message };
            }
            throw error;
          }
        )
      : Promise.resolve({ report: null, error: null }),
  ]);
  const report = reportResult.report;
  const bySector = parsed.success && parsed.data.bySector;
  const sectorColumns = bySector
    ? [...(report?.sectors ?? []).filter((sector) => sector !== UNASSIGNED_SECTOR), UNASSIGNED_SECTOR]
    : [];
  const filters = {
    from: params.from,
    to: params.to,
    branchId: params.branchId,
    bySector: bySector ? "true" : undefined,
  };
  const activeBranch = branches.find((branch) => branch.id === params.branchId)?.name ?? "All branches";
  const groupCount = (report?.revenue.groups.length ?? 0) + (report?.expenses.groups.length ?? 0);
  const hasActivity = Boolean(
    report && (report.revenue.groups.length > 0 || report.expenses.groups.length > 0)
  );

  const accountHref = (accountId: string) => {
    const query = new URLSearchParams({ accountId });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.branchId) query.set("branchId", params.branchId);
    return `/accounting/reports/general-ledger?${query.toString()}`;
  };
  const renderRows = (group: ProfitAndLossGroup, depth = 0): ReactNode[] => [
    <tr key={group.row.accountId} className="border-t border-border">
      <Td className="font-mono text-xs" style={{ paddingLeft: `${16 + depth * 20}px` }}>
        <Link href={accountHref(group.row.accountId)} className="hover:underline">{group.row.code}</Link>
      </Td>
      <Td>
        <Link href={accountHref(group.row.accountId)} className="hover:underline">{group.row.name}</Link>
      </Td>
      {sectorColumns.map((sector) => (
        <Td key={sector} alignment="right">
          <Amount value={group.row.sectorAmounts?.[sector] ?? 0} />
        </Td>
      ))}
      <Td alignment="right"><Amount value={group.row.amount} /></Td>
    </tr>,
    ...group.children.flatMap((child) => renderRows(child, depth + 1)),
  ];

  const renderSection = (
    title: string,
    groups: ProfitAndLossGroup[],
    total: number,
    sectorAmounts?: Record<string, number>,
    includeNet = false
  ) => (
    <TableBox title={title}>
      <div className="px-4 pt-3">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity.</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <details
                key={group.row.accountId}
                className="report-details rounded-lg border border-border"
                open={groupCount <= 8}
              >
                <summary className="px-4 py-3 text-sm font-semibold">
                  <span>{group.row.code} — {group.row.name}</span>
                  <span className="ml-auto pr-2 text-right tabular-nums"><Amount value={group.row.amount} /></span>
                </summary>
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full text-sm">
                    <tbody>{renderRows(group)}</tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account</Th>
              {sectorColumns.map((sector) => (
                <Th key={sector} alignment="right">
                  {sector === UNASSIGNED_SECTOR ? "Unassigned" : sector}
                </Th>
              ))}
              <Th alignment="right">{bySector ? "Total" : "Amount"}</Th>
            </tr>
          </thead>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <Td colSpan={2}>Total {title}</Td>
              {sectorColumns.map((sector) => (
                <Td key={sector} alignment="right"><Amount value={sectorAmounts?.[sector] ?? 0} /></Td>
              ))}
              <Td alignment="right"><Amount value={total} /></Td>
            </tr>
            {includeNet && report && (
              <tr className="border-t border-border font-semibold">
                <Td colSpan={2}>{report.netProfit < 0 ? "Net Loss" : "Net Profit"}</Td>
                {sectorColumns.map((sector) => (
                  <Td key={sector} alignment="right">—</Td>
                ))}
                <Td alignment="right"><Amount value={report.netProfit} /></Td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </TableBox>
  );

  const emptyClearHref = "/accounting/reports/profit-loss";
  const reports: ProfitAndLossResult | null = report;

  return (
    <div className="accounting-report-page space-y-5">
      <PageHeader
        title="Profit & Loss"
        description="Income and expenses for the selected period."
        actions={<ReportExportLinks path="/api/reports/profit-loss" filters={filters} />}
      />

      <Card title="Filters" className="report-filter-card">
        <ReportQuickLinks path="/accounting/reports/profit-loss" filters={filters} />
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium" htmlFor="from">
            From<input id="from" name="from" type="date" defaultValue={params.from ?? ""} />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="to">
            To<input id="to" name="to" type="date" defaultValue={params.to ?? ""} />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="branchId">
            Branch
            <select id="branchId" name="branchId" defaultValue={params.branchId ?? ""}>
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}{branch.isHeadOffice ? " (Head Office)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="bySector" value="true" defaultChecked={bySector} className="size-4 rounded border-input" />
            Break down by sector
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <Button asChild variant="outline" size="sm"><Link href={emptyClearHref}>Clear</Link></Button>
        </form>
        <ActiveReportFilters from={params.from} to={params.to} branchName={`${activeBranch}${bySector ? " · Sector breakdown" : ""}`} />
      </Card>

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}
      {reportResult.error && <p className="text-sm text-destructive">{reportResult.error}</p>}

      {reports && hasActivity && (
        <ReportSummary
          items={[
            { label: "Income", value: reports.totalRevenue },
            { label: "Expense", value: reports.totalExpense },
            { label: reports.netProfit < 0 ? "Net Loss" : "Net Profit", value: reports.netProfit },
          ]}
        />
      )}
      {reports && !hasActivity ? (
        <TableBox title="Profit & Loss">
          <EmptyState
            title="No activity for the selected period"
            action={<Link href={emptyClearHref} className="text-primary underline-offset-4 hover:underline">Clear filters</Link>}
          />
        </TableBox>
      ) : reports ? (
        <>
          <ReportDetailsControls>
            {renderSection("Income", reports.revenue.groups, reports.totalRevenue, reports.revenue.sectorAmounts)}
            {renderSection("Expenses", reports.expenses.groups, reports.totalExpense, reports.expenses.sectorAmounts, true)}
          </ReportDetailsControls>
          {bySector && (
            <p className={reports.sectorTotalsReconcile ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {reports.sectorTotalsReconcile
                ? "Sector totals reconcile."
                : "Sector totals do not reconcile."}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
