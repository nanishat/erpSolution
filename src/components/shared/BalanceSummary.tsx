import { Amount } from "@/components/shared/Amount";
import { StatusBadge } from "@/components/shared/StatusBadge";

export function toPaisa(amount: number) {
  return Math.round((amount || 0) * 100);
}

export function BalanceSummary({
  debitPaisa,
  creditPaisa,
}: {
  debitPaisa: number;
  creditPaisa: number;
}) {
  const differencePaisa = debitPaisa - creditPaisa;
  const balanced = differencePaisa === 0;

  return (
    <div className="sticky bottom-0 z-10 grid gap-3 rounded-lg border border-border bg-card p-3 shadow-card sm:grid-cols-4">
      <div className="text-sm">
        <span className="text-muted-foreground">Total Debit</span>
        <div className="font-medium tabular-nums"><Amount value={debitPaisa / 100} /></div>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Total Credit</span>
        <div className="font-medium tabular-nums"><Amount value={creditPaisa / 100} /></div>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Difference</span>
        <div className={`font-medium tabular-nums ${differencePaisa < 0 ? "text-danger-foreground" : ""}`}>
          <Amount value={differencePaisa / 100} />
        </div>
      </div>
      <div className="flex items-center sm:justify-end">
        <StatusBadge status={balanced ? "BALANCED" : "UNBALANCED"} />
      </div>
    </div>
  );
}
