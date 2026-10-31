import { TaxComputationType, TaxDirection, TaxType } from "@prisma/client";
import { z } from "zod";

// Same ceiling as TaxApplication.ratePercent (see tax-application.schema.ts)
// — VAT is capped at 15% and fractional values are allowed (7.50, 2.25).
const RATE_MIN = 0;
const RATE_MAX = 15;

const ratePercentField = z.coerce
  .number()
  .min(RATE_MIN, "Tax rate must be between 0 and 15.")
  .max(RATE_MAX, "Tax rate must be between 0 and 15.");

export const createTaxRateSchema = z.object({
  type: z.nativeEnum(TaxType, { error: "Select a tax type." }),
  category: z.string({ error: "Enter a category." }).min(1, "Enter a category."),
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name."),
  ratePercent: ratePercentField,
  direction: z.nativeEnum(TaxDirection, { error: "Select a direction." }),
  computationType: z.nativeEnum(TaxComputationType).optional(),
  effectiveFrom: z.coerce.date({ error: "Enter a valid start date." }).optional(),
  effectiveTo: z.coerce.date({ error: "Enter a valid end date." }).nullable().optional(),
});

export const updateTaxRateSchema = z.object({
  type: z.nativeEnum(TaxType).optional(),
  category: z.string({ error: "Enter a category." }).min(1, "Enter a category.").optional(),
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").optional(),
  ratePercent: ratePercentField.optional(),
  direction: z.nativeEnum(TaxDirection).optional(),
  computationType: z.nativeEnum(TaxComputationType).optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
});

export const listTaxRatesQuerySchema = z.object({
  type: z.nativeEnum(TaxType).optional(),
  direction: z.nativeEnum(TaxDirection).optional(),
  // z.coerce.boolean() would treat the string "false" as truthy (any
  // non-empty string coerces to true) — parse the literal query value instead.
  isActive: z
    .enum(["true", "false", "all"])
    .transform((value) => (value === "all" ? "all" : value === "true"))
    .optional(),
});

export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;
export type ListTaxRatesQuery = z.infer<typeof listTaxRatesQuerySchema>;
