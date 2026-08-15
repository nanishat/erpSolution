import { ProductServiceType } from "@prisma/client";
import { z } from "zod";

const unitPriceField = z.coerce.number().min(0, "unitPrice cannot be negative");

export const createProductServiceSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.nativeEnum(ProductServiceType),

  unitPrice: unitPriceField.optional(),
  unit: z.string().optional(),

  incomeAccountId: z.string().min(1, "Income account is required"),
  expenseAccountId: z.string().optional(),

  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
});

export const updateProductServiceSchema = z.object({
  code: z.string().min(1, "Code is required").optional(),
  name: z.string().min(1, "Name is required").optional(),
  description: z.string().nullable().optional(),
  type: z.nativeEnum(ProductServiceType).optional(),

  unitPrice: unitPriceField.optional(),
  unit: z.string().nullable().optional(),

  incomeAccountId: z.string().min(1, "Income account is required").optional(),
  expenseAccountId: z.string().nullable().optional(),

  isActive: z.boolean().optional(),
});

export const listProductServicesQuerySchema = z.object({
  type: z.nativeEnum(ProductServiceType).optional(),
  // z.coerce.boolean() would treat the string "false" as truthy (any
  // non-empty string coerces to true) — parse the literal query value instead.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().optional(),
});

export type CreateProductServiceInput = z.infer<typeof createProductServiceSchema>;
export type UpdateProductServiceInput = z.infer<typeof updateProductServiceSchema>;
export type ListProductServicesQuery = z.infer<typeof listProductServicesQuerySchema>;
