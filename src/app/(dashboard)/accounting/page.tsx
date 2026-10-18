import Link from "next/link";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  DashboardBarChart,
  DashboardHorizontalBarChart,
} from "@/modules/dashboard/components/DashboardCharts";
import {
  getDashboardData,
  type DashboardMonth,
  type DashboardPeriod,
  type DashboardValue,
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

const OVERDUE_INVOICES_HREF = "/accounting/invoices?overdue=1";

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function getPeriod(value: string | undefined): DashboardPeriod {
  return PERIODS.find((period) => period.value === value)?.value ?? "this-month";
}

function hasChartData(data: DashboardMonth[] | DashboardValue[]) {
  return data.some(
    (item) =>
      item.primary !== 0 ||
      ("secondary" in item &&
        item.secondary !== undefined &&
        item.secondary !== 0)
  );
}

function percentChange(current: number, previous: number): string | undefined {
  if (previous === 0) return undefined;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change)) return undefined;
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function KpiTile({
  label,
  value,
  change,
  caption,
  negative = false,
}: {
  label: string;
  value: number;
  change?: string;
  caption?: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/10 p-4 text-white">
      <p className="text-sm text-white/80">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          negative ? "text-rose-200" : ""
        }`}
      >
        {negative ? (
          <>
            (<Amount value={Math.abs(value)} className="text-2xl font-semibold text-rose-200" />)
          </>
        ) : (
          <Amount value={value} className="text-2xl font-semibold text-white" />
        )}
      </p>
      <p className="mt-1 min-h-5 text-xs text-white/70">
        {change ? `${change} vs previous period` : caption ?? ""}
      </p>
    </div>
  );
}

function BalanceCard({
  label,
  value,
  href,
  amount = false,
  caption,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  amount?: boolean;
  caption: string;
  accent: "info" | "warning" | "danger" | "success";
}) {
  const accentClass = {
    info: "border-l-info",
    warning: "border-l-warning",
    danger: "border-l-danger",
    success: "border-l-success",
  }[accent];

  return (
    <Link
      href={href}
      className={`block rounded-xl border border-border border-l-4 ${accentClass} bg-card p-5 shadow-card transition-colors hover:bg-muted/40`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {amount ? <Amount value={value} /> : value.toLocaleString("en-US")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </Link>
  );
}

function PendingTile({
  label,
  value,
  href,
  buttonLabel,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  buttonLabel: string;
  tone: "warning" | "danger" | "info";
}) {
  const toneClasses =
    value === 0
      ? "bg-muted text-muted-foreground"
      : tone === "warning"
        ? "bg-warning-soft text-warning-foreground"
        : tone === "danger"
          ? "bg-danger-soft text-danger-foreground"
          : "bg-info-soft text-info-foreground";

  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg p-4 ${toneClasses}`}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {value.toLocaleString("en-US")}
        </p>
      </div>
      <Link
        href={href}
        className="shrink-0 rounded-md border border-current/20 bg-white/60 px-3 py-2 text-sm font-medium hover:bg-white"
      >
        {buttonLabel}
      </Link>
    </div>
  );
}

