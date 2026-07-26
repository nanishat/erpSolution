import { CashBankVoucherForm } from "@/modules/accounting/components/CashBankVoucherForm";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";

// Debit Voucher records a payment/expense: Debit = expense/payable account,
// Credit = the paying Cash/Bank account — money always flows out.
export function DebitVoucherForm({
  accounts,
  branches,
}: {
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  return (
    <CashBankVoucherForm
      voucherType="DEBIT_VOUCHER"
      otherAccountLabel="Expense / Payable Account"
      direction="out"
      accounts={accounts}
      branches={branches}
    />
  );
}
