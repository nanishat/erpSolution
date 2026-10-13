import { notFound } from "next/navigation";

import { GeneralLedgerFilters } from "@/modules/accounting/components/GeneralLedgerFilters";
import { GeneralLedgerTable } from "@/modules/accounting/components/GeneralLedgerTable";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">General Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Account activity and running balances for reportable journal entries.
        </p>
      </div>

      <GeneralLedgerFilters accounts={accounts} branches={branches} defaultValues={params} />
      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}
      {report && <GeneralLedgerTable report={report} />}
    </div>
  );
}
