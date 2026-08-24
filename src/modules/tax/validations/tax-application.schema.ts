import { TaxComputationType, TaxDirection, TaxType } from "@prisma/client";
import { z } from "zod";

// VAT is capped at 15% and TDS/VDS manual entry must respect the same
// business-rule ceiling — fractional values allowed (7.50, 2.25).
const RATE_MIN = 0;
const RATE_MAX = 15;

const ratePercentField = z.coerce
  .number()
  .min(RATE_MIN, "ratePercent cannot be negative")
  .max(RATE_MAX, `ratePercent cannot exceed ${RATE_MAX}%`);

const baseFields = {
  journalEntryId: z.string().min(1, "Journal entry is required"),
  partnerId: z.string().optional(),
  baseAmount: z.coerce.number().positive("baseAmount must be greater than 0"),
  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
};

// VAT: rate comes from an admin-maintained TaxRate row, not typed in —
// sourceTaxRateId is required, ratePercent/computationType are derived by
// the service (see tax-application.service.ts), not accepted from the caller.
const vatTaxApplicationSchema = z
  .object({
    ...baseFields,
    taxType: z.literal(TaxType.VAT),
    direction: z.nativeEnum(TaxDirection),
    sourceTaxRateId: z.string().min(1, "sourceTaxRateId is required for VAT"),
  })
  .strict();

// TDS/VDS: no admin-managed rate list — ratePercent is manual entry per
// transaction, computationType defaults to EXCLUSIVE unless overridden.
const tdsTaxApplicationSchema = z
  .object({
    ...baseFields,
    taxType: z.literal(TaxType.TDS),
    ratePercent: ratePercentField,
    computationType: z.nativeEnum(TaxComputationType).optional(),
  })
  .strict();

const vdsTaxApplicationSchema = z
  .object({
    ...baseFields,
    taxType: z.literal(TaxType.VDS),
    ratePercent: ratePercentField,
    computationType: z.nativeEnum(TaxComputationType).optional(),
  })
  .strict();

export const createTaxApplicationSchema = z.discriminatedUnion("taxType", [
  vatTaxApplicationSchema,
  tdsTaxApplicationSchema,
  vdsTaxApplicationSchema,
]);

export type CreateTaxApplicationInput = z.infer<typeof createTaxApplicationSchema>;
