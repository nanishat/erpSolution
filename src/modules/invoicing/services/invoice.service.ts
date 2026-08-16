import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  BranchNotFoundError,
  createJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  voidDraftJournalEntry,
} from "@/modules/accounting/services/journal-entry.service";
import type { JournalEntryWithLines } from "@/modules/accounting/services/journal-entry.service";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";
import {
  generateInvoiceNumber,
  generateVendorBillNumber,
} from "@/modules/invoicing/services/invoice-document-sequence.service";
import type { CreateInvoiceInput } from "@/modules/invoicing/validations/invoice.schema";
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";

// Same placeholder used by the voucher create paths (journal-entry.actions.ts,
// /api/journal-entries) until real auth is wired up — JournalEntry.createdById
// is a plain required String, unrelated to User.createdById (Int? -> User).
const UNASSIGNED_USER_ID = "system";

// Existing seeded accounts (prisma/seed-coa.ts) — looked up by code rather
// than hardcoding an id, same convention as tax-posting.service.ts's
// VAT_PAYABLE_CODE/etc. Accounts Receivable backs direction: CUSTOMER
// (Customer Invoice), Accounts Payable backs direction: VENDOR (Vendor Bill).
export const ACCOUNTS_RECEIVABLE_CODE = "1200";
export const ACCOUNTS_PAYABLE_CODE = "2100";

export class PartnerNotCustomerError extends Error {
  constructor(partnerId: string, actualType: string) {
    super(
      `Partner ${partnerId} is a ${actualType}, not a CUSTOMER — Customer Invoices can only be raised against customers`
    );
    this.name = "PartnerNotCustomerError";
  }
}

