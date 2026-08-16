import type { TaxRate as TaxRateRow } from "@prisma/client";

import { db } from "@/lib/db";
import type {
  CreateTaxRateInput,
  ListTaxRatesQuery,
  UpdateTaxRateInput,
} from "@/modules/tax/validations/tax-rate.schema";

// ratePercent is a Prisma Decimal, which React Server Components can't pass
// to "use client" components ("Decimal objects are not supported") —
// convert to a plain number before this ever reaches TaxRateTable or
// AddTaxApplicationForm, mirroring serializeProductService().
export type TaxRate = Omit<TaxRateRow, "ratePercent"> & { ratePercent: number };

function serializeTaxRate(rate: TaxRateRow): TaxRate {
  return { ...rate, ratePercent: Number(rate.ratePercent) };
}

export class TaxRateNotFoundError extends Error {
  constructor(id: string) {
    super(`Tax rate ${id} not found`);
    this.name = "TaxRateNotFoundError";
  }
}

export async function listTaxRates(filter: ListTaxRatesQuery): Promise<TaxRate[]> {
  const rates = await db.taxRate.findMany({
    where: {
      type: filter.type,
      direction: filter.direction,
      // Default list excludes deactivated rates; pass isActive=false explicitly to see them.
      isActive: filter.isActive ?? true,
    },
    orderBy: [{ type: "asc" }, { direction: "asc" }, { ratePercent: "asc" }],
  });
  return rates.map(serializeTaxRate);
}

export async function getTaxRateById(id: string): Promise<TaxRate> {
  const rate = await db.taxRate.findUnique({ where: { id } });

  if (!rate) {
    throw new TaxRateNotFoundError(id);
  }

  return serializeTaxRate(rate);
}

export async function createTaxRate(input: CreateTaxRateInput): Promise<TaxRate> {
  const created = await db.taxRate.create({
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
  return serializeTaxRate(created);
}

export async function updateTaxRate(id: string, input: UpdateTaxRateInput): Promise<TaxRate> {
  const existing = await db.taxRate.findUnique({ where: { id } });
  if (!existing) {
    throw new TaxRateNotFoundError(id);
  }

  const updated = await db.taxRate.update({
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
  return serializeTaxRate(updated);
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

  const deactivated = await db.taxRate.update({
    where: { id },
    data: { isActive: false },
  });
  return serializeTaxRate(deactivated);
}
