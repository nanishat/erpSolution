import Link from "next/link";

import { listProductServices } from "@/modules/products/services/product-service.service";
import { ProductServiceTable } from "@/modules/products/components/ProductServiceTable";
import { Button } from "@/components/ui/button";

// listProductServices defaults isActive to `true` when omitted, so active and
// inactive rows are fetched separately and merged here to show both in the
// list, de-emphasizing inactive rows rather than hiding them.
export const dynamic = "force-dynamic";

export default async function ProductServicesPage() {
  const [active, inactive] = await Promise.all([
    listProductServices({ isActive: true }),
    listProductServices({ isActive: false }),
  ]);

  const productServices = [...active, ...inactive].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Products & services</h1>
          <p className="text-sm text-muted-foreground">
            Billable catalog used on invoice lines, mapped to income/expense accounts.
          </p>
        </div>
        <Button asChild>
          <Link href="/accounting/product-services/new">New product/service</Link>
        </Button>
      </div>

      <ProductServiceTable productServices={productServices} />
    </div>
  );
}
