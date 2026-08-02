import { notFound } from "next/navigation";

import { getBranches } from "@/modules/core/services/branch.service";
import {
  PartnerNotFoundError,
  getPartnerById,
} from "@/modules/partners/services/partner.service";
import { PartnerForm } from "@/modules/partners/components/PartnerForm";

export const dynamic = "force-dynamic";

export default async function EditPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [partner, branches] = await Promise.all([
    getPartnerById(id).catch((error) => {
      if (error instanceof PartnerNotFoundError) return null;
      throw error;
    }),
    getBranches(),
  ]);

  if (!partner) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Edit partner</h1>
        <p className="text-sm text-muted-foreground">
          {partner.name} — {partner.type}
        </p>
      </div>

      <PartnerForm mode="edit" partner={partner} branches={branches} />
    </div>
  );
}
