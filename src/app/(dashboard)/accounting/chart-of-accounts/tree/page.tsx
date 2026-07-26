import { listChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { getBranches } from "@/modules/core/services/branch.service";
import { ChartOfAccountTree } from "@/modules/accounting/components/ChartOfAccountTree";
import { ChartOfAccountsNav } from "@/modules/accounting/components/ChartOfAccountsNav";

export const dynamic = "force-dynamic";

export default async function ChartOfAccountsTreePage() {
  const [allAccounts, branches] = await Promise.all([
    listChartOfAccounts({}),
    getBranches(),
  ]);
  const topLevelAccounts = allAccounts.filter((a) => a.parentId === null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Chart of Accounts — Hierarchy</h1>
        <p className="text-sm text-muted-foreground">
          Pick a Head of Expense, then a branch, to see that head&apos;s per-branch
          figures. Branch totals are a placeholder until ledger postings exist.
        </p>
      </div>

      <ChartOfAccountsNav />

      <ChartOfAccountTree topLevelAccounts={topLevelAccounts} branches={branches} />
    </div>
  );
}
