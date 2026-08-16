import type { Partner as PartnerRow, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type {
  CreatePartnerInput,
  ListPartnersQuery,
  UpdatePartnerInput,
} from "@/modules/partners/validations/partner.schema";

// outstandingBalance/payableBalance are Prisma Decimals, which React Server
// Components can't pass to "use client" components ("Decimal objects are
// not supported") — convert to plain numbers before this ever reaches
// PartnerTable/PartnerForm, mirroring serializeProductService().
export type Partner = Omit<PartnerRow, "outstandingBalance" | "payableBalance"> & {
  outstandingBalance: number;
  payableBalance: number;
};

function serializePartner(partner: PartnerRow): Partner {
  return {
    ...partner,
    outstandingBalance: Number(partner.outstandingBalance),
    payableBalance: Number(partner.payableBalance),
  };
}

export class PartnerNotFoundError extends Error {
  constructor(id: string) {
    super(`Partner ${id} not found`);
    this.name = "PartnerNotFoundError";
  }
}

export class PartnerLocalBranchNotFoundError extends Error {
  constructor(id: string) {
    super(`Branch ${id} not found`);
    this.name = "PartnerLocalBranchNotFoundError";
  }
}

export class PartnerTypeImmutableError extends Error {
  constructor(id: string, currentType: string, attemptedType: string) {
    super(`Partner ${id} is a ${currentType} and cannot be changed to ${attemptedType}`);
    this.name = "PartnerTypeImmutableError";
  }
}

export async function listPartners(filter: ListPartnersQuery): Promise<Partner[]> {
  const where: Prisma.PartnerWhereInput = {
    type: filter.type,
    // Default list excludes deactivated partners; pass isActive=false explicitly to see them.
    isActive: filter.isActive ?? true,
    localBranchId: filter.localBranchId,
  };

  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: "insensitive" } },
      { tin: { contains: filter.search, mode: "insensitive" } },
      { bin: { contains: filter.search, mode: "insensitive" } },
    ];
  }

  const partners = await db.partner.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return partners.map(serializePartner);
}

export async function getPartnerById(id: string): Promise<Partner> {
  const partner = await db.partner.findUnique({ where: { id } });

  if (!partner) {
    throw new PartnerNotFoundError(id);
  }

  return serializePartner(partner);
}

async function assertLocalBranchExists(
  tx: Prisma.TransactionClient,
  localBranchId: string
): Promise<void> {
  const branch = await tx.branch.findUnique({
    where: { id: localBranchId },
    select: { id: true },
  });
  if (!branch) {
    throw new PartnerLocalBranchNotFoundError(localBranchId);
  }
}

export async function createPartner(input: CreatePartnerInput): Promise<Partner> {
  return db.$transaction(async (tx) => {
    if (input.localBranchId) {
      await assertLocalBranchExists(tx, input.localBranchId);
    }

    const created = await tx.partner.create({
      data: {
        type: input.type,
        name: input.name,
        contactPerson: input.contactPerson,
        phone: input.phone,
        email: input.email,
        address: input.address,
        tin: input.tin,
        bin: input.bin,
        bankName: input.bankName,
        bankAccountNumber: input.bankAccountNumber,
        bankBranch: input.bankBranch,
        routingNumber: input.routingNumber,
        creditTermsDays: input.creditTermsDays,
        vatInclusiveInPrice: input.vatInclusiveInPrice,
        tdsExempt: input.tdsExempt ?? false,
        tdsExemptionCertNumber: input.tdsExemptionCertNumber,
        tdsExemptionExpiryDate: input.tdsExemptionExpiryDate,
        localBranchId: input.localBranchId,
        // TODO: derive createdById from the authenticated session once auth is wired up.
        createdById: input.createdById,
      },
    });
    return serializePartner(created);
  });
}

export async function updatePartner(id: string, input: UpdatePartnerInput): Promise<Partner> {
  return db.$transaction(async (tx) => {
    const existing = await tx.partner.findUnique({ where: { id } });
    if (!existing) {
      throw new PartnerNotFoundError(id);
    }

    if (input.type && input.type !== existing.type) {
      throw new PartnerTypeImmutableError(id, existing.type, input.type);
    }

    if (input.localBranchId) {
      await assertLocalBranchExists(tx, input.localBranchId);
    }

    const updated = await tx.partner.update({
      where: { id },
      data: {
        name: input.name,
        contactPerson: input.contactPerson,
        phone: input.phone,
        email: input.email,
        address: input.address,
        tin: input.tin,
        bin: input.bin,
        bankName: input.bankName,
        bankAccountNumber: input.bankAccountNumber,
        bankBranch: input.bankBranch,
        routingNumber: input.routingNumber,
        creditTermsDays: input.creditTermsDays,
        vatInclusiveInPrice: input.vatInclusiveInPrice,
        tdsExempt: input.tdsExempt,
        tdsExemptionCertNumber: input.tdsExemptionCertNumber,
        tdsExemptionExpiryDate: input.tdsExemptionExpiryDate,
        localBranchId: input.localBranchId,
        isActive: input.isActive,
      },
    });
    return serializePartner(updated);
  });
}

export async function deactivatePartner(id: string): Promise<Partner> {
  const existing = await db.partner.findUnique({ where: { id } });
  if (!existing) {
    throw new PartnerNotFoundError(id);
  }

  const deactivated = await db.partner.update({
    where: { id },
    data: { isActive: false },
  });
  return serializePartner(deactivated);
}
