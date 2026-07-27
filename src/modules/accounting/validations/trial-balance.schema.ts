import { z } from "zod";

// z.coerce.boolean() would treat the string "false" as truthy (any non-empty
// string coerces via Boolean()), so this is matched explicitly instead.
const booleanQueryParam = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === "true");

export const trialBalanceQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: z.string().min(1).optional(),
  includeZeroBalances: booleanQueryParam,
});

export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;
