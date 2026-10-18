import Link from "next/link";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { DashboardBarChart } from "@/modules/dashboard/components/DashboardCharts";
import {
  getDashboardData,
  type DashboardMonth,
  type DashboardPeriod,
  type DashboardStatusCount,
} from "@/modules/dashboard/services/dashboard.service";
import { getBranches } from "@/modules/core/services/branch.service";

export const dynamic = "force-dynamic";

type DashboardSearchParams = {
  period?: string | string[];
  branch?: string | string[];
};

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-fy", label: "This fiscal year (Jul–Jun)" },
];

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function getPeriod(value: string | undefined): DashboardPeriod {
  return PERIODS.find((period) => period.value === value)?.value ?? "this-month";
}

function hasChartData(data: (DashboardMonth | DashboardStatusCount)[]) {
  return data.some(
    (item) =>
      item.primary !== 0 ||
      ("secondary" in item && item.secondary !== undefined && item.secondary !== 0)
  );
}

function StatFigure({
  label,
  value,
  href,
  amount = false,
}: {
  label: string;
  value: number;
  href?: string;
  amount?: boolean;
}) {
  const content = (
    <>
      <span className="block text-sm text-muted-foreground">{label}</span>
      <span className="mt-1 block text-lg font-semibold tabular-nums">
        {amount ? <Amount value={value} /> : value.toLocaleString("en-US")}
      </span>
    </>
  );

  return href ? (
    <Link
      href={href}
      className="rounded-md underline-offset-4 hover:underline"
    >
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  );
}

function ActionLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          : "rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
      }
    >
      {children}
    </Link>
  );
}

function ChartOrEmpty({
  data,
  primaryLabel,
  secondaryLabel,
}: {
  data: DashboardMonth[] | DashboardStatusCount[];
  primaryLabel: string;
  secondaryLabel?: string;
}) {
  return hasChartData(data) ? (
    <DashboardBarChart
      data={data}
      primaryLabel={primaryLabel}
      secondaryLabel={secondaryLabel}
    />
  ) : (
    <EmptyState title="No data for this period" />
  );
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const period = getPeriod(getSingleValue(params.period));
  const [branches, requestedBranch] = await Promise.all([
    getBranches(),
    Promise.resolve(getSingleValue(params.branch)),
  ]);
  const branch = branches.find((item) => item.id === requestedBranch);
  const branchId = branch?.id;
  const data = await getDashboardData({ period, branchId });
  const periodLabel = PERIODS.find((item) => item.value === period)?.label;
  const branchLabel = branch?.name ?? "All branches";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${periodLabel} · ${branchLabel}`}
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block">Period</span>
            <select
              name="period"
              defaultValue={period}
              className="min-w-48 rounded-md border border-input bg-background px-3 py-2"
            >
              {PERIODS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">Branch</span>
            <select
              name="branch"
              defaultValue={branchId ?? ""}
              className="min-w-48 rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All branches</option>
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Apply
          </button>
        </form>
      </Card>

      <div className="flex flex-wrap gap-2">
        <ActionLink href="/accounting/journal-entries/new" primary>
          New Voucher
        </ActionLink>
        <ActionLink href="/accounting/invoices/new">New Invoice</ActionLink>
        <ActionLink href="/accounting/vendor-bills/new">New Vendor Bill</ActionLink>
        <ActionLink href="/accounting/payments/new">Record Payment</ActionLink>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Income">
          <Amount value={data.income} className="text-3xl font-semibold" />
          <p className="text-sm text-muted-foreground">For the selected period</p>
        </Card>
        <Card title="Expense">
          <Amount value={data.expense} className="text-3xl font-semibold" />
          <p className="text-sm text-muted-foreground">For the selected period</p>
        </Card>
        <Card title="Net">
          <Amount value={data.net} className="text-3xl font-semibold" />
          <p className="text-sm text-muted-foreground">Income less expense</p>
        </Card>
      </div>

      <Card title="Income vs Expense (last 6 months)">
        <ChartOrEmpty
          data={data.incomeExpenseByMonth}
          primaryLabel="Income"
          secondaryLabel="Expense"
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Sales">
          <div className="flex justify-end">
            <Link
              href="/accounting/invoices"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatFigure
              label="Receivable outstanding (company-wide)"
              value={data.sales.receivables}
              href="/accounting/partners?type=CUSTOMER"
              amount
            />
            <StatFigure
              label="Overdue invoices"
              value={data.sales.overdueInvoices}
              href="/accounting/invoices?status=POSTED"
            />
          </div>
          <h3 className="text-sm font-medium">Invoiced per month</h3>
          <ChartOrEmpty data={data.sales.invoicedByMonth} primaryLabel="Invoiced" />
        </Card>

        <Card title="Purchases">
          <div className="flex justify-end">
            <Link
              href="/accounting/vendor-bills"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatFigure
              label="Payable outstanding (company-wide)"
              value={data.purchases.payables}
              href="/accounting/partners?type=VENDOR"
              amount
            />
            <StatFigure
              label="Unpaid bills"
              value={data.purchases.unpaidBills}
              href="/accounting/vendor-bills?status=POSTED"
            />
          </div>
          <h3 className="text-sm font-medium">Bills per month</h3>
          <ChartOrEmpty data={data.purchases.billedByMonth} primaryLabel="Billed" />
        </Card>

        <Card title="Vouchers">
          <div className="flex justify-end">
            <Link
              href="/accounting/journal-entries"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatFigure
              label="Drafts waiting"
              value={data.vouchers.draftCount}
              href="/accounting/journal-entries?status=DRAFT"
            />
            <StatFigure
              label="Posted in period"
              value={
                data.vouchers.statusCounts.find((item) => item.label === "POSTED")
                  ?.primary ?? 0
              }
              href="/accounting/journal-entries?status=POSTED"
            />
          </div>
          <h3 className="text-sm font-medium">Vouchers by status</h3>
          <ChartOrEmpty
            data={data.vouchers.statusCounts}
            primaryLabel="Vouchers"
          />
        </Card>

        <Card title="Banking">
          <div className="flex justify-end">
            <Link
              href="/accounting/bank-reconciliation"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatFigure
              label="Unmatched lines"
              value={data.banking.unmatchedLines}
              href="/accounting/bank-reconciliation?status=IN_PROGRESS"
            />
            <StatFigure
              label="Matched lines"
              value={
                data.banking.statusCounts.find((item) => item.label === "MATCHED")
                  ?.primary ?? 0
              }
            />
          </div>
          <h3 className="text-sm font-medium">Statement lines by status</h3>
          <ChartOrEmpty
            data={data.banking.statusCounts}
            primaryLabel="Lines"
          />
        </Card>
      </div>

      <nav className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
        <span className="text-muted-foreground">Go to Reports:</span>
        <Link className="text-primary underline-offset-4 hover:underline" href="/accounting/reports/trial-balance">
          Trial Balance
        </Link>
        <Link className="text-primary underline-offset-4 hover:underline" href="/accounting/reports/profit-loss">
          Profit &amp; Loss
        </Link>
        <Link className="text-primary underline-offset-4 hover:underline" href="/accounting/reports/balance-sheet">
          Balance Sheet
        </Link>
        <Link className="text-primary underline-offset-4 hover:underline" href="/accounting/reports/cash-flow">
          Cash Flow
        </Link>
      </nav>
    </div>
  );
}
