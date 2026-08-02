import { PartnerType } from "@prisma/client";
import { z } from "zod";

// tdsExemptionExpiryDate must be in the future when provided — a cert that's
// already expired isn't a valid "exemption in effect" record.
function refineFutureExemptionDate<T extends { tdsExemptionExpiryDate?: Date | null }>(
  data: T
): boolean {
  if (!data.tdsExemptionExpiryDate) return true;
  return data.tdsExemptionExpiryDate.getTime() > Date.now();
}

const futureExemptionDateIssue = {
  message: "tdsExemptionExpiryDate must be a future date",
  path: ["tdsExemptionExpiryDate"],
};

export const createPartnerSchema = z
  .object({
    type: z.nativeEnum(PartnerType),
    name: z.string().min(1, "Name is required"),
    contactPerson: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),

    tin: z.string().min(1, "TIN is required"),
    bin: z.string().min(1, "BIN is required"),

    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankBranch: z.string().optional(),
    routingNumber: z.string().optional(),

    creditTermsDays: z.coerce.number().int().optional(),

    vatInclusiveInPrice: z.boolean().optional(),

    tdsExempt: z.boolean().optional(),
    tdsExemptionCertNumber: z.string().optional(),
    tdsExemptionExpiryDate: z.coerce.date().optional(),

    localBranchId: z.string().optional(),

    // TODO: derive createdById from the authenticated session once auth is wired up.
    createdById: z.coerce.number().int().optional(),
  })
  .refine(refineFutureExemptionDate, futureExemptionDateIssue);

export const updatePartnerSchema = z
  .object({
    // type is accepted here (not omitted) so an attempt to change it is
    // actively rejected by the service layer, rather than silently dropped.
    type: z.nativeEnum(PartnerType).optional(),

    name: z.string().min(1, "Name is required").optional(),
    contactPerson: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),

    tin: z.string().min(1, "TIN is required").optional(),
    bin: z.string().min(1, "BIN is required").optional(),

    bankName: z.string().nullable().optional(),
    bankAccountNumber: z.string().nullable().optional(),
    bankBranch: z.string().nullable().optional(),
    routingNumber: z.string().nullable().optional(),

    creditTermsDays: z.coerce.number().int().nullable().optional(),

    vatInclusiveInPrice: z.boolean().nullable().optional(),

    tdsExempt: z.boolean().optional(),
    tdsExemptionCertNumber: z.string().nullable().optional(),
    tdsExemptionExpiryDate: z.coerce.date().nullable().optional(),

    localBranchId: z.string().nullable().optional(),

    isActive: z.boolean().optional(),
  })
  .refine(refineFutureExemptionDate, futureExemptionDateIssue);

export const listPartnersQuerySchema = z.object({
  type: z.nativeEnum(PartnerType).optional(),
  // z.coerce.boolean() would treat the string "false" as truthy (any
  // non-empty string coerces to true) — parse the literal query value instead.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  localBranchId: z.string().optional(),
  search: z.string().optional(),
});

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;
export type ListPartnersQuery = z.infer<typeof listPartnersQuerySchema>;
