"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ChartOfAccountWithChildren } from "@/modules/accounting/services/chart-of-account.service";
import type { BranchOption } from "@/modules/core/services/branch.service";

export function ChartOfAccountTree({
  topLevelAccounts,
  branches,
}: {
  topLevelAccounts: ChartOfAccountWithChildren[];
  branches: BranchOption[];
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedBranchByAccount, setSelectedBranchByAccount] = useState<
    Record<string, string>
  >({});

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (topLevelAccounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No accounts yet — create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {topLevelAccounts.map((account) => {
        const isExpanded = expandedIds.has(account.id);
        const selectedBranchId = selectedBranchByAccount[account.id] ?? "";
        const selectedBranch = branches.find((b) => b.id === selectedBranchId);

        return (
          <div key={account.id} className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2">
              <button
                type="button"
                onClick={() => toggleExpanded(account.id)}
                disabled={account.children.length === 0}
                className="flex items-center gap-1 text-sm font-medium disabled:opacity-40"
              >
                {isExpanded ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                {account.code} — {account.name}
              </button>

              {account.isSystem && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  System
                </span>
              )}
              {!account.isActive && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  Inactive
                </span>
              )}

              <span className="ml-auto text-xs text-muted-foreground">
                {account.children.length}{" "}
                {account.children.length === 1 ? "sub head" : "sub heads"}
              </span>

              <select
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                value={selectedBranchId}
                onChange={(e) =>
                  setSelectedBranchByAccount((prev) => ({
                    ...prev,
                    [account.id]: e.target.value,
                  }))
                }
              >
                <option value="">Select branch…</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isHeadOffice ? " (Head Office)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {selectedBranch && (
              <div className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {selectedBranch.name} total: 0.00 — branch-filtered calculation isn&apos;t
                wired up yet (no posted ledger data).
              </div>
            )}

            {isExpanded && account.children.length > 0 && (
              <div className="border-t border-border">
                <table className="w-full text-sm">
                  <tbody>
                    {account.children.map((child) => (
                      <tr key={child.id} className="border-t border-border first:border-t-0">
                        <td className="px-3 py-2 pl-10 text-muted-foreground">{child.code}</td>
                        <td className="px-3 py-2">
                          {child.name}
                          {!child.isActive && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {child.subType ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
