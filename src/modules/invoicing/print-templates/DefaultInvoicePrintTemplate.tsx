import type { InvoicePrintTemplateProps } from "@/modules/invoicing/print-templates/types";

/**
 * General-purpose print layout: header, partner info, line items, totals.
 * The fallback template in the registry — used for any sector without a
 * dedicated layout, and for Vendor Bills (sector is always null there).
 */
export function DefaultInvoicePrintTemplate({ invoice }: InvoicePrintTemplateProps) {
  const remaining = invoice.grandTotal - invoice.amountPaid;
  const documentLabel = invoice.direction === "CUSTOMER" ? "Invoice" : "Vendor Bill";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8 text-sm text-black">
      <div className="flex items-start justify-between border-b border-black pb-4">
        <div>
          <h1 className="text-lg font-semibold">{documentLabel}</h1>
          <p className="font-mono text-xs">{invoice.invoiceNumber}</p>
        </div>
        <div className="text-right text-xs">
          <p>Date: {invoice.date.toLocaleDateString()}</p>
          {invoice.dueDate && <p>Due: {invoice.dueDate.toLocaleDateString()}</p>}
          <p>Branch: {invoice.branch.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="font-medium text-black/60">
            {invoice.direction === "CUSTOMER" ? "Bill to" : "Bill from"}
          </p>
          <p className="text-sm font-medium">{invoice.partner.name}</p>
        </div>
        {invoice.sector && (
          <div className="text-right">
            <p className="font-medium text-black/60">Sector</p>
            <p>{invoice.sector}</p>
          </div>
        )}
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1.5">Description</th>
            <th className="py-1.5 text-right">Qty</th>
            <th className="py-1.5 text-right">Unit price</th>
            <th className="py-1.5 text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-black/20">
              <td className="py-1.5">{line.description}</td>
              <td className="py-1.5 text-right">{line.quantity.toFixed(2)}</td>
              <td className="py-1.5 text-right">{line.unitPrice.toFixed(2)}</td>
              <td className="py-1.5 text-right">{line.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto w-56 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{invoice.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{invoice.taxTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-black pt-1 font-medium">
          <span>Grand total</span>
          <span>{invoice.grandTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Paid</span>
          <span>{invoice.amountPaid.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Remaining</span>
          <span>{remaining.toFixed(2)}</span>
        </div>
      </div>

      {invoice.notes && (
        <div className="border-t border-black/20 pt-3 text-xs">
          <p className="font-medium text-black/60">Notes</p>
          <p>{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
