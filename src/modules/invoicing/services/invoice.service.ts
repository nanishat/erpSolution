import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  BranchNotFoundError,
  createJournalEntry,
  postJournalEntry,
} from "@/modules/accounting/services/journal-entry.service";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";
import { generateInvoiceNumber } from "@/modules/invoicing/services/invoice-document-sequence.service";
import type { CreateInvoiceInput } from "@/modules/invoicing/validations/invoice.schema";
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";

// Same placeholder used by the voucher create paths (journal-entry.actions.ts,
// /api/journal-entries) until real auth is wired up — JournalEntry.createdById
// is a plain required String, unrelated to User.createdById (Int? -> User).
const UNASSIGNED_USER_ID = "system";

// Existing seeded "Accounts Receivable" account (prisma/seed-coa.ts) — looked
// up by code rather than hardcoding an id, same convention as tax-posting
// .service.ts's VAT_PAYABLE_CODE/etc.
export const ACCOUNTS_RECEIVABLE_CODE = "1200";

export class PartnerNotCustomerError extends Error {
  constructor(partnerId: string, actualType: string) {
    super(
      `Partner ${partnerId} is a ${actualType}, not a CUSTOMER — invoices can only be raised against customers`
    );
    this.name = "PartnerNotCustomerError";
  }
}

export class ProductServiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Product/service ${id} not found`);
    this.name = "ProductServiceNotFoundError";
  }
}

export class InvoiceLineMissingIncomeAccountError extends Error {
  constructor(lineIndex: number) {
    super(
      `Line ${lineIndex + 1} has no product/service reference, so there is no income account to ` +
        `credit — every invoice line must reference a catalog ProductService`
    );
    this.name = "InvoiceLineMissingIncomeAccountError";
  }
}

export class AccountsReceivableNotConfiguredError extends Error {
  constructor(code: string) {
    super(
      `Chart of account ${code} (Accounts Receivable) is required to create invoices but does not exist — run prisma/seed-coa.ts`
    );
    this.name = "AccountsReceivableNotConfiguredError";
  }
}

export class UnbalancedInvoiceJournalEntryError extends Error {
  constructor(totalDebit: number, totalCredit: number) {
    super(
      `Constructed journal entry for this invoice does not balance: Accounts Receivable debit ` +
        `(${totalDebit}) must equal total income credits (${totalCredit})`
    );
    this.name = "UnbalancedInvoiceJournalEntryError";
  }
}

export class InvoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Invoice ${id} not found`);
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceAlreadyPostedError extends Error {
  constructor(id: string, status: string) {
    super(`Invoice ${id} is already ${status} and cannot be posted again`);
    this.name = "InvoiceAlreadyPostedError";
  }
}

export class InvoiceCancelledError extends Error {
  constructor(id: string) {
    super(`Invoice ${id} is cancelled and cannot be posted`);
    this.name = "InvoiceCancelledError";
  }
}

