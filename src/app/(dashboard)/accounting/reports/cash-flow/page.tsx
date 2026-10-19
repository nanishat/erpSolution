import Link from "next/link";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReportDetailsControls } from "@/components/shared/ReportDetailsControls";
import { ActiveReportFilters, ReportQuickLinks, ReportSummary } from "@/components/shared/ReportLayout";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
import { Button } from "@/components/ui/button";
import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import {
  getCashFlow,
  type CashFlowCategory,
  type CashFlowSection,
} from "@/modules/accounting/services/cash-flow.service";
import { reportFiltersSchema } from "@/modules/accounting/services/report-utils";

export const dynamic = "force-dynamic";

type CashFlowSearchParams = {
  from?: string;
  to?: string;
};

const categoryTitles: Record<CashFlowCategory, string> = {
  operating: "Operating Activities",
  investing: "Investing Activities",
  financing: "Financing Activities",
};

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<CashFlowSearchParams>;
}) {
  const params = await searchParams;
  const parsed = reportFiltersSchema.safeParse(params);
  const report = parsed.success ? await getCashFlow(parsed.data) : null;
  const reconciles = report ? Math.round(report.difference * 100) === 0 : false;
  const hasActivity = Boolean(
    report &&
      (report.operating.rows.length || report.investing.rows.length || report.financing.rows.length)
  );
  const accountHref = (accountId: string) => {
    const query = new URLSearchParams({ accountId });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    return `/accounting/reports/general-ledger?${query.toString()}`;
  };
  const renderSection = (category: CashFlowCategory, section: CashFlowSection) => (
    <details
      key={category}
      className="report-details rounded-lg border border-border"
      open
    >
      <summary className="px-4 py-3 text-sm font-semibold">
        <span>{categoryTitles[category]}</span>
        <span className="ml-auto pr-2 text-right tabular-nums"><Amount value={section.total} /></span>
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-sm">
          <thead><tr><Th>Code</Th><Th>Account</Th><Th alignment="right">Net cash effect</Th></tr></thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.accountId} className="border-t border-border">
                <Td className="font-mono text-xs">
                  <Link href={accountHref(row.accountId)} className="hover:underline">{row.code}</Link>
                </Td>
                <Td>
                  <Link href={accountHref(row.accountId)} className="hover:underline">{row.name}</Link>
                </Td>
                <Td alignment="right"><Amount value={row.netCashEffect} /></Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <Td colSpan={2}>Total {categoryTitles[category]}</Td>
              <Td alignment="right"><Amount value={section.total} /></Td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  );
  const clearHref = "/accounting/reports/cash-flow";

  return (
    <div className="accounting-report-page space-y-5">
      <PageHeader
        title="Cash Flow Statement"
        description="Cash received and spent during the selected period."
        actions={
          <ReportExportLinks
            path="/api/reports/cash-flow"
            filters={{ from: params.from, to: params.to }}
          />
        }
      />

      <Card title="Filters" className="report-filter-card">
        <ReportQuickLinks path="/accounting/reports/cash-flow" filters={{ from: params.from, to: params.to }} />
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium" htmlFor="from">
            From<input id="from" name="from" type="date" defaultValue={params.from ?? ""} />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="to">
            To<input id="to" name="to" type="date" defaultValue={params.to ?? ""} />
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <Button asChild variant="outline" size="sm"><Link href={clearHref}>Clear</Link></Button>
        </form>
        <ActiveReportFilters from={params.from} to={params.to} />
      </Card>

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}

      {report && hasActivity && (
        <ReportSummary
          items={[
            { label: "Opening Cash", value: report.opening },
            { label: "Net Change", value: report.netChange },
            { label: "Closing Cash", value: report.closing },
          ]}
        />
      )}

      {report && !hasActivity ? (
        <TableBox title="Cash flow activities">
          <EmptyState title="No activity for the selected period" action={<Link href={clearHref} className="text-primary underline-offset-4 hover:underline">Clear filters</Link>} />
        </TableBox>
      ) : report ? (
        <TableBox title="Cash flow activities">
          <div className="px-4 pt-3">
            <ReportDetailsControls>
              {renderSection("operating", report.operating)}
              {renderSection("investing", report.investing)}
              {renderSection("financing", report.financing)}
            </ReportDetailsControls>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <Td colSpan={2}>Net change</Td><Td alignment="right"><Amount value={report.netChange} /></Td>
                </tr>
                <tr className="border-t border-border font-semibold">
                  <Td colSpan={2}>Closing cash</Td><Td alignment="right"><Amount value={report.closing} /></Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </TableBox>
      ) : null}
      {report && hasActivity && (
        <p
          className={reconciles ? "text-sm text-success-foreground" : "text-sm text-danger-foreground"}
          role="status"
        >
          {reconciles
            ? "Reconciles with cash and bank balances"
            : `Does not reconcile by ${Math.abs(report.difference).toFixed(2)}`}
        </p>
      )}
    </div>
  );
}
