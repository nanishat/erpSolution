import Link from "next/link";

import { Button } from "@/components/ui/button";
import { InvoiceTable } from "@/modules/invoicing/components/InvoiceTable";
import { getInvoices } from "@/modules/invoicing/services/invoice.service";
import { listPartners } from "@/modules/partners/services/partner.service";

// Ledger data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/invoices";

export default async function CustomerInvoicesPage() {
  const [invoices, partners] = await Promise.all([
    getInvoices({ direction: "CUSTOMER" }),
    listPartners({ type: "CUSTOMER", isActive: true }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Customer Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Create and track invoices raised against customers.
          </p>
        </div>
        <Button asChild>
          <Link href={`${BASE_PATH}/new`}>New invoice</Link>
        </Button>
      </div>
      <InvoiceTable invoices={invoices} partners={partners} basePath={BASE_PATH} />
    </div>
  );
}
