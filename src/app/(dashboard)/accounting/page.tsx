import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function AccountingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Summary and charts will appear here.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href="/accounting/journal-entries/new">New Voucher</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/accounting/invoices/new">New Invoice</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/accounting/vendor-bills/new">New Vendor Bill</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/accounting/payments/new">Record Payment</Link>
        </Button>
      </div>
    </div>
  );
}
