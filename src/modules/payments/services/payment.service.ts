import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  createJournalEntry,
  postJournalEntry,
} from "@/modules/accounting/services/journal-entry.service";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";
import {
  ACCOUNTS_PAYABLE_CODE,
  ACCOUNTS_RECEIVABLE_CODE,
  AccountsPayableNotConfiguredError,
  AccountsReceivableNotConfiguredError,
  InvoiceNotFoundError,
} from "@/modules/invoicing/services/invoice.service";
import type { RecordPaymentInput } from "@/modules/payments/validations/payment.schema";

// Same placeholder used by the invoice/voucher create paths until real auth
// is wired up — JournalEntry.createdById is a plain required String,
// unrelated to Payment.createdById (Int? -> User).
const UNASSIGNED_USER_ID = "system";

export class InvoiceNotPayableError extends Error {
  constructor(id: string, status: string) {
    super(
      `Invoice ${id} is ${status} and cannot receive a payment — only POSTED or PARTIALLY_PAID invoices can be paid`
    );
    this.name = "InvoiceNotPayableError";
  }
}

export class PaymentExceedsRemainingBalanceError extends Error {
  constructor(invoiceId: string, amount: number, remaining: number) {
    super(
      `Payment of ${amount} exceeds invoice ${invoiceId}'s remaining balance of ${remaining} — ` +
        "reduce the amount or check for a data entry error"
    );
    this.name = "PaymentExceedsRemainingBalanceError";
  }
}

