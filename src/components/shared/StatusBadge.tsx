import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  POSTED: "bg-success-soft text-success-foreground",
  PAID: "bg-success-soft text-success-foreground",
  RECONCILED: "bg-success-soft text-success-foreground",
  MATCHED: "bg-success-soft text-success-foreground",
  FULLY_APPLIED: "bg-success-soft text-success-foreground",
  ACTIVE: "bg-success-soft text-success-foreground",
  PARTIALLY_PAID: "bg-warning-soft text-warning-foreground",
  IN_PROGRESS: "bg-warning-soft text-warning-foreground",
  PARTIALLY_APPLIED: "bg-warning-soft text-warning-foreground",
  UNMATCHED: "bg-warning-soft text-warning-foreground",
  OPEN: "bg-warning-soft text-warning-foreground",
  VOID: "bg-danger-soft text-danger-foreground",
  CANCELLED: "bg-danger-soft text-danger-foreground",
  REVERSED: "bg-danger-soft text-danger-foreground",
  OVERDUE: "bg-danger-soft text-danger-foreground",
  IMPORTED: "bg-muted text-muted-foreground",
  IGNORED: "bg-muted text-muted-foreground",
  DISPOSED: "bg-muted text-muted-foreground",
  FULLY_DEPRECIATED: "bg-muted text-muted-foreground",
};

export function humanizeStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {label ?? humanizeStatus(status)}
    </span>
  );
}
