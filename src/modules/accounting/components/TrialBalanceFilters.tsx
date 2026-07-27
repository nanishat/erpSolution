import { Button } from "@/components/ui/button";
import type { BranchOption } from "@/modules/core/services/branch.service";

export function TrialBalanceFilters({
  branches,
  defaultValues,
}: {
  branches: BranchOption[];
  defaultValues: {
    from?: string;
    to?: string;
    branchId?: string;
    includeZeroBalances?: string;
  };
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4"
    >
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
      <div className="flex items-center gap-2 pb-1.5">
        <input
          id="includeZeroBalances"
          name="includeZeroBalances"
          type="checkbox"
          value="true"
          defaultChecked={defaultValues.includeZeroBalances === "true"}
          className="size-4 rounded border-input"
        />
        <label className="text-sm font-medium" htmlFor="includeZeroBalances">
          Include zero-balance accounts
        </label>
      </div>
      <Button type="submit">Apply</Button>
    </form>
  );
}
