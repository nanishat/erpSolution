import { Prisma, type TaxApplication, type TaxComputationType } from "@prisma/client";

import { db } from "@/lib/db";
import { JournalEntryNotFoundError } from "@/modules/accounting/services/journal-entry.service";
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";
import type { CreateTaxApplicationInput } from "@/modules/tax/validations/tax-application.schema";

const taxApplicationListInclude = {
  journalEntry: { select: { id: true, documentNumber: true } },
  partner: { select: { id: true, name: true } },
} satisfies Prisma.TaxApplicationInclude;

type TaxApplicationListRow = Prisma.TaxApplicationGetPayload<{
  include: typeof taxApplicationListInclude;
}>;

// ratePercent/baseAmount/taxAmount are Prisma Decimals, which React Server
// Components can't pass to "use client" components ("Decimal objects are
// not supported") — convert to plain numbers before this ever reaches
// TaxApplicationTable, mirroring serializeProductService().
export type TaxApplicationListItem = Omit<
  TaxApplicationListRow,
  "ratePercent" | "baseAmount" | "taxAmount"
> & {
  ratePercent: number;
  baseAmount: number;
  taxAmount: number;
};

function serializeTaxApplication(app: TaxApplicationListRow): TaxApplicationListItem {
  return {
    ...app,
    ratePercent: Number(app.ratePercent),
    baseAmount: Number(app.baseAmount),
    taxAmount: Number(app.taxAmount),
  };
}

export class TaxRateNotFoundError extends Error {
  constructor(id: string) {
    super(`Tax rate ${id} not found`);
    this.name = "TaxRateNotFoundError";
  }
}

export class TaxRateInactiveError extends Error {
  constructor(id: string) {
    super(`Tax rate ${id} is inactive and cannot be used for new tax applications`);
    this.name = "TaxRateInactiveError";
  }
}

export class TaxRateTypeMismatchError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`Tax rate ${id} is a ${actual} rate, not ${expected}`);
    this.name = "TaxRateTypeMismatchError";
  }
}

export class TaxRateDirectionMismatchError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`Tax rate ${id} is an ${actual} rate, not ${expected}`);
    this.name = "TaxRateDirectionMismatchError";
  }
}

export class PartnerTdsExemptError extends Error {
  constructor(partnerId: string) {
    super(
      `Partner ${partnerId} is TDS-exempt — a TDS tax application cannot be created for this partner`
    );
    this.name = "PartnerTdsExemptError";
  }
}

export class JournalEntryNotDraftError extends Error {
  constructor(id: string, status: string) {
    super(
      `Journal entry ${id} is ${status}, not DRAFT — tax applications can only be added to a draft entry`
    );
    this.name = "JournalEntryNotDraftError";
  }
}

export class TaxApplicationNotFoundError extends Error {
  constructor(id: string) {
    super(`Tax application ${id} not found`);
    this.name = "TaxApplicationNotFoundError";
  }
}

