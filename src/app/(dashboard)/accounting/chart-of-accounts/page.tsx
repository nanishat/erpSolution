import Link from "next/link";

import { listChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { ChartOfAccountTable } from "@/modules/accounting/components/ChartOfAccountTable";
import { ChartOfAccountsNav } from "@/modules/accounting/components/ChartOfAccountsNav";
import { Button } from "@/components/ui/button";

// Chart of Accounts is centrally calculated — never statically prerendered/cached.
export const dynamic = "force-dynamic";

export default async function ChartOfAccountsPage() {
  const accounts = await listChartOfAccounts({});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground">
            One shared, centrally-calculated chart of accounts — not scoped per branch.
          </p>
        </div>
        <Button asChild>
          <Link href="/accounting/chart-of-accounts/new">New account</Link>
        </Button>
      </div>

      <ChartOfAccountsNav />

      <ChartOfAccountTable accounts={accounts} />
    </div>
  );
}
