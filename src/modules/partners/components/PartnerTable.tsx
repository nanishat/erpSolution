"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Partner, PartnerType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BranchOption } from "@/modules/core/services/branch.service";

export function PartnerTable({
  partners,
  branches,
}: {
  partners: Partner[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<PartnerType | "">("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const branchesById = useMemo(() => {
    const map = new Map<string, BranchOption>();
    for (const branch of branches) map.set(branch.id, branch);
    return map;
  }, [branches]);

  const filtered = partners.filter((partner) => {
    if (typeFilter && partner.type !== typeFilter) return false;
    if (activeFilter === "active" && !partner.isActive) return false;
    if (activeFilter === "inactive" && partner.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      const matches =
        partner.name.toLowerCase().includes(q) ||
        partner.tin.toLowerCase().includes(q) ||
        partner.bin.toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const handleDeactivate = async (partner: Partner) => {
    if (!window.confirm(`Deactivate "${partner.name}"?`)) return;
    setPendingId(partner.id);
    try {
      const res = await fetch(`/api/partners/${partner.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to deactivate partner.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (partners.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No partners yet — create one to get started.
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
            onChange={(e) => setTypeFilter(e.target.value as PartnerType | "")}
          >
            <option value="">All types</option>
            <option value="CUSTOMER">CUSTOMER</option>
            <option value="VENDOR">VENDOR</option>
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
        <div>
          <label className="text-sm font-medium" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            type="text"
            placeholder="Name, TIN, or BIN"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No partners match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">TIN</th>
                <th className="px-3 py-2">BIN</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((partner) => {
                const branch = partner.localBranchId
                  ? branchesById.get(partner.localBranchId)
                  : null;

                return (
                  <tr
                    key={partner.id}
                    className={cn("border-t border-border", !partner.isActive && "opacity-50")}
                  >
                    <td className="px-3 py-2">{partner.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-medium",
                          partner.type === "CUSTOMER"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary text-secondary-foreground"
                        )}
                      >
                        {partner.type}
                      </span>
                    </td>
                    <td className="px-3 py-2">{partner.tin}</td>
                    <td className="px-3 py-2">{partner.bin}</td>
                    <td className="px-3 py-2">{partner.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {branch ? branch.name : "Company-wide"}
                    </td>
                    <td className="px-3 py-2">{partner.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/partners/${partner.id}/edit`}
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      >
                        Edit
                      </Link>
                      {partner.isActive && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-2"
                          disabled={pendingId === partner.id}
                          onClick={() => handleDeactivate(partner)}
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
      )}
    </div>
  );
}