const QUICK_ACTIONS = [
  {
    title: "New Voucher",
    description: "Record a journal entry",
    href: "/accounting/journal-entries/new",
    gradient: "from-[#0F5C9E] to-[#2563eb]",
  },
  {
    title: "New Invoice",
    description: "Bill a customer",
    href: "/accounting/invoices/new",
    gradient: "from-[#15803d] to-[#22a06b]",
  },
  {
    title: "New Vendor Bill",
    description: "Record a supplier bill",
    href: "/accounting/vendor-bills/new",
    gradient: "from-[#b45309] to-[#ea8a16]",
  },
  {
    title: "Record Payment",
    description: "Capture a customer receipt",
    href: "/accounting/payments/new",
    gradient: "from-[#6d28d9] to-[#9333ea]",
  },
];

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
  const invoiceCollectionByMonth = data.invoicedByMonth.map((month, index) => ({
    ...month,
    secondary: data.collectedByMonth[index]?.secondary ?? 0,
  }));
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <section className="dash-in space-y-6 rounded-xl bg-[linear-gradient(120deg,#0F5C9E,#0A4A80)] p-5 text-white shadow-card md:p-7">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <p className="text-sm font-medium text-white/75">Welcome back</p>
            <h1 className="mt-1 text-2xl font-semibold">Accounting overview</h1>
            <p className="mt-1 text-sm text-white/80">{dateLabel}</p>
            <p className="mt-3 text-sm text-white/65">
              {periodLabel} · {branchLabel}
            </p>
          </div>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 rounded-lg bg-white/10 p-3"
          >
            <label className="space-y-1 text-sm">
              <span className="block text-white/80">Period</span>
              <select
                name="period"
                defaultValue={period}
                className="!min-w-44 !border-white/25 !bg-white/10 !text-white"
              >
                {PERIODS.map((item) => (
                  <option key={item.value} value={item.value} className="text-slate-900">
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-white/80">Branch</span>
              <select
                name="branch"
                defaultValue={branchId ?? ""}
                className="!min-w-44 !border-white/25 !bg-white/10 !text-white"
              >
                <option value="" className="text-slate-900">All branches</option>
                {branches.map((item) => (
                  <option key={item.id} value={item.id} className="text-slate-900">
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="min-h-10 rounded-md bg-white px-4 py-2 text-sm font-semibold text-primary hover:bg-white/90"
            >
              Apply
            </button>
          </form>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="dash-in" style={{ animationDelay: "0ms" }}>
            <KpiTile
              label="Income"
              value={data.income}
              change={percentChange(data.income, data.previousIncome)}
            />
          </div>
          <div className="dash-in" style={{ animationDelay: "50ms" }}>
            <KpiTile
              label="Expense"
              value={data.expense}
              change={percentChange(data.expense, data.previousExpense)}
            />
          </div>
          <div className="dash-in" style={{ animationDelay: "100ms" }}>
            <KpiTile
              label="Net"
              value={data.net}
              change={percentChange(data.net, data.previousNet)}
              negative={data.net < 0}
            />
          </div>
          <div className="dash-in" style={{ animationDelay: "150ms" }}>
            <KpiTile
              label="Collected"
              value={data.collected}
              caption={`Customer payments received · ${branchLabel}`}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="dash-in" style={{ animationDelay: "200ms" }}>
          <BalanceCard
            label="Receivable outstanding"
            value={data.sales.receivables}
            href="/accounting/partners?type=CUSTOMER"
            amount
            caption="Company-wide customer balance"
            accent="info"
          />
        </div>
        <div className="dash-in" style={{ animationDelay: "250ms" }}>
          <BalanceCard
            label="Payable outstanding"
            value={data.payables}
            href="/accounting/partners?type=VENDOR"
            amount
            caption="Company-wide vendor balance"
            accent="warning"
          />
        </div>
        <div className="dash-in" style={{ animationDelay: "300ms" }}>
          <BalanceCard
            label="Overdue invoices"
            value={data.sales.overdueInvoices}
            href={OVERDUE_INVOICES_HREF}
            caption="Past due · selected branch"
            accent="danger"
          />
        </div>
        <div className="dash-in" style={{ animationDelay: "350ms" }}>
          <BalanceCard
            label="Unmatched bank lines"
            value={data.banking.unmatchedLines}
            href="/accounting/bank-reconciliation"
            caption="Awaiting reconciliation"
            accent="success"
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="dash-in" style={{ animationDelay: "400ms" }}>
          <Card
            title="Income vs Expense"
            description="Monthly totals for the last six months."
          >
            {hasChartData(data.incomeExpenseByMonth) ? (
              <DashboardBarChart
                data={data.incomeExpenseByMonth}
                primaryLabel="Income"
                secondaryLabel="Expense"
              />
            ) : (
              <EmptyState title="No data for this period" />
            )}
          </Card>
        </div>
        <div className="dash-in" style={{ animationDelay: "450ms" }}>
          <Card
            title="Income by sector"
            description={`Selected period · ${branchLabel}.`}
          >
            {hasChartData(data.incomeBySector) ? (
              <DashboardHorizontalBarChart data={data.incomeBySector} />
            ) : (
              <EmptyState title="No data for this period" />
            )}
          </Card>
        </div>
        <div className="dash-in" style={{ animationDelay: "500ms" }}>
          <Card
            title="Top 5 expense heads"
            description="Selected period · System accounts excluded."
          >
            {hasChartData(data.topExpenseHeads) ? (
              <DashboardHorizontalBarChart data={data.topExpenseHeads} />
            ) : (
              <EmptyState title="No data for this period" />
            )}
          </Card>
        </div>
        <div className="dash-in" style={{ animationDelay: "550ms" }}>
          <Card
            title="Invoiced vs Collected"
            description={`Customer invoice totals by invoice date vs payments by payment date · ${branchLabel}.`}
          >
            {hasChartData(invoiceCollectionByMonth) ? (
              <DashboardBarChart
                data={invoiceCollectionByMonth}
                primaryLabel="Invoiced"
                secondaryLabel="Collected"
              />
            ) : (
              <EmptyState title="No data for this period" />
            )}
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="dash-in" style={{ animationDelay: "600ms" }}>
          <Card
            title="Pending Actions"
            description="Items that may need your attention."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <PendingTile
                label="Draft vouchers"
                value={data.vouchers.draftCount}
                href="/accounting/journal-entries?status=DRAFT"
                buttonLabel="Review"
                tone="warning"
              />
              <PendingTile
                label="Overdue invoices"
                value={data.sales.overdueInvoices}
                href={OVERDUE_INVOICES_HREF}
                buttonLabel="View"
                tone="danger"
              />
              <PendingTile
                label="Unmatched bank lines"
                value={data.banking.unmatchedLines}
                href="/accounting/bank-reconciliation"
                buttonLabel="Reconcile"
                tone="info"
              />
            </div>
          </Card>
        </div>
        <div className="dash-in" style={{ animationDelay: "650ms" }}>
          <Card title="Quick Actions" description="Start a common accounting task.">
            <div className="grid grid-cols-2 gap-3">
              {QUICK_ACTIONS.map((action) => (
                <Link
                  key={action.title}
                  href={action.href}
                  className={`dash-action rounded-lg bg-gradient-to-br ${action.gradient} p-4 text-white shadow-sm`}
                >
                  <span className="block font-semibold">{action.title}</span>
                  <span className="mt-1 block text-sm text-white/75">
                    {action.description}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <nav className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
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
