import Link from "next/link";

import { ActiveReportFilters, ReportQuickLinks, ReportSummary } from "@/components/shared/ReportLayout";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableBox } from "@/components/shared/TableBox";
import { Button } from "@/components/ui/button";
import { getBranches } from "@/modules/core/services/branch.service";
import { TrialBalanceTable } from "@/modules/accounting/components/TrialBalanceTable";
import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import { getTrialBalance } from "@/modules/accounting/services/trial-balance.service";

export const dynamic = "force-dynamic";

type TrialBalanceSearchParams = {
  from?: string;
  to?: string;
  branchId?: string;
  includeZeroBalances?: string;
  view?: string;
};

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<TrialBalanceSearchParams>;
}) {
  const params = await searchParams;
  const [report, branches] = await Promise.all([
    getTrialBalance({
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
      branchId: params.branchId || undefined,
      includeZeroBalances: params.includeZeroBalances === "true",
    }),
    getBranches(),
  ]);
  const filters = {
    from: params.from,
    to: params.to,
    branchId: params.branchId,
    includeZeroBalances: params.includeZeroBalances,
    view: params.view === "grouped" ? "grouped" : "flat",
  };
  const view = params.view === "grouped" ? "grouped" : "flat";
  const activeBranch = branches.find((branch) => branch.id === params.branchId)?.name ?? "All branches";
  const isBalanced =
    Math.round(report.totalDebit * 100) === Math.round(report.totalCredit * 100);
  const hasActivity = report.rows.length > 0;

  return (
    <div className="accounting-report-page space-y-5">
      <PageHeader
        title="Trial Balance"
        description="Debit and credit totals for each account in the selected period."
        actions={<ReportExportLinks path="/api/reports/trial-balance" filters={filters} />}
      />

      <Card title="Filters" className="report-filter-card">
        <ReportQuickLinks path="/accounting/reports/trial-balance" filters={filters} />
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium" htmlFor="from">
            From
            <input id="from" name="from" type="date" defaultValue={params.from ?? ""} />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="to">
            To
            <input id="to" name="to" type="date" defaultValue={params.to ?? ""} />
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
          <label className="grid gap-1 text-xs font-medium" htmlFor="view">
            View
            <select id="view" name="view" defaultValue={view}>
              <option value="flat">Flat</option>
              <option value="grouped">Grouped by head</option>
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              id="includeZeroBalances"
              name="includeZeroBalances"
              type="checkbox"
              value="true"
              defaultChecked={params.includeZeroBalances === "true"}
              className="size-4 rounded border-input"
            />
            Include zero-balance accounts
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/accounting/reports/trial-balance">Clear</Link>
          </Button>
        </form>
        <ActiveReportFilters from={params.from} to={params.to} branchName={activeBranch} />
      </Card>

      {hasActivity && (
        <ReportSummary
          items={[
            { label: "Total Debit", value: report.totalDebit },
            { label: "Total Credit", value: report.totalCredit },
            {
              label: "Difference",
              value: isBalanced
                ? 0
                : Math.round((report.totalDebit - report.totalCredit) * 100) / 100,
              status: (
                <StatusBadge
                  status={isBalanced ? "BALANCED" : "UNBALANCED"}
                  label={isBalanced ? "Balanced" : "Unbalanced"}
                />
              ),
            },
          ]}
        />
      )}
      {hasActivity && !isBalanced && (
        <p className="text-sm text-danger-foreground" role="status">
          Trial balance is out of balance. Review the debit and credit differences.
        </p>
      )}

      <TableBox title={view === "flat" ? "Account balances" : "Balances by account head"}>
        {!hasActivity ? (
          <EmptyState
            title="No activity for the selected period"
            action={<Link href="/accounting/reports/trial-balance" className="text-primary underline-offset-4 hover:underline">Clear filters</Link>}
          />
        ) : (
          <TrialBalanceTable
            report={report}
            filters={{ from: params.from, to: params.to, branchId: params.branchId }}
            view={view}
          />
        )}
      </TableBox>
    </div>
  );
}
