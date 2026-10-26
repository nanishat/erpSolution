import type { InvoiceWithLines } from "@/modules/invoicing/services/invoice.service";
import { Amount } from "@/components/shared/Amount";
import { TableBox, Td, Th } from "@/components/shared/TableBox";

export function PaymentHistoryTable({ payments }: { payments: InvoiceWithLines["payments"] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded yet.</p>;
  }

  return (
    <TableBox title="Payment History">
      <table className="w-full">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Method</Th>
            <Th>Reference</Th>
            <Th alignment="right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-t border-border">
              <Td>{payment.date.toLocaleDateString()}</Td>
              <Td>{payment.method ?? "—"}</Td>
              <Td>{payment.reference ?? "—"}</Td>
              <Td alignment="right"><Amount value={payment.amount} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}