export class TaxApplicationNotPendingError extends Error {
  constructor(id: string, status: string) {
    super(`Tax application ${id} is ${status}, not PENDING_REVIEW`);
    this.name = "TaxApplicationNotPendingError";
  }
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// EXCLUSIVE: baseAmount excludes tax — add it on top.
// INCLUSIVE: baseAmount already includes tax — back out the embedded portion
// (base * rate / (100 + rate)) rather than a flat base * rate / 100.
function calculateTaxAmount(
  baseAmount: number,
  ratePercent: number,
  computationType: TaxComputationType
): number {
  if (computationType === "INCLUSIVE") {
    return roundCurrency((baseAmount * ratePercent) / (100 + ratePercent));
  }
  return roundCurrency(baseAmount * (ratePercent / 100));
}

// Newest first — the approval queue cares most about what just landed,
// not chronological history.
export async function listTaxApplications(): Promise<TaxApplicationListItem[]> {
  const applications = await db.taxApplication.findMany({
    include: taxApplicationListInclude,
    orderBy: { createdAt: "desc" },
  });
  return applications.map(serializeTaxApplication);
}

/**
 * Creates a TaxApplication, always starting at PENDING_REVIEW regardless of
 * how cleanly the input validates — per the business requirement that all
 * tax needs manual review before it can gate a JournalEntry's posting (see
 * postJournalEntry in journal-entry.service.ts).
 *
 * VAT looks up the picked TaxRate and denormalizes its ratePercent onto this
 * record — the TaxRate is not a live reference; editing/deactivating it
 * later never changes an already-created TaxApplication. TDS/VDS have no
 * admin-managed rate list, so ratePercent is whatever was manually entered
 * (already range-validated by the Zod schema).
 *
 * computationType: for VAT with a linked partner, Partner.vatInclusiveInPrice
 * fully determines it (true -> INCLUSIVE, false/null -> EXCLUSIVE); for VAT
 * without a partner, it falls back to the TaxRate's own computationType. For
 * TDS/VDS it's whatever the caller passed, defaulting to EXCLUSIVE.
 */
export async function createTaxApplication(
  input: CreateTaxApplicationInput
): Promise<TaxApplication> {
  return db.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.findUnique({
      where: { id: input.journalEntryId },
      select: { id: true, status: true },
    });
    if (!journalEntry) {
      throw new JournalEntryNotFoundError(input.journalEntryId);
    }
    // The UI only offers "Add Tax" on DRAFT entries, but the service must
    // enforce it too — a TaxApplication attached to a POSTED/VOID entry
    // would never get picked up by postJournalEntry and its tax would
    // silently never reach the ledger.
    if (journalEntry.status !== "DRAFT") {
      throw new JournalEntryNotDraftError(input.journalEntryId, journalEntry.status);
    }

    const partner = input.partnerId
      ? await tx.partner.findUnique({ where: { id: input.partnerId } })
      : null;
    if (input.partnerId && !partner) {
      throw new PartnerNotFoundError(input.partnerId);
    }

    // Rejecting (rather than silently forcing ratePercent to 0) keeps the
    // user from wondering why their entered rate didn't apply.
    if (input.taxType === "TDS" && partner?.tdsExempt) {
      throw new PartnerTdsExemptError(partner.id);
    }

    let ratePercent: number;
    let computationType: TaxComputationType;
    let sourceTaxRateId: string | null = null;

    if (input.taxType === "VAT") {
      const taxRate = await tx.taxRate.findUnique({ where: { id: input.sourceTaxRateId } });
      if (!taxRate) {
        throw new TaxRateNotFoundError(input.sourceTaxRateId);
      }
      if (taxRate.type !== "VAT") {
        throw new TaxRateTypeMismatchError(taxRate.id, "VAT", taxRate.type);
      }
      if (taxRate.direction !== input.direction) {
        throw new TaxRateDirectionMismatchError(taxRate.id, input.direction, taxRate.direction);
      }
      if (!taxRate.isActive) {
        throw new TaxRateInactiveError(taxRate.id);
      }

      ratePercent = Number(taxRate.ratePercent);
      sourceTaxRateId = taxRate.id;
      computationType =
        partner && partner.vatInclusiveInPrice != null
          ? partner.vatInclusiveInPrice
            ? "INCLUSIVE"
            : "EXCLUSIVE"
          : taxRate.computationType;
    } else {
      ratePercent = input.ratePercent;
      computationType = input.computationType ?? "EXCLUSIVE";
    }

    const taxAmount = calculateTaxAmount(input.baseAmount, ratePercent, computationType);

    return tx.taxApplication.create({
      data: {
        journalEntryId: input.journalEntryId,
        partnerId: input.partnerId,
        taxType: input.taxType,
        direction: input.taxType === "VAT" ? input.direction : null,
        ratePercent,
        sourceTaxRateId,
        computationType,
        baseAmount: input.baseAmount,
        taxAmount,
        status: "PENDING_REVIEW",
        createdById: input.createdById,
      },
    });
  });
}

export async function approveTaxApplication(id: string): Promise<TaxApplication> {
  return db.$transaction(async (tx) => {
    const existing = await tx.taxApplication.findUnique({ where: { id } });
    if (!existing) {
      throw new TaxApplicationNotFoundError(id);
    }
    if (existing.status !== "PENDING_REVIEW") {
      throw new TaxApplicationNotPendingError(id, existing.status);
    }

    return tx.taxApplication.update({
      where: { id },
      data: { status: "APPROVED" },
    });
  });
}

export async function rejectTaxApplication(
  id: string,
  reason?: string
): Promise<TaxApplication> {
  return db.$transaction(async (tx) => {
    const existing = await tx.taxApplication.findUnique({ where: { id } });
    if (!existing) {
      throw new TaxApplicationNotFoundError(id);
    }
    if (existing.status !== "PENDING_REVIEW") {
      throw new TaxApplicationNotPendingError(id, existing.status);
    }

    return tx.taxApplication.update({
      where: { id },
      data: { status: "REJECTED", rejectionReason: reason },
    });
  });
}
