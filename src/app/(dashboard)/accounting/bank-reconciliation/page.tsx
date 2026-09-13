import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BankStatementTable } from "@/modules/bank-reconciliation/components/BankStatementTable";
import { listBankStatements } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";

// Statement/line state changes as matching happens elsewhere in the app —
// same "never statically prerendered" rule as the journal entries list.
export const dynamic = "force-dynamic";

export default async function BankReconciliationPage() {
  const statements = await listBankStatements();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bank Reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Imported bank statements and their matching progress.
          </p>
        </div>
        <Button asChild>
          <Link href="/accounting/bank-reconciliation/import">Import statement</Link>
        </Button>
      </div>
      <BankStatementTable statements={statements} />
    </div>
  );
}
