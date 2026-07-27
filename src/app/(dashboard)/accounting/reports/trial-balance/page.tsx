import { getTrialBalance } from "@/modules/accounting/services/trial-balance.service";
import { getBranches } from "@/modules/core/services/branch.service";
import { TrialBalanceFilters } from "@/modules/accounting/components/TrialBalanceFilters";
import { TrialBalanceTable } from "@/modules/accounting/components/TrialBalanceTable";

// Trial balance reflects posted activity as of now — never statically prerendered/cached.
export const dynamic = "force-dynamic";

type TrialBalanceSearchParams = {
  from?: string;
  to?: string;
  branchId?: string;
  includeZeroBalances?: string;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trial Balance</h1>
        <p className="text-sm text-muted-foreground">
          Debit/credit totals for posted journal activity, by account.
        </p>
      </div>

      <TrialBalanceFilters branches={branches} defaultValues={params} />

      <TrialBalanceTable report={report} />
    </div>
  );
}
