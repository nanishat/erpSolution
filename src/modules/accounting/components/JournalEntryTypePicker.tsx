"use client";

import { useState } from "react";
import { VoucherType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { VOUCHER_TYPE_DESCRIPTIONS, VOUCHER_TYPE_LABELS } from "@/modules/accounting/constants/voucher-type";
import { CashVoucherForm } from "@/modules/accounting/components/CashVoucherForm";
import { DebitVoucherForm } from "@/modules/accounting/components/DebitVoucherForm";
import { CreditVoucherForm } from "@/modules/accounting/components/CreditVoucherForm";
import { JournalEntryForm } from "@/modules/accounting/components/JournalEntryForm";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { BranchOption } from "@/modules/core/services/branch.service";

const VOUCHER_TYPES = Object.values(VoucherType);

export function JournalEntryTypePicker({
  accounts,
  branches,
}: {
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  const [selected, setSelected] = useState<VoucherType | null>(null);

  if (!selected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Which voucher type is this?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {VOUCHER_TYPES.map((voucherType) => (
            <button
              key={voucherType}
              type="button"
              onClick={() => setSelected(voucherType)}
              className="rounded-lg border border-border p-4 text-left transition-colors hover:border-primary hover:bg-muted"
            >
              <div className="font-medium">{VOUCHER_TYPE_LABELS[voucherType]}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {VOUCHER_TYPE_DESCRIPTIONS[voucherType]}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{VOUCHER_TYPE_LABELS[selected]}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
          Change voucher type
        </Button>
      </div>

      {selected === "CASH_VOUCHER" && (
        <CashVoucherForm accounts={accounts} branches={branches} />
      )}
      {selected === "DEBIT_VOUCHER" && (
        <DebitVoucherForm accounts={accounts} branches={branches} />
      )}
      {selected === "CREDIT_VOUCHER" && (
        <CreditVoucherForm accounts={accounts} branches={branches} />
      )}
      {selected === "JOURNAL_VOUCHER" && (
        <JournalEntryForm mode="create" accounts={accounts} branches={branches} />
      )}
    </div>
  );
}
