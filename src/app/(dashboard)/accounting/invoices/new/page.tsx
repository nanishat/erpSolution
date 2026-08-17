import { getBranches } from "@/modules/core/services/branch.service";
import { InvoiceForm } from "@/modules/invoicing/components/InvoiceForm";
import { listPartners } from "@/modules/partners/services/partner.service";
import { listProductServices } from "@/modules/products/services/product-service.service";

export const dynamic = "force-dynamic";

export default async function NewCustomerInvoicePage() {
  const [partners, branches, productServices] = await Promise.all([
    listPartners({ type: "CUSTOMER", isActive: true }),
    getBranches(),
    listProductServices({ isActive: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New customer invoice</h1>
        <p className="text-sm text-muted-foreground">
          Tax isn&apos;t calculated here — attach it from the invoice detail page after creating it.
        </p>
      </div>
      <InvoiceForm
        direction="CUSTOMER"
        partners={partners}
        branches={branches}
        productServices={productServices}
        basePath="/accounting/invoices"
      />
    </div>
  );
}
