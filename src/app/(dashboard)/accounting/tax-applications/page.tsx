import { listTaxApplications } from "@/modules/tax/services/tax-application.service";
import { TaxApplicationTable } from "@/modules/tax/components/TaxApplicationTable";

// The approval queue must always reflect the latest status — never
// statically prerendered/cached.
export const dynamic = "force-dynamic";

export default async function TaxApplicationsPage() {
  const taxApplications = await listTaxApplications();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tax approval queue</h1>
        <p className="text-sm text-muted-foreground">
          Review tax calculated on journal entries — approving unblocks posting, rejecting
          records a reason.
        </p>
      </div>

      <TaxApplicationTable taxApplications={taxApplications} />
    </div>
  );
}
