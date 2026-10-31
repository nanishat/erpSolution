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
  message: "Choose an exemption expiry date in the future.",
  path: ["tdsExemptionExpiryDate"],
};

export const createPartnerSchema = z
  .object({
    type: z.nativeEnum(PartnerType, { error: "Select a partner type." }),
    name: z.string({ error: "Enter a name." }).min(1, "Enter a name."),
    contactPerson: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email("Enter a valid email address.").optional(),
    address: z.string().optional(),

    tin: z.string({ error: "Enter the TIN." }).min(1, "Enter the TIN."),
    bin: z.string({ error: "Enter the BIN." }).min(1, "Enter the BIN."),

    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankBranch: z.string().optional(),
    routingNumber: z.string().optional(),

    creditTermsDays: z.coerce.number({ error: "Enter the credit terms in days." }).int("Enter a whole number of days.").optional(),

    vatInclusiveInPrice: z.boolean().optional(),

    tdsExempt: z.boolean().optional(),
    tdsExemptionCertNumber: z.string().optional(),
    tdsExemptionExpiryDate: z.coerce.date({ error: "Enter a valid expiry date." }).optional(),

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

    name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").optional(),
    contactPerson: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email("Enter a valid email address.").nullable().optional(),
    address: z.string().nullable().optional(),

    tin: z.string({ error: "Enter the TIN." }).min(1, "Enter the TIN.").optional(),
    bin: z.string({ error: "Enter the BIN." }).min(1, "Enter the BIN.").optional(),

    bankName: z.string().nullable().optional(),
    bankAccountNumber: z.string().nullable().optional(),
    bankBranch: z.string().nullable().optional(),
    routingNumber: z.string().nullable().optional(),

    creditTermsDays: z.coerce.number({ error: "Enter the credit terms in days." }).int("Enter a whole number of days.").nullable().optional(),

    vatInclusiveInPrice: z.boolean().nullable().optional(),

    tdsExempt: z.boolean().optional(),
    tdsExemptionCertNumber: z.string().nullable().optional(),
    tdsExemptionExpiryDate: z.coerce.date({ error: "Enter a valid expiry date." }).nullable().optional(),

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
