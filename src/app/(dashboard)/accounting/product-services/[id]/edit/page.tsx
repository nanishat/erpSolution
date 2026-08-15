import { notFound } from "next/navigation";

import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import {
  ProductServiceNotFoundError,
  getProductServiceById,
} from "@/modules/products/services/product-service.service";
import { ProductServiceForm } from "@/modules/products/components/ProductServiceForm";

export const dynamic = "force-dynamic";

export default async function EditProductServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [productService, accounts] = await Promise.all([
    getProductServiceById(id).catch((error) => {
      if (error instanceof ProductServiceNotFoundError) return null;
      throw error;
    }),
    getActiveChartOfAccounts(),
  ]);

  if (!productService) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Edit product/service</h1>
        <p className="text-sm text-muted-foreground">
          {productService.code} — {productService.name}
        </p>
      </div>

      <ProductServiceForm mode="edit" productService={productService} accounts={accounts} />
    </div>
  );
}
