import { listChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { ChartOfAccountForm } from "@/modules/accounting/components/ChartOfAccountForm";
import { ChartOfAccountsNav } from "@/modules/accounting/components/ChartOfAccountsNav";

export const dynamic = "force-dynamic";

export default async function NewChartOfAccountPage() {
  const allAccounts = await listChartOfAccounts({});
  const topLevelAccounts = allAccounts.filter((a) => a.parentId === null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New account</h1>
        <p className="text-sm text-muted-foreground">
          Add a Head of Expense (no parent) or a Sub Head under an existing one.
        </p>
      </div>

      <ChartOfAccountsNav />

      <ChartOfAccountForm mode="create" topLevelAccounts={topLevelAccounts} />
    </div>
  );
}
