import type { InvoiceStatus } from "@prisma/client";

import { cn } from "@/lib/utils";

// One color per status so DRAFT/POSTED/PARTIALLY_PAID/PAID/CANCELLED/VOID
// are distinguishable at a glance in both InvoiceTable and the detail page —
// existing two-value badges (PartnerTable/ProductServiceTable) only needed
// primary/secondary, but six statuses need their own palette.
const STATUS_STYLES: Record<InvoiceStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  POSTED: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  PARTIALLY_PAID: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  PAID: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  CANCELLED: "bg-muted text-muted-foreground",
  VOID: "bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  PARTIALLY_PAID: "Partially Paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  VOID: "Void",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}
