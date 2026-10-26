import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { getBranches } from "@/modules/core/services/branch.service";
import { RecordPaymentForm } from "@/modules/payments/components/RecordPaymentForm";
import { listPartners } from "@/modules/partners/services/partner.service";

export const dynamic = "force-dynamic";

export default async function NewGeneralPaymentPage() {
  const [partners, accounts, branches] = await Promise.all([
    listPartners({ isActive: true }),
    getActiveChartOfAccounts(),
    getBranches(),
  ]);

  return (
    <div className="space-y-6">
      <RecordPaymentForm partners={partners} accounts={accounts} branches={branches} />
    </div>
  );
}
