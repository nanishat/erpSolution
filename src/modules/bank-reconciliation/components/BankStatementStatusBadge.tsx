import { StatusBadge } from "@/components/shared/StatusBadge";

export function BankStatementStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}