export class CashBankAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Account ${id} not found, inactive, or not a Cash/Bank account`);
    this.name = "CashBankAccountNotFoundError";
  }
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

const paymentInclude = {
  invoice: { select: { id: true, invoiceNumber: true, status: true, amountPaid: true } },
  journalEntry: { select: { id: true, documentNumber: true, status: true } },
} satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

/**
 * Records a single payment against one POSTED/PARTIALLY_PAID invoice —
 * deliberately NOT full payment reconciliation (multi-invoice allocation,
 * bank statement matching, etc. stay deferred to Phase 4). Everything below
 * runs in one transaction so a rejected payment never partially applies.
 *
 * Atomic, not two-step like Invoice's create-then-post: a Payment has no
 * DRAFT/review concept in the schema (no `status` field on Payment itself),
 * so its JournalEntry is created and posted back-to-back in the same call
 * rather than exposing a separate "post this payment" step. It still goes
 * through the same createJournalEntry + postJournalEntry building blocks
 * Invoice uses (not reimplemented) — this gets the same balance/active-
 * account validation for free, it just isn't surfaced as its own API call.
 *
 * Overpayment (amount would push amountPaid above grandTotal) is rejected
 * outright rather than allowed to produce a negative remaining balance —
 * this is the kind of input that's virtually always a data entry error
 * (wrong invoice, extra zero, duplicate submission), and there's no
 * legitimate use for a negative balance on a model that doesn't yet support
 * credit notes/refunds. Correcting a genuine overpayment belongs to
 * Phase 4's reconciliation work; for now it fails loudly instead of quietly
 * producing a number nothing downstream expects.
 *
 * Line shape mirrors postInvoice's direction-aware AR/AP logic, mirrored
 * because a payment is the reverse cash movement of the invoice/bill it
 * settles: CUSTOMER (money received) debits the given Cash/Bank account and
 * credits Accounts Receivable (1200); VENDOR (money paid out) debits
 * Accounts Payable (2100) and credits the given Cash/Bank account.
 *
 * On success, decrements exactly ONE Partner balance field with the payment
 * amount — direction: CUSTOMER touches ONLY outstandingBalance, direction:
 * VENDOR touches ONLY payableBalance — same isolation guarantee as
 * postInvoice, via the same explicit if/else (not a dynamic key).
 */
export async function recordPayment(
  invoiceId: string,
  input: RecordPaymentInput
): Promise<PaymentWithRelations> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new InvoiceNotFoundError(invoiceId);
    }
    if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
      throw new InvoiceNotPayableError(invoiceId, invoice.status);
    }

    const cashBankAccount = await tx.chartOfAccount.findUnique({
      where: { id: input.cashBankAccountId },
      select: { id: true, isActive: true, subType: true },
    });
    if (
      !cashBankAccount ||
      !cashBankAccount.isActive ||
      (cashBankAccount.subType !== "CASH" && cashBankAccount.subType !== "BANK")
    ) {
      throw new CashBankAccountNotFoundError(input.cashBankAccountId);
    }

    const currentPaid = Number(invoice.amountPaid);
    const grandTotal = Number(invoice.grandTotal);
    const remaining = roundCurrency(grandTotal - currentPaid);
    if (roundCurrency(input.amount) > remaining) {
      throw new PaymentExceedsRemainingBalanceError(invoiceId, input.amount, remaining);
    }

    const controlAccountCode =
      invoice.direction === "CUSTOMER" ? ACCOUNTS_RECEIVABLE_CODE : ACCOUNTS_PAYABLE_CODE;
    const controlAccount = await tx.chartOfAccount.findUnique({
      where: { code: controlAccountCode },
    });
    if (!controlAccount) {
      throw invoice.direction === "CUSTOMER"
        ? new AccountsReceivableNotConfiguredError(controlAccountCode)
        : new AccountsPayableNotConfiguredError(controlAccountCode);
    }

    const journalEntryInput: JournalEntryInput =
      invoice.direction === "CUSTOMER"
        ? {
            date: input.date,
            description: `Payment received for Invoice ${invoice.invoiceNumber}`,
            reference: invoice.invoiceNumber,
            branchId: invoice.branchId,
            voucherType: "PAYMENT_VOUCHER",
            lines: [
              {
                accountId: input.cashBankAccountId,
                branchId: invoice.branchId,
                debit: input.amount,
                credit: 0,
                memo: `Payment received for ${invoice.invoiceNumber}`,
              },
              {
                accountId: controlAccount.id,
                branchId: invoice.branchId,
                debit: 0,
                credit: input.amount,
                memo: "Accounts Receivable",
              },
            ],
          }
        : {
            date: input.date,
            description: `Payment made for Vendor Bill ${invoice.invoiceNumber}`,
            reference: invoice.invoiceNumber,
            branchId: invoice.branchId,
            voucherType: "PAYMENT_VOUCHER",
            lines: [
              {
                accountId: controlAccount.id,
                branchId: invoice.branchId,
                debit: input.amount,
                credit: 0,
                memo: "Accounts Payable",
              },
              {
                accountId: input.cashBankAccountId,
                branchId: invoice.branchId,
                debit: 0,
                credit: input.amount,
                memo: `Payment made for ${invoice.invoiceNumber}`,
              },
            ],
          };

    const journalEntry = await createJournalEntry(journalEntryInput, UNASSIGNED_USER_ID, tx);
    await postJournalEntry(journalEntry.id, tx);

    const newAmountPaid = roundCurrency(currentPaid + input.amount);
    const newStatus = newAmountPaid >= grandTotal ? "PAID" : "PARTIALLY_PAID";

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid: newAmountPaid, status: newStatus },
    });

    if (invoice.direction === "CUSTOMER") {
      await tx.partner.update({
        where: { id: invoice.partnerId },
        data: { outstandingBalance: { decrement: input.amount } },
      });
    } else {
      await tx.partner.update({
        where: { id: invoice.partnerId },
        data: { payableBalance: { decrement: input.amount } },
      });
    }

    return tx.payment.create({
      data: {
        invoiceId,
        amount: input.amount,
        date: input.date,
        method: input.method,
        reference: input.reference,
        journalEntryId: journalEntry.id,
        createdById: input.createdById,
      },
      include: paymentInclude,
    });
  });
}
