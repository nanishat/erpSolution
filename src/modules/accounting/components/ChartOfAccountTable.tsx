"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountWithChildren } from "@/modules/accounting/services/chart-of-account.service";

const typeOrder: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

export function ChartOfAccountTable({
  accounts,
}: {
  accounts: ChartOfAccountWithChildren[];
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<AccountType | "">("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const accountsById = useMemo(() => {
    const map = new Map<string, ChartOfAccountWithChildren>();
    for (const account of accounts) map.set(account.id, account);
    return map;
  }, [accounts]);

  const filtered = accounts.filter((account) => {
    if (typeFilter && account.type !== typeFilter) return false;
    if (activeFilter === "active" && !account.isActive) return false;
    if (activeFilter === "inactive" && account.isActive) return false;
    return true;
  });

  const grouped = typeOrder
    .map((type) => ({ type, rows: filtered.filter((a) => a.type === type) }))
    .filter((group) => group.rows.length > 0);

  const handleDeactivate = async (account: ChartOfAccountWithChildren) => {
    if (!window.confirm(`Deactivate "${account.name}"?`)) return;
    setPendingId(account.id);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to deactivate account.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No accounts yet — create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-sm font-medium" htmlFor="type-filter">
            Type
          </label>
          <select
            id="type-filter"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as AccountType | "")}
          >
            <option value="">All types</option>
            {typeOrder.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="active-filter">
            Status
          </label>
          <select
            id="active-filter"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={activeFilter}
            onChange={(e) =>
              setActiveFilter(e.target.value as "all" | "active" | "inactive")
            }
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accounts match these filters.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.type} className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold uppercase" colSpan={6}>
                      {group.type}
                    </th>
                  </tr>
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Parent</th>
                    <th className="px-3 py-2">Sub type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((account) => {
                    const parent = account.parentId
                      ? accountsById.get(account.parentId)
                      : null;

                    return (
                      <tr
                        key={account.id}
                        className={
                          "border-t border-border" + (!account.isActive ? " opacity-50" : "")
                        }
                      >
                        <td className="px-3 py-2">{account.code}</td>
                        <td className="px-3 py-2">
                          {account.name}
                          {account.isSystem && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              System
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {parent ? `↳ ${parent.code}` : "—"}
                        </td>
                        <td className="px-3 py-2">{account.subType ?? "—"}</td>
                        <td className="px-3 py-2">{account.isActive ? "Active" : "Inactive"}</td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/accounting/chart-of-accounts/${account.id}/edit`}
                            className="text-sm text-primary underline-offset-4 hover:underline"
                          >
                            Edit
                          </Link>
                          {account.isActive && !account.isSystem && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="ml-2"
                              disabled={pendingId === account.id}
                              onClick={() => handleDeactivate(account)}
                            >
                              Deactivate
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
