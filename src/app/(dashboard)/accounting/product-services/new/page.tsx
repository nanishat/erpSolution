import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { ProductServiceForm } from "@/modules/products/components/ProductServiceForm";

export const dynamic = "force-dynamic";

export default async function NewProductServicePage() {
  const accounts = await getActiveChartOfAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New product/service</h1>
        <p className="text-sm text-muted-foreground">
          Add a catalog entry that invoice lines can pick from.
        </p>
      </div>

      <ProductServiceForm mode="create" accounts={accounts} />
    </div>
  );
}
