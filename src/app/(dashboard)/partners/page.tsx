import Link from "next/link";

import { listPartners } from "@/modules/partners/services/partner.service";
import { getBranches } from "@/modules/core/services/branch.service";
import { PartnerTable } from "@/modules/partners/components/PartnerTable";
import { Button } from "@/components/ui/button";

// Partner data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  // listPartners defaults isActive to `true` when omitted (see partner.service.ts),
  // so active and inactive partners are fetched separately and merged here to
  // show both in the list, de-emphasizing inactive rows rather than hiding them.
  const [activePartners, inactivePartners, branches] = await Promise.all([
    listPartners({ isActive: true }),
    listPartners({ isActive: false }),
    getBranches(),
  ]);

  const partners = [...activePartners, ...inactivePartners].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Partners</h1>
          <p className="text-sm text-muted-foreground">
            Customers and vendors used across accounting and procurement.
          </p>
        </div>
        <Button asChild>
          <Link href="/partners/new">New partner</Link>
        </Button>
      </div>

      <PartnerTable partners={partners} branches={branches} />
    </div>
  );
}
