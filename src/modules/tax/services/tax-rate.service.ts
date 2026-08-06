import type { TaxRate } from "@prisma/client";

import { db } from "@/lib/db";
import type {
  CreateTaxRateInput,
  ListTaxRatesQuery,
  UpdateTaxRateInput,
} from "@/modules/tax/validations/tax-rate.schema";

export class TaxRateNotFoundError extends Error {
  constructor(id: string) {
    super(`Tax rate ${id} not found`);
    this.name = "TaxRateNotFoundError";
  }
}

export async function listTaxRates(filter: ListTaxRatesQuery): Promise<TaxRate[]> {
  return db.taxRate.findMany({
    where: {
      type: filter.type,
      direction: filter.direction,
      // Default list excludes deactivated rates; pass isActive=false explicitly to see them.
      isActive: filter.isActive ?? true,
    },
    orderBy: [{ type: "asc" }, { direction: "asc" }, { ratePercent: "asc" }],
  });
}

export async function getTaxRateById(id: string): Promise<TaxRate> {
  const rate = await db.taxRate.findUnique({ where: { id } });

  if (!rate) {
    throw new TaxRateNotFoundError(id);
  }

  return rate;
}

export async function createTaxRate(input: CreateTaxRateInput): Promise<TaxRate> {
  return db.taxRate.create({
    data: {
      type: input.type,
      category: input.category,
      name: input.name,
      ratePercent: input.ratePercent,
      direction: input.direction,
      computationType: input.computationType ?? "EXCLUSIVE",
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    },
  });
}

export async function updateTaxRate(id: string, input: UpdateTaxRateInput): Promise<TaxRate> {
  const existing = await db.taxRate.findUnique({ where: { id } });
  if (!existing) {
    throw new TaxRateNotFoundError(id);
  }

  return db.taxRate.update({
    where: { id },
    data: {
      type: input.type,
      category: input.category,
      name: input.name,
      ratePercent: input.ratePercent,
      direction: input.direction,
      computationType: input.computationType,
      isActive: input.isActive,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    },
  });
}

/**
 * Soft delete only. A TaxApplication's ratePercent/computationType are
 * denormalized at creation time and sourceTaxRateId is kept for traceability
 * only (see the TaxApplication model doc comment in schema.prisma) — editing
 * or deactivating a TaxRate never changes an already-created TaxApplication.
 * That means there's no "still referenced elsewhere" case that would make
 * deactivation misleading, so it's allowed unconditionally once the rate
 * itself exists.
 */
export async function deactivateTaxRate(id: string): Promise<TaxRate> {
  const existing = await db.taxRate.findUnique({ where: { id } });
  if (!existing) {
    throw new TaxRateNotFoundError(id);
  }

  return db.taxRate.update({
    where: { id },
    data: { isActive: false },
  });
}
