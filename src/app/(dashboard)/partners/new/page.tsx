import { getBranches } from "@/modules/core/services/branch.service";
import { PartnerForm } from "@/modules/partners/components/PartnerForm";

export const dynamic = "force-dynamic";

export default async function NewPartnerPage() {
  const branches = await getBranches();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New partner</h1>
        <p className="text-sm text-muted-foreground">
          Add a customer or vendor. Type can&apos;t be changed after creation.
        </p>
      </div>

      <PartnerForm mode="create" branches={branches} />
    </div>
  );
}
