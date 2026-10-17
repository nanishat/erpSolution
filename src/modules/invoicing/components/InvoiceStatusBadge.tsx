import type { InvoiceStatus } from "@prisma/client";

import { StatusBadge } from "@/components/shared/StatusBadge";

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <StatusBadge status={status} />;
}