export class PartnerNotVendorError extends Error {
  constructor(partnerId: string, actualType: string) {
    super(
      `Partner ${partnerId} is a ${actualType}, not a VENDOR — Vendor Bills can only be raised against vendors`
    );
    this.name = "PartnerNotVendorError";
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

// Mirrors InvoiceLineMissingIncomeAccountError for direction: VENDOR. Covers
// both underlying causes uniformly (no productServiceId at all, or a
// resolved ProductService whose expenseAccountId is null) since from the
// caller's perspective both mean the same thing: there is no expense
// account this line can debit.
export class InvoiceLineMissingExpenseAccountError extends Error {
  constructor(lineIndex: number) {
    super(
      `Line ${lineIndex + 1} has no expense account to debit — every Vendor Bill line must reference ` +
        `a catalog ProductService with an expenseAccountId configured`
    );
    this.name = "InvoiceLineMissingExpenseAccountError";
  }
}

export class AccountsReceivableNotConfiguredError extends Error {
  constructor(code: string) {
    super(
      `Chart of account ${code} (Accounts Receivable) is required to create Customer Invoices but does not exist — run prisma/seed-coa.ts`
    );
    this.name = "AccountsReceivableNotConfiguredError";
  }
}

export class AccountsPayableNotConfiguredError extends Error {
  constructor(code: string) {
    super(
      `Chart of account ${code} (Accounts Payable) is required to create Vendor Bills but does not exist — run prisma/seed-coa.ts`
    );
    this.name = "AccountsPayableNotConfiguredError";
  }
}

export class UnbalancedInvoiceJournalEntryError extends Error {
  constructor(totalDebit: number, totalCredit: number, direction: "CUSTOMER" | "VENDOR" = "CUSTOMER") {
    const debitLabel = direction === "CUSTOMER" ? "Accounts Receivable debit" : "grouped expense account debits";
    const creditLabel = direction === "CUSTOMER" ? "total income credits" : "Accounts Payable credit";
    super(
      `Constructed journal entry for this invoice does not balance: ${debitLabel} ` +
        `(${totalDebit}) must equal ${creditLabel} (${totalCredit})`
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

export class InvoiceNotCancellableError extends Error {
  constructor(id: string, status: string) {
    super(`Invoice ${id} is ${status} and cannot be cancelled — only a DRAFT invoice can be cancelled`);
    this.name = "InvoiceNotCancellableError";
  }
}

export class InvoiceNotReversibleError extends Error {
  constructor(id: string, status: string) {
    super(
      `Invoice ${id} is ${status} and cannot be reversed — only a POSTED or PARTIALLY_PAID ` +
        "invoice can be reversed"
    );
    this.name = "InvoiceNotReversibleError";
  }
}

// A PAID invoice's balance was already settled by one or more real cash
// movements (Payment rows, each with its own POSTED JournalEntry). Reversing
// the invoice's own JournalEntry would zero out the AR/AP side while those
// payment postings stay untouched and pointing at a now-VOID invoice — the
// ledger would show cash received/paid against nothing. Undoing a paid
// invoice is a distinct real-world event (a credit note / refund, crediting
// the customer or reclaiming from the vendor) that doesn't exist in this
// schema yet, not a plain reversal — so this is rejected outright rather
// than silently allowed or silently folded into the generic payments check
// below (see InvoiceHasPaymentsError, which would also catch this same case
// since a PAID invoice always has payments, but this gives a clearer,
// PAID-specific message about why).
export class InvoicePaidCannotReverseError extends Error {
  constructor(id: string) {
    super(
      `Invoice ${id} is fully PAID and cannot be reversed — reversing a paid invoice's journal ` +
        "entry would leave its payment(s) posted against nothing; this requires a credit note / " +
        "refund process, which does not exist yet"
    );
    this.name = "InvoicePaidCannotReverseError";
  }
}

// Shared by both cancelInvoice (defensive — a DRAFT invoice should never
// have payments, since recordPayment only accepts POSTED/PARTIALLY_PAID)
// and reverseInvoice (a real constraint — reversing an invoice with any
// payment recorded would corrupt the ledger the same way reversing a PAID
// one would, see InvoicePaidCannotReverseError; note this also means a
// PARTIALLY_PAID invoice can never actually pass this check, since having
// any payment at all is exactly what makes it PARTIALLY_PAID).
export class InvoiceHasPaymentsError extends Error {
  constructor(id: string, paymentCount: number) {
    super(
      `Invoice ${id} has ${paymentCount} payment(s) recorded against it and cannot be ` +
        "cancelled/reversed this way"
    );
    this.name = "InvoiceHasPaymentsError";
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
 * work, no schema gymnastics needed). Represents BOTH a Customer Invoice
 * (direction: CUSTOMER) and a Vendor Bill (direction: VENDOR):
 *
 * - direction: CUSTOMER requires partner.type === CUSTOMER, numbers via
 *   generateInvoiceNumber (Sector/Branch/YYYYMM/Seq — sector is required,
 *   per createInvoiceSchema), resolves each line's account via
 *   ProductService.incomeAccountId (required/non-null on that model), and
 *   builds a JournalEntry debiting Accounts Receivable / crediting grouped
 *   income accounts.
 * - direction: VENDOR requires partner.type === VENDOR, numbers via
 *   generateVendorBillNumber (no sector at all — Invoice.sector is stored
 *   null for this direction, since createInvoiceSchema's VENDOR branch has
 *   no sector field to begin with), resolves each line's account via
 *   ProductService.expenseAccountId (nullable — rejected if absent), and
 *   builds a JournalEntry crediting Accounts Payable / debiting grouped
 *   expense accounts.
 *
 * Every line must resolve to a ProductService with the direction-appropriate
 * account configured — a line that can't resolve one has nothing for the
 * JournalEntry to touch, so the whole invoice/bill is rejected up front
 * rather than created half-balanced. Lines sharing the same account are
 * grouped into a single line (the standard accounting approach) against one
 * line for the full subtotal on the AR/AP control account.
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
    if (input.direction === "CUSTOMER" && partner.type !== "CUSTOMER") {
      throw new PartnerNotCustomerError(partner.id, partner.type);
    }
    if (input.direction === "VENDOR" && partner.type !== "VENDOR") {
      throw new PartnerNotVendorError(partner.id, partner.type);
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
        throw input.direction === "CUSTOMER"
          ? new InvoiceLineMissingIncomeAccountError(index)
          : new InvoiceLineMissingExpenseAccountError(index);
      }
      const productService = productServiceById.get(line.productServiceId);
      if (!productService) {
        throw new ProductServiceNotFoundError(line.productServiceId);
      }

      if (input.direction === "VENDOR" && !productService.expenseAccountId) {
        throw new InvoiceLineMissingExpenseAccountError(index);
      }

      const accountId =
        input.direction === "CUSTOMER"
          ? productService.incomeAccountId
          : (productService.expenseAccountId as string); // non-null, checked above

      return {
        productServiceId: line.productServiceId,
        accountId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: roundCurrency(line.quantity * line.unitPrice),
      };
    });

    const subtotal = roundCurrency(resolvedLines.reduce((sum, line) => sum + line.lineTotal, 0));
    const grandTotal = subtotal; // taxTotal stays 0 at creation — see doc comment above

    const linesByAccount = new Map<string, number>();
    for (const line of resolvedLines) {
      linesByAccount.set(
        line.accountId,
        roundCurrency((linesByAccount.get(line.accountId) ?? 0) + line.lineTotal)
      );
    }

    // Defense in depth: subtotal and the grouped lines are derived from the
    // same lineTotal values, so this should always hold by construction —
    // mirrors postJournalEntryWithClient's own re-check rather than trusting
    // the arithmetic above blindly.
    const groupedTotal = roundCurrency(
      Array.from(linesByAccount.values()).reduce((sum, value) => sum + value, 0)
    );
    if (Math.round((subtotal - groupedTotal) * 100) !== 0) {
      throw new UnbalancedInvoiceJournalEntryError(subtotal, groupedTotal, input.direction);
    }

    const controlAccountCode =
      input.direction === "CUSTOMER" ? ACCOUNTS_RECEIVABLE_CODE : ACCOUNTS_PAYABLE_CODE;
    const controlAccount = await tx.chartOfAccount.findUnique({
      where: { code: controlAccountCode },
    });
    if (!controlAccount) {
      throw input.direction === "CUSTOMER"
        ? new AccountsReceivableNotConfiguredError(controlAccountCode)
        : new AccountsPayableNotConfiguredError(controlAccountCode);
    }

    const documentNumber =
      input.direction === "CUSTOMER"
        ? await generateInvoiceNumber(tx, {
            sector: input.sector,
            branchId: input.branchId,
            branchCode: branch.code,
            date: input.date,
          })
        : await generateVendorBillNumber(tx, {
            branchId: input.branchId,
            branchCode: branch.code,
            date: input.date,
          });

    const journalEntryInput: JournalEntryInput =
      input.direction === "CUSTOMER"
        ? {
            date: input.date,
            description: `Invoice ${documentNumber} to ${partner.name}`,
            reference: documentNumber,
            branchId: input.branchId,
            voucherType: "INVOICE_VOUCHER",
            lines: [
              {
                accountId: controlAccount.id,
                branchId: input.branchId,
                debit: subtotal,
                credit: 0,
                memo: "Accounts Receivable",
              },
              ...Array.from(linesByAccount.entries()).map(([accountId, amount]) => ({
                accountId,
                branchId: input.branchId,
                debit: 0,
                credit: amount,
                memo: `Invoice ${documentNumber} revenue`,
              })),
            ],
          }
        : {
            date: input.date,
            description: `Vendor Bill ${documentNumber} from ${partner.name}`,
            reference: documentNumber,
            branchId: input.branchId,
            voucherType: "INVOICE_VOUCHER",
            lines: [
              {
                accountId: controlAccount.id,
                branchId: input.branchId,
                debit: 0,
                credit: subtotal,
                memo: "Accounts Payable",
              },
              ...Array.from(linesByAccount.entries()).map(([accountId, amount]) => ({
                accountId,
                branchId: input.branchId,
                debit: amount,
                credit: 0,
                memo: `Vendor Bill ${documentNumber} expense`,
              })),
            ],
          };

    const journalEntry = await createJournalEntry(journalEntryInput, UNASSIGNED_USER_ID, tx);

    return tx.invoice.create({
      data: {
        invoiceNumber: documentNumber,
        direction: input.direction,
        sector: input.direction === "CUSTOMER" ? input.sector : null,
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
 * Transitions a DRAFT invoice (Customer Invoice or Vendor Bill) to POSTED.
 * Only DRAFT invoices can be posted — anything else (already
 * POSTED/PARTIALLY_PAID/PAID, or CANCELLED/VOID) is rejected outright, so
 * there is no path where a POSTED invoice's lines or header could still be
 * reached through this function.
 *
 * Delegates all ledger-side validation to the existing postJournalEntry
 * (balance check, active-account check, and — critically — the tax approval
 * gate: PendingTaxApprovalError if any linked TaxApplication is still
 * PENDING_REVIEW) rather than reimplementing any of it, for both directions
 * alike — the check is generic over the JournalEntry, not direction-aware.
 * Its rejection propagates unchanged and, since everything below runs
 * inside one transaction, rolls back cleanly: the Invoice stays DRAFT and
 * neither Partner balance field is touched.
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
 * On success, increments exactly ONE Partner balance field with the freshly
 * computed grandTotal (subtotal + taxTotal), per the locked isolation
 * decision: direction: CUSTOMER touches ONLY outstandingBalance,
 * direction: VENDOR touches ONLY payableBalance — never both.
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

    if (invoice.direction === "CUSTOMER") {
      await tx.partner.update({
        where: { id: invoice.partnerId },
        data: { outstandingBalance: { increment: grandTotal } },
      });
    } else {
      await tx.partner.update({
        where: { id: invoice.partnerId },
        data: { payableBalance: { increment: grandTotal } },
      });
    }

    return tx.invoice.update({
      where: { id },
      data: { status: "POSTED", taxTotal, grandTotal },
      include: invoiceInclude,
    });
  });
}

export type CancelInvoiceResult = {
  invoice: InvoiceWithLines;
  journalEntry: JournalEntryWithLines;
};

export type ReverseInvoiceResult = {
  invoice: InvoiceWithLines;
  journalEntry: { original: JournalEntryWithLines; reversal: JournalEntryWithLines };
};

/**
 * Cancels a DRAFT invoice (Customer Invoice or Vendor Bill) that was never
 * posted — the "I created this by mistake / changed my mind before it ever
 * touched the ledger" path, distinct from reverseInvoice below (see that
 * function's doc comment for why these are not the same operation).
 *
 * Direction-agnostic on purpose: nothing here branches on
 * invoice.direction, because a DRAFT invoice never posted means neither
 * outstandingBalance nor payableBalance was ever touched (postInvoice is
 * the only place either field is incremented) — there is nothing to undo on
 * the Partner, for either direction alike.
 *
 * The linked JournalEntry was eagerly created alongside the invoice (same
 * as every voucher) but, being DRAFT, never took effect on the ledger
 * (getTrialBalance excludes DRAFT rows). JournalEntryStatus today only
 * offers DRAFT/POSTED/VOID — there's no distinct "cancelled, never posted"
 * state — so rather than leaving it an orphaned DRAFT row (which would keep
 * showing up on the general journal entries list with a live, clickable
 * "Post" button that has nothing to do with this now-cancelled invoice),
 * this reuses voidDraftJournalEntry to flip it straight to VOID: the same
 * terminal "dead, no ledger effect" status reverseJournalEntry already uses
 * for entries that were reversed after posting. See voidDraftJournalEntry's
 * own doc comment for why that (and not reverseJournalEntry, which requires
 * an already-POSTED entry) is the right call here.
 *
 * Rejects anything that isn't DRAFT — including an already-CANCELLED or
 * VOID invoice, so this can't be called twice. Also defensively verifies
 * zero Payment rows exist: recordPayment only accepts a POSTED/
 * PARTIALLY_PAID invoice, so a DRAFT invoice should never have one, but this
 * is cheap insurance against that invariant ever being violated (e.g. by a
 * future code path) rather than trusting it silently.
 */
export async function cancelInvoice(id: string): Promise<CancelInvoiceResult> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }
    if (invoice.status !== "DRAFT") {
      throw new InvoiceNotCancellableError(id, invoice.status);
    }

    const paymentCount = await tx.payment.count({ where: { invoiceId: id } });
    if (paymentCount > 0) {
      throw new InvoiceHasPaymentsError(id, paymentCount);
    }

    const journalEntry = await voidDraftJournalEntry(invoice.journalEntryId, tx);

    const updatedInvoice = await tx.invoice.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: invoiceInclude,
    });

