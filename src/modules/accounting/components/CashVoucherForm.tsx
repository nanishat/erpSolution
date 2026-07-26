import { CashBankVoucherForm } from "@/modules/accounting/components/CashBankVoucherForm";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";

export function CashVoucherForm({
  accounts,
  branches,
}: {
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  return (
    <CashBankVoucherForm
      voucherType="CASH_VOUCHER"
      otherAccountLabel="Other Account"
      direction="user-choice"
      accounts={accounts}
      branches={branches}
    />
  );
}
