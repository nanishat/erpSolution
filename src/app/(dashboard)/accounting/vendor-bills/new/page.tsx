import { getBranches } from "@/modules/core/services/branch.service";
import { InvoiceForm } from "@/modules/invoicing/components/InvoiceForm";
import { listPartners } from "@/modules/partners/services/partner.service";
import { listProductServices } from "@/modules/products/services/product-service.service";

export const dynamic = "force-dynamic";

export default async function NewVendorBillPage() {
  const [partners, branches, productServices] = await Promise.all([
    listPartners({ type: "VENDOR", isActive: true }),
    getBranches(),
    listProductServices({ isActive: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New vendor bill</h1>
        <p className="text-sm text-muted-foreground">
          Tax isn&apos;t calculated here — attach it from the bill detail page after creating it.
        </p>
      </div>
      <InvoiceForm
        direction="VENDOR"
        partners={partners}
        branches={branches}
        productServices={productServices}
        basePath="/accounting/vendor-bills"
      />
    </div>
  );
}