export class InvoiceVoidError extends Error {
  constructor(id: string) {
    super(`Invoice ${id} is void and cannot be posted`);
    this.name = "InvoiceVoidError";
  }
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

const invoiceInclude = {
  branch: { select: { id: true, name: true, code: true } },
  partner: { select: { id: true, name: true, type: true } },
  journalEntry: { select: { id: true, documentNumber: true, status: true } },
  lines: {
    include: { productService: { select: { id: true, code: true, name: true } } },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

/**
 * Creates an Invoice in DRAFT status together with its eagerly-created DRAFT
 * JournalEntry (per the locked Phase 3 decision — mirrors how vouchers already
 * work, no schema gymnastics needed).
 *
 * Every line must resolve to a ProductService (and therefore an
 * incomeAccountId) — a free-text line with no productServiceId has nothing
 * for the JournalEntry to credit, so the whole invoice is rejected up front
 * rather than created half-balanced. Lines sharing the same incomeAccountId
 * are grouped into a single credit line (the standard accounting approach)
 * against one debit line for the full subtotal on Accounts Receivable.
 *
 * Tax is NOT calculated or attached here: taxTotal stays 0 and grandTotal
 * equals subtotal. Tax attaches afterward via the existing TaxApplication
 * flow against this invoice's JournalEntry, same as vouchers today.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceWithLines> {
  return db.$transaction(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner) {
      throw new PartnerNotFoundError(input.partnerId);
    }
    if (partner.type !== "CUSTOMER") {
      throw new PartnerNotCustomerError(partner.id, partner.type);
    }

    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) {
      throw new BranchNotFoundError(input.branchId);
    }

    const productServiceIds = Array.from(
      new Set(
        input.lines
          .map((line) => line.productServiceId)
          .filter((id): id is string => id != null)
      )
    );
    const productServices = await tx.productService.findMany({
      where: { id: { in: productServiceIds } },
    });
    const productServiceById = new Map(productServices.map((p) => [p.id, p]));

    const resolvedLines = input.lines.map((line, index) => {
      if (!line.productServiceId) {
        throw new InvoiceLineMissingIncomeAccountError(index);
      }
      const productService = productServiceById.get(line.productServiceId);
      if (!productService) {
        throw new ProductServiceNotFoundError(line.productServiceId);
      }

      return {
        productServiceId: line.productServiceId,
        incomeAccountId: productService.incomeAccountId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: roundCurrency(line.quantity * line.unitPrice),
      };
    });

    const subtotal = roundCurrency(resolvedLines.reduce((sum, line) => sum + line.lineTotal, 0));
    const grandTotal = subtotal; // taxTotal stays 0 at creation — see doc comment above

    const creditsByIncomeAccount = new Map<string, number>();
    for (const line of resolvedLines) {
      creditsByIncomeAccount.set(
        line.incomeAccountId,
        roundCurrency((creditsByIncomeAccount.get(line.incomeAccountId) ?? 0) + line.lineTotal)
      );
    }

    // Defense in depth: subtotal and the grouped credits are derived from the
    // same lineTotal values, so this should always hold by construction —
    // mirrors postJournalEntryWithClient's own re-check rather than trusting
    // the arithmetic above blindly.
    const totalCredit = roundCurrency(
      Array.from(creditsByIncomeAccount.values()).reduce((sum, value) => sum + value, 0)
    );
    if (Math.round((subtotal - totalCredit) * 100) !== 0) {
      throw new UnbalancedInvoiceJournalEntryError(subtotal, totalCredit);
    }

    const arAccount = await tx.chartOfAccount.findUnique({
      where: { code: ACCOUNTS_RECEIVABLE_CODE },
    });
    if (!arAccount) {
      throw new AccountsReceivableNotConfiguredError(ACCOUNTS_RECEIVABLE_CODE);
    }

    const invoiceNumber = await generateInvoiceNumber(tx, {
      sector: input.sector,
      branchId: input.branchId,
      branchCode: branch.code,
      date: input.date,
    });

    const journalEntryInput: JournalEntryInput = {
      date: input.date,
      description: `Invoice ${invoiceNumber} to ${partner.name}`,
      reference: invoiceNumber,
      branchId: input.branchId,
      voucherType: "INVOICE_VOUCHER",
      lines: [
        {
          accountId: arAccount.id,
          branchId: input.branchId,
          debit: subtotal,
          credit: 0,
          memo: "Accounts Receivable",
        },
        ...Array.from(creditsByIncomeAccount.entries()).map(([accountId, amount]) => ({
          accountId,
          branchId: input.branchId,
          debit: 0,
          credit: amount,
          memo: `Invoice ${invoiceNumber} revenue`,
        })),
      ],
    };

    const journalEntry = await createJournalEntry(journalEntryInput, UNASSIGNED_USER_ID, tx);

    return tx.invoice.create({
      data: {
        invoiceNumber,
        sector: input.sector,
        branchId: input.branchId,
        partnerId: input.partnerId,
        date: input.date,
        dueDate: input.dueDate,
        status: "DRAFT",
        journalEntryId: journalEntry.id,
        subtotal,
        taxTotal: 0,
        grandTotal,
        amountPaid: 0,
        notes: input.notes,
        createdById: input.createdById,
        lines: {
          create: resolvedLines.map((line, index) => ({
            productServiceId: line.productServiceId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            sortOrder: index,
          })),
        },
      },
      include: invoiceInclude,
    });
  });
}

/**
 * Transitions a DRAFT invoice to POSTED. Only DRAFT invoices can be posted —
 * anything else (already POSTED/PARTIALLY_PAID/PAID, or CANCELLED/VOID) is
 * rejected outright, so there is no path where a POSTED invoice's lines or
 * header could still be reached through this function.
 *
 * Delegates all ledger-side validation to the existing postJournalEntry
 * (balance check, active-account check, and — critically — the tax approval
 * gate: PendingTaxApprovalError if any linked TaxApplication is still
 * PENDING_REVIEW) rather than reimplementing any of it. Its rejection
 * propagates unchanged and, since everything below runs inside one
 * transaction, rolls back cleanly: the Invoice stays DRAFT and
 * Partner.outstandingBalance is left untouched.
 *
 * taxTotal/grandTotal are (re)computed here, right before posting, from the
 * sum of every APPROVED TaxApplication on the invoice's JournalEntry —
 * deliberately at posting time rather than at tax-approval time:
 * createTaxApplication only accepts a still-DRAFT JournalEntry
 * (JournalEntryNotDraftError otherwise), and postJournalEntry above just
 * flipped this one to POSTED, so no further TaxApplication can ever attach
 * to it — every APPROVED one that will ever exist for this invoice is
 * already final by this point. This also keeps tax-application.service.ts
 * (shared by vouchers and invoices alike) unaware of the Invoice model
 * entirely, rather than reaching into it from tax approval. An invoice
 * posted with no approved tax simply sums to 0, leaving grandTotal ==
 * subtotal — unchanged from today's behavior.
 *
 * On success, increments Partner.outstandingBalance by the freshly computed
 * grandTotal (subtotal + taxTotal).
 */
export async function postInvoice(id: string): Promise<InvoiceWithLines> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }
    if (invoice.status === "CANCELLED") {
      throw new InvoiceCancelledError(id);
    }
    if (invoice.status === "VOID") {
      throw new InvoiceVoidError(id);
    }
    if (invoice.status !== "DRAFT") {
      throw new InvoiceAlreadyPostedError(id, invoice.status);
    }

    await postJournalEntry(invoice.journalEntryId, tx);

    const approvedTaxApplications = await tx.taxApplication.findMany({
      where: { journalEntryId: invoice.journalEntryId, status: "APPROVED" },
      select: { taxAmount: true },
    });
    const taxTotal = roundCurrency(
      approvedTaxApplications.reduce((sum, application) => sum + Number(application.taxAmount), 0)
    );
    const grandTotal = roundCurrency(Number(invoice.subtotal) + taxTotal);

    await tx.partner.update({
      where: { id: invoice.partnerId },
      data: { outstandingBalance: { increment: grandTotal } },
    });

    return tx.invoice.update({
      where: { id },
      data: { status: "POSTED", taxTotal, grandTotal },
      include: invoiceInclude,
    });
  });
}
