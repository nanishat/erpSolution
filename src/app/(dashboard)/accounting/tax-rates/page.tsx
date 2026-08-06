import Link from "next/link";

import { listTaxRates } from "@/modules/tax/services/tax-rate.service";
import { TaxRateTable } from "@/modules/tax/components/TaxRateTable";
import { Button } from "@/components/ui/button";

// listTaxRates defaults isActive to `true` when omitted, so active and
// inactive rates are fetched separately and merged here to show both in the
// list, de-emphasizing inactive rows rather than hiding them.
export const dynamic = "force-dynamic";

export default async function TaxRatesPage() {
  const [activeRates, inactiveRates] = await Promise.all([
    listTaxRates({ isActive: true }),
    listTaxRates({ isActive: false }),
  ]);

  const rates = [...activeRates, ...inactiveRates].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tax rates</h1>
          <p className="text-sm text-muted-foreground">
            Admin-maintained VAT rate list used when applying tax to a transaction.
          </p>
        </div>
        <Button asChild>
          <Link href="/accounting/tax-rates/new">New tax rate</Link>
        </Button>
      </div>

      <TaxRateTable rates={rates} />
    </div>
  );
}
