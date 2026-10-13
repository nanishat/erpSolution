import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { getBranches } from "@/modules/core/services/branch.service";
import {
  getProfitAndLoss,
  ProfitAndLossBranchNotFoundError,
  type ProfitAndLossGroup,
} from "@/modules/accounting/services/profit-and-loss.service";
import { reportFiltersSchema } from "@/modules/accounting/services/report-utils";

export const dynamic = "force-dynamic";

type ProfitAndLossSearchParams = {
  from?: string;
  to?: string;
  branchId?: string;
};

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<ProfitAndLossSearchParams>;
}) {
  const params = await searchParams;
  const parsed = reportFiltersSchema.safeParse(params);
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

  const accountHref = (accountId: string) => {
    const query = new URLSearchParams({ accountId });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.branchId) query.set("branchId", params.branchId);
    return `/accounting/reports/general-ledger?${query.toString()}`;
  };

  const renderTree = (
    group: ProfitAndLossGroup,
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
    groups: ProfitAndLossGroup[],
    total: number
  ) => (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>{groups.flatMap((group) => renderTree(group))}</tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-2" colSpan={2}>
                  Total {title}
                </td>
                <td className="px-3 py-2 text-right">{total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profit &amp; Loss</h1>
        <p className="text-sm text-muted-foreground">
          Revenue and expense activity for reportable journal entries in the selected period.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4"
      >
        <div>
          <label className="text-sm font-medium" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={params.from ?? ""}
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={params.to ?? ""}
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="branchId">
            Branch
          </label>
          <select
            id="branchId"
            name="branchId"
            defaultValue={params.branchId ?? ""}
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.isHeadOffice ? " (Head Office)" : ""}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Apply</Button>
      </form>

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}
      {reportResult.error && (
        <p className="text-sm text-destructive">{reportResult.error}</p>
      )}
      {report &&
        renderSection("Revenue", report.revenue.groups, report.totalRevenue)}
      {report &&
        renderSection("Expenses", report.expenses.groups, report.totalExpense)}
      {report && (
        <div className="flex justify-between border-t-2 border-border pt-3 text-lg font-semibold">
          <span>{report.netProfit < 0 ? "Net Loss" : "Net Profit"}</span>
          <span>{Math.abs(report.netProfit).toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
