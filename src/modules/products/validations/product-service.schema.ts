import { ProductServiceType } from "@prisma/client";
import { z } from "zod";

const unitPriceField = z.coerce.number({ error: "Enter a unit price." }).min(0, "Unit price must be 0 or more.");

export const createProductServiceSchema = z.object({
  code: z.string({ error: "Enter a code." }).min(1, "Enter a code."),
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name."),
  description: z.string().optional(),
  type: z.nativeEnum(ProductServiceType, { error: "Select a type." }),

  unitPrice: unitPriceField.optional(),
  unit: z.string().optional(),

  incomeAccountId: z.string({ error: "Select an income account." }).min(1, "Select an income account."),
  expenseAccountId: z.string().optional(),

  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
});

export const updateProductServiceSchema = z.object({
  code: z.string({ error: "Enter a code." }).min(1, "Enter a code.").optional(),
  name: z.string({ error: "Enter a name." }).min(1, "Enter a name.").optional(),
  description: z.string().nullable().optional(),
  type: z.nativeEnum(ProductServiceType, { error: "Select a type." }).optional(),

  unitPrice: unitPriceField.optional(),
  unit: z.string().nullable().optional(),

  incomeAccountId: z.string({ error: "Select an income account." }).min(1, "Select an income account.").optional(),
  expenseAccountId: z.string().nullable().optional(),

  isActive: z.boolean().optional(),
});

export const listProductServicesQuerySchema = z.object({
  type: z.nativeEnum(ProductServiceType).optional(),
  // z.coerce.boolean() would treat the string "false" as truthy (any
  // non-empty string coerces to true) — parse the literal query value instead.
  isActive: z
    .enum(["true", "false", "all"])
    .transform((value) => (value === "all" ? "all" : value === "true"))
    .optional(),
  search: z.string().optional(),
});

export type CreateProductServiceInput = z.infer<typeof createProductServiceSchema>;
export type UpdateProductServiceInput = z.infer<typeof updateProductServiceSchema>;
export type ListProductServicesQuery = z.infer<typeof listProductServicesQuerySchema>;
