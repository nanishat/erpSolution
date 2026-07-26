import { AccountSubType, AccountType } from "@prisma/client";
import { z } from "zod";

export const createChartOfAccountSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.nativeEnum(AccountType),
  subType: z.nativeEnum(AccountSubType).optional(),
  parentId: z.string().optional(),
  isReconcilable: z.boolean().optional(),
  currencyCode: z.string().optional(),
  openingBalance: z.coerce.number().optional(),
  openingBalanceDate: z.coerce.date().optional(),
  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
});

export const updateChartOfAccountSchema = z.object({
  code: z.string().min(1, "Code is required").optional(),
  name: z.string().min(1, "Name is required").optional(),
  description: z.string().nullable().optional(),
  type: z.nativeEnum(AccountType).optional(),
  subType: z.nativeEnum(AccountSubType).nullable().optional(),
  parentId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  isReconcilable: z.boolean().optional(),
  currencyCode: z.string().optional(),
  openingBalance: z.coerce.number().optional(),
  openingBalanceDate: z.coerce.date().nullable().optional(),
});

export const listChartOfAccountsQuerySchema = z.object({
  type: z.nativeEnum(AccountType).optional(),
  subType: z.nativeEnum(AccountSubType).optional(),
  isActive: z.coerce.boolean().optional(),
  parentId: z.string().optional(),
});

export type CreateChartOfAccountInput = z.infer<typeof createChartOfAccountSchema>;
export type UpdateChartOfAccountInput = z.infer<typeof updateChartOfAccountSchema>;
export type ListChartOfAccountsQuery = z.infer<typeof listChartOfAccountsQuerySchema>;
