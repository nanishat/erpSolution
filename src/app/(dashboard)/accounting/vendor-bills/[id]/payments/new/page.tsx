import Link from "next/link";
import { notFound } from "next/navigation";

import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { RecordPaymentForm } from "@/modules/invoicing/components/RecordPaymentForm";
import { getInvoiceById } from "@/modules/invoicing/services/invoice.service";

export const dynamic = "force-dynamic";

export default async function RecordVendorBillPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoiceById(id);

  if (!invoice) {
    notFound();
  }

  const detailHref = `/accounting/vendor-bills/${invoice.id}`;
  const remaining = invoice.grandTotal - invoice.amountPaid;

  if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Bill {invoice.invoiceNumber} is {invoice.status} and cannot receive a payment.
        </p>
        <Link href={detailHref} className="text-sm text-primary underline-offset-4 hover:underline">
          ← Back to bill
        </Link>
      </div>
    );
  }

  const accounts = await getActiveChartOfAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Record payment</h1>
        <p className="text-sm text-muted-foreground">
          Against bill {invoice.invoiceNumber} — {invoice.partner.name}
        </p>
      </div>
      <RecordPaymentForm
        invoiceId={invoice.id}
        remaining={remaining}
        accounts={accounts}
        detailHref={detailHref}
      />
    </div>
  );
}
