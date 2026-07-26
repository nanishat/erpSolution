import { CashBankVoucherForm } from "@/modules/accounting/components/CashBankVoucherForm";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";

// Credit Voucher records a receipt/income: Debit = the receiving Cash/Bank
// account, Credit = income/receivable account — money always flows in.
export function CreditVoucherForm({
  accounts,
  branches,
}: {
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  return (
    <CashBankVoucherForm
      voucherType="CREDIT_VOUCHER"
      otherAccountLabel="Income / Receivable Account"
      direction="in"
      accounts={accounts}
      branches={branches}
    />
  );
}
