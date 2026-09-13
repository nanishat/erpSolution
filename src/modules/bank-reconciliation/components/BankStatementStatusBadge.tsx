import { cn } from "@/lib/utils";

// Mirrors InvoiceStatusBadge's one-color-per-status convention.
const STATUS_STYLES: Record<string, string> = {
  IMPORTED: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  IN_PROGRESS: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  RECONCILED: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
};

const STATUS_LABELS: Record<string, string> = {
  IMPORTED: "Imported",
  IN_PROGRESS: "In Progress",
  RECONCILED: "Reconciled",
};

export function BankStatementStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
