import type { InvoiceWithLines } from "@/modules/invoicing/services/invoice.service";

export function PaymentHistoryTable({ payments }: { payments: InvoiceWithLines["payments"] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Method</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-t border-border">
              <td className="px-3 py-2">{payment.date.toLocaleDateString()}</td>
              <td className="px-3 py-2">{payment.method ?? "—"}</td>
              <td className="px-3 py-2">{payment.reference ?? "—"}</td>
              <td className="px-3 py-2 text-right">{payment.amount.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
