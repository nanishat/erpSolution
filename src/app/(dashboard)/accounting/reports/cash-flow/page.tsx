import Link from "next/link";

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

  const accountHref = (accountId: string) => {
    const query = new URLSearchParams({ accountId });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    return `/accounting/reports/general-ledger?${query.toString()}`;
  };

  const renderSection = (
    category: CashFlowCategory,
    section: CashFlowSection
  ) => (
    <section key={category} className="space-y-3">
      <h2 className="text-lg font-semibold">{categoryTitles[category]}</h2>
      {section.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 text-right">Net cash effect</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.accountId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link href={accountHref(row.accountId)} className="hover:underline">
                      {row.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={accountHref(row.accountId)} className="hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.netCashEffect.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-2" colSpan={2}>
                  Total {categoryTitles[category]}
                </td>
                <td className="px-3 py-2 text-right">{section.total.toFixed(2)}</td>
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
        <h1 className="text-xl font-semibold">Cash Flow Statement</h1>
        <p className="text-sm text-muted-foreground">
          Direct-method cash flows for reportable journal entries. All cash and bank
          accounts are included company-wide.
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
        <Button type="submit">Apply</Button>
      </form>

      <ReportExportLinks
        path="/api/reports/cash-flow"
        filters={{ from: params.from, to: params.to }}
      />

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}

      {report && (
        <>
          <p className="flex justify-between border-b border-border pb-3 font-semibold">
            <span>Opening cash</span>
            <span>{report.opening.toFixed(2)}</span>
          </p>
          {renderSection("operating", report.operating)}
          {renderSection("investing", report.investing)}
          {renderSection("financing", report.financing)}
          <div className="space-y-2 border-t-2 border-border pt-3 text-lg font-semibold">
            <p className="flex justify-between">
              <span>Net change</span>
              <span>{report.netChange.toFixed(2)}</span>
            </p>
            <p className="flex justify-between">
              <span>Closing cash</span>
              <span>{report.closing.toFixed(2)}</span>
            </p>
          </div>
          <p
            className={`font-semibold ${report.reconciles ? "text-foreground" : "text-destructive"}`}
            role="status"
          >
            {report.reconciles
              ? "Reconciles with cash and bank balances"
              : `Does not reconcile by ${Math.abs(report.difference).toFixed(2)}`}
          </p>
        </>
      )}
    </div>
  );
}
