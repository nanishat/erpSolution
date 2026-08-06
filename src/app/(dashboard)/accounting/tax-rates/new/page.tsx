import { TaxRateForm } from "@/modules/tax/components/TaxRateForm";

export const dynamic = "force-dynamic";

export default function NewTaxRatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New tax rate</h1>
        <p className="text-sm text-muted-foreground">
          Add a VAT rate list entry that transactions can pick from.
        </p>
      </div>

      <TaxRateForm />
    </div>
  );
}
