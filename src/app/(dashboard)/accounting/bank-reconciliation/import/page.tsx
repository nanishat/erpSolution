import { getReconcilableChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { ImportBankStatementForm } from "@/modules/bank-reconciliation/components/ImportBankStatementForm";

export const dynamic = "force-dynamic";

export default async function ImportBankStatementPage() {
  const accounts = await getReconcilableChartOfAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import bank statement</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV export from your bank, map its columns if needed, preview the parsed
          lines, then confirm the import.
        </p>
      </div>
      <ImportBankStatementForm accounts={accounts} />
    </div>
  );
}