    return { invoice: updatedInvoice, journalEntry };
  });
}

/**
 * Reverses an already-POSTED invoice (Customer Invoice or Vendor Bill) —
 * the "this was posted to the ledger and needs to be undone" path, distinct
 * from cancelInvoice above: that function only ever touches a DRAFT invoice
 * whose JournalEntry never took effect, while this one undoes a real,
 * already-POSTED ledger effect (and the Partner balance change that came
 * with it) via the existing reverseJournalEntry — reused, not reimplemented,
 * same as postInvoice reuses postJournalEntry.
 *
 * Only valid on POSTED or PARTIALLY_PAID (anything else — DRAFT, CANCELLED,
 * VOID — is rejected as InvoiceNotReversibleError; DRAFT in particular
 * should go through cancelInvoice instead). PAID is rejected outright with
 * a dedicated, clearer error — see InvoicePaidCannotReverseError's doc
 * comment for why a paid invoice needs a credit note / refund process
 * instead of a plain reversal, a process this schema doesn't have yet.
 *
 * Additionally — and this is the stricter, actually load-bearing check —
 * rejects if the invoice has ANY Payment rows at all (InvoiceHasPaymentsError).
 * In practice this means only a POSTED invoice with zero payments can ever
 * reverse cleanly: a PARTIALLY_PAID invoice always has at least one payment
 * by definition, so it always fails this check too, even though its status
 * alone would otherwise be considered reversible above. This is intentional
 * defense in depth (status and payment count are two independent signals of
 * the same underlying fact) rather than redundant — reversing an invoice out
 * from under a real payment would leave that payment's own JournalEntry
 * posted against a now-VOID invoice with no corresponding adjustment.
 *
 * On success: reverses the linked JournalEntry (creating a new offsetting
 * entry, exactly as reverseJournalEntry already does for vouchers), sets
 * Invoice.status to VOID — matching how JournalEntry reversal already uses
 * VOID as the terminal "this was reversed" status — and decrements exactly
 * ONE Partner balance field by grandTotal, undoing what postInvoice
 * incremented: direction: CUSTOMER touches ONLY outstandingBalance,
 * direction: VENDOR touches ONLY payableBalance, via the same explicit
 * if/else isolation used by postInvoice/recordPayment (never both, never a
 * dynamic key).
 */
export async function reverseInvoice(
  id: string,
  reason?: string
): Promise<ReverseInvoiceResult> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }
    if (invoice.status === "PAID") {
      throw new InvoicePaidCannotReverseError(id);
    }
    if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
      throw new InvoiceNotReversibleError(id, invoice.status);
    }

    const paymentCount = await tx.payment.count({ where: { invoiceId: id } });
    if (paymentCount > 0) {
      throw new InvoiceHasPaymentsError(id, paymentCount);
    }

    const { original, reversal } = await reverseJournalEntry(invoice.journalEntryId, reason, tx);

    const grandTotal = Number(invoice.grandTotal);
    if (invoice.direction === "CUSTOMER") {
      await tx.partner.update({
        where: { id: invoice.partnerId },
        data: { outstandingBalance: { decrement: grandTotal } },
      });
    } else {
      await tx.partner.update({
        where: { id: invoice.partnerId },
        data: { payableBalance: { decrement: grandTotal } },
      });
    }

    const updatedInvoice = await tx.invoice.update({
      where: { id },
      data: { status: "VOID" },
      include: invoiceInclude,
    });

    return { invoice: updatedInvoice, journalEntry: { original, reversal } };
  });
}
