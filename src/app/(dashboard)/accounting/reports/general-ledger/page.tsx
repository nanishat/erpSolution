import Link from "next/link";
import { notFound } from "next/navigation";

import { ActiveReportFilters, ReportQuickLinks, ReportSummary } from "@/components/shared/ReportLayout";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { TableBox } from "@/components/shared/TableBox";
import { GeneralLedgerFilters } from "@/modules/accounting/components/GeneralLedgerFilters";
import { GeneralLedgerTable } from "@/modules/accounting/components/GeneralLedgerTable";
import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import {
  getGeneralLedger,
  getGeneralLedgerAccountOptions,
} from "@/modules/accounting/services/general-ledger.service";
import { generalLedgerQuerySchema } from "@/modules/accounting/services/report-utils";
import { ChartOfAccountNotFoundError } from "@/modules/accounting/services/chart-of-account.service";
import { getBranches } from "@/modules/core/services/branch.service";

export const dynamic = "force-dynamic";

type GeneralLedgerSearchParams = {
  accountId?: string;
  from?: string;
  to?: string;
  branchId?: string;
};

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<GeneralLedgerSearchParams>;
}) {
  const params = await searchParams;
  const parsed = generalLedgerQuerySchema.safeParse(params);
  const [accounts, branches] = await Promise.all([
    getGeneralLedgerAccountOptions(),
    getBranches(),
  ]);
  let report = null;

  if (parsed.success) {
    try {
      report = await getGeneralLedger(parsed.data);
    } catch (error) {
      if (error instanceof ChartOfAccountNotFoundError) notFound();
      throw error;
    }
  }

  const activeBranch = branches.find((branch) => branch.id === params.branchId)?.name ?? "All branches";
  const activeAccount = accounts.find((account) => account.id === params.accountId);
  const filters = {
    accountId: params.accountId,
    from: params.from,
    to: params.to,
    branchId: params.branchId,
  };
  const hasActivity = (report?.sections.length ?? 0) > 0;
  const selectedSections = params.accountId ? report?.sections ?? [] : [];

  return (
    <div className="accounting-report-page space-y-5">
      <PageHeader
        title="General Ledger"
        description="Account activity, debits, credits and running balances for the selected period."
        actions={<ReportExportLinks path="/api/reports/general-ledger" filters={filters} />}
      />

      <Card title="Filters" className="report-filter-card">
        <ReportQuickLinks path="/accounting/reports/general-ledger" filters={filters} />
        <GeneralLedgerFilters
          accounts={accounts}
          branches={branches}
          defaultValues={params}
          clearHref="/accounting/reports/general-ledger"
        />
        <ActiveReportFilters
          from={params.from}
          to={params.to}
          branchName={`${activeBranch}${activeAccount ? ` · ${activeAccount.code} ${activeAccount.name}` : ""}`}
        />
      </Card>

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}

      {hasActivity && selectedSections.length > 0 && (
        <div className="space-y-3">
          {selectedSections.map((section) => (
            <div key={section.account.id} className="space-y-2">
              {selectedSections.length > 1 && (
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {section.account.code} — {section.account.name}
                </h2>
              )}
              <ReportSummary
                items={[
                  { label: "Opening Balance", value: section.openingBalance },
                  { label: "Total Debit", value: section.periodDebit },
                  { label: "Total Credit", value: section.periodCredit },
                  { label: "Closing Balance", value: section.closingBalance },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <TableBox title="Account activity">
        {!parsed.success ? null : !hasActivity ? (
          <EmptyState
            title="No activity for the selected period"
            action={<Link className="text-primary underline-offset-4 hover:underline" href="/accounting/reports/general-ledger">Clear filters</Link>}
          />
        ) : (
          <GeneralLedgerTable report={report!} />
        )}
      </TableBox>
    </div>
  );
}
