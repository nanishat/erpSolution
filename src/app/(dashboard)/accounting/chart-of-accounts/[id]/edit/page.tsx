import { notFound } from "next/navigation";

import {
  ChartOfAccountNotFoundError,
  getChartOfAccountById,
  listChartOfAccounts,
} from "@/modules/accounting/services/chart-of-account.service";
import { ChartOfAccountForm } from "@/modules/accounting/components/ChartOfAccountForm";
import { ChartOfAccountsNav } from "@/modules/accounting/components/ChartOfAccountsNav";

export const dynamic = "force-dynamic";

export default async function EditChartOfAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [account, allAccounts] = await Promise.all([
    getChartOfAccountById(id).catch((error) => {
      if (error instanceof ChartOfAccountNotFoundError) return null;
      throw error;
    }),
    listChartOfAccounts({}),
  ]);

  if (!account) {
    notFound();
  }

  const topLevelAccounts = allAccounts.filter((a) => a.parentId === null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Edit account</h1>
        <p className="text-sm text-muted-foreground">
          {account.code} — {account.name}
        </p>
      </div>

      <ChartOfAccountsNav />

      <ChartOfAccountForm mode="edit" account={account} topLevelAccounts={topLevelAccounts} />
    </div>
  );
}
