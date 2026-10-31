import { TaxComputationType, TaxDirection, TaxType } from "@prisma/client";
import { z } from "zod";

// VAT is capped at 15% and TDS/VDS manual entry must respect the same
// business-rule ceiling — fractional values allowed (7.50, 2.25).
const RATE_MIN = 0;
const RATE_MAX = 15;

const ratePercentField = z.coerce
  .number()
  .min(RATE_MIN, "TDS/VDS rate must be between 0 and 15.")
  .max(RATE_MAX, "TDS/VDS rate must be between 0 and 15.");

const baseFields = {
  journalEntryId: z.string({ error: "Select a journal entry." }).min(1, "Select a journal entry."),
  partnerId: z.string().optional(),
  baseAmount: z.coerce.number({ error: "Enter a base amount." }).positive("Base amount must be greater than 0."),
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
    direction: z.nativeEnum(TaxDirection, { error: "Select a direction." }),
    sourceTaxRateId: z.string({ error: "Select a VAT rate." }).min(1, "Select a VAT rate."),
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
