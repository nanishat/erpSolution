"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TaxApplicationStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaxApplicationListItem } from "@/modules/tax/services/tax-application.service";

const statusFilters: { value: TaxApplicationStatus | "ALL"; label: string }[] = [
  { value: "PENDING_REVIEW", label: "Pending review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

export function TaxApplicationTable({
  taxApplications,
}: {
  taxApplications: TaxApplicationListItem[];
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<TaxApplicationStatus | "ALL">(
    "PENDING_REVIEW"
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filtered =
    statusFilter === "ALL"
      ? taxApplications
      : taxApplications.filter((app) => app.status === statusFilter);

  const handleApprove = async (app: TaxApplicationListItem) => {
    if (!window.confirm(`Approve this ${app.taxType} application?`)) return;
    setPendingId(app.id);
    try {
      const res = await fetch(`/api/tax-applications/${app.id}/approve`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to approve tax application.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const handleReject = async (app: TaxApplicationListItem) => {
    const reason = window.prompt(`Reject this ${app.taxType} application? Optional reason:`);
    if (reason === null) return;
    setPendingId(app.id);
    try {
      const res = await fetch(`/api/tax-applications/${app.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to reject tax application.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (taxApplications.length === 0) {
    return <p className="text-sm text-muted-foreground">No tax applications yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="status-filter">
          Status
        </label>
        <select
          id="status-filter"
          className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaxApplicationStatus | "ALL")}
        >
          {statusFilters.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {statusFilter === "PENDING_REVIEW"
            ? "No tax applications pending review."
            : "No tax applications match this status."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Document #</th>
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">Tax type</th>
                <th className="px-3 py-2">Direction</th>
                <th className="px-3 py-2 text-right">Rate %</th>
                <th className="px-3 py-2 text-right">Base amount</th>
                <th className="px-3 py-2 text-right">Tax amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => {
                const isPending = pendingId === app.id;

                return (
                  <tr
                    key={app.id}
                    className={cn("border-t border-border", app.status !== "PENDING_REVIEW" && "opacity-70")}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/accounting/journal-entries/${app.journalEntry.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {app.journalEntry.documentNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{app.partner?.name ?? "—"}</td>
                    <td className="px-3 py-2">{app.taxType}</td>
                    <td className="px-3 py-2">{app.direction ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{Number(app.ratePercent).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(app.baseAmount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(app.taxAmount).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {app.status}
                      {app.status === "REJECTED" && app.rejectionReason && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {app.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {app.status === "PENDING_REVIEW" && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isPending}
                            onClick={() => handleApprove(app)}
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-2"
                            disabled={isPending}
                            onClick={() => handleReject(app)}
                          >
                            Reject
                          </Button>
                        </>
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
