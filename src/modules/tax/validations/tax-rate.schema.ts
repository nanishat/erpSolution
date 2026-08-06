import { TaxComputationType, TaxDirection, TaxType } from "@prisma/client";
import { z } from "zod";

// Same ceiling as TaxApplication.ratePercent (see tax-application.schema.ts)
// — VAT is capped at 15% and fractional values are allowed (7.50, 2.25).
const RATE_MIN = 0;
const RATE_MAX = 15;

const ratePercentField = z.coerce
  .number()
  .min(RATE_MIN, "ratePercent cannot be negative")
  .max(RATE_MAX, `ratePercent cannot exceed ${RATE_MAX}%`);

export const createTaxRateSchema = z.object({
  type: z.nativeEnum(TaxType),
  category: z.string().min(1, "Category is required"),
  name: z.string().min(1, "Name is required"),
  ratePercent: ratePercentField,
  direction: z.nativeEnum(TaxDirection),
  computationType: z.nativeEnum(TaxComputationType).optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
});

export const updateTaxRateSchema = z.object({
  type: z.nativeEnum(TaxType).optional(),
  category: z.string().min(1, "Category is required").optional(),
  name: z.string().min(1, "Name is required").optional(),
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
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;
export type ListTaxRatesQuery = z.infer<typeof listTaxRatesQuerySchema>;
