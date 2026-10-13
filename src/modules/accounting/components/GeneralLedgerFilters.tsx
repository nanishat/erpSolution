import { Button } from "@/components/ui/button";
import type { BranchOption } from "@/modules/core/services/branch.service";
import type { GeneralLedgerAccountOption } from "@/modules/accounting/services/general-ledger.service";

export function GeneralLedgerFilters({
  accounts,
  branches,
  defaultValues,
}: {
  accounts: GeneralLedgerAccountOption[];
  branches: BranchOption[];
  defaultValues: {
    accountId?: string;
    from?: string;
    to?: string;
    branchId?: string;
  };
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4"
    >
      <div>
        <label className="text-sm font-medium" htmlFor="accountId">
          Account
        </label>
        <select
          id="accountId"
          name="accountId"
          defaultValue={defaultValues.accountId ?? ""}
          className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
              {!account.isPostable ? " (Header)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="from">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={defaultValues.from ?? ""}
          className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="to">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={defaultValues.to ?? ""}
          className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="branchId">
          Branch
        </label>
        <select
          id="branchId"
          name="branchId"
          defaultValue={defaultValues.branchId ?? ""}
          className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">All branches</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
              {branch.isHeadOffice ? " (Head Office)" : ""}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit">Apply</Button>
    </form>
  );
}
