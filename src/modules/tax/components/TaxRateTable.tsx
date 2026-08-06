"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaxRate } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TaxRateTable({ rates }: { rates: TaxRate[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleDeactivate = async (rate: TaxRate) => {
    if (!window.confirm(`Deactivate "${rate.name}"?`)) return;
    setPendingId(rate.id);
    try {
      const res = await fetch(`/api/tax-rates/${rate.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to deactivate tax rate.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (rates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tax rates yet — create one to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Direction</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Rate %</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => (
            <tr
              key={rate.id}
              className={cn("border-t border-border", !rate.isActive && "opacity-50")}
            >
              <td className="px-3 py-2">{rate.type}</td>
              <td className="px-3 py-2">{rate.direction}</td>
              <td className="px-3 py-2">{rate.category}</td>
              <td className="px-3 py-2">{rate.name}</td>
              <td className="px-3 py-2">{rate.ratePercent.toString()}</td>
              <td className="px-3 py-2">{rate.isActive ? "Active" : "Inactive"}</td>
              <td className="px-3 py-2 text-right">
                {rate.isActive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pendingId === rate.id}
                    onClick={() => handleDeactivate(rate)}
                  >
                    Deactivate
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
