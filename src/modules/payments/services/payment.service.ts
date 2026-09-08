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
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";
import type {
  ApplyPartnerCreditInput,
  RecordPaymentForInvoiceInput,
  RecordPaymentInput,
} from "@/modules/payments/validations/payment.schema";

// Same placeholder used by the invoice/voucher create paths until real auth
// is wired up — JournalEntry.createdById is a plain required String,
// unrelated to Payment.createdById (Int? -> User).
const UNASSIGNED_USER_ID = "system";

export class InvoiceNotPayableError extends Error {
  constructor(id: string, status: string) {
    super(
      `Invoice ${id} is ${status} and cannot receive a payment/credit — only POSTED or PARTIALLY_PAID invoices can be settled`
    );
    this.name = "InvoiceNotPayableError";
  }
}

export class PaymentExceedsRemainingBalanceError extends Error {
  constructor(invoiceId: string, amount: number, remaining: number) {
    super(
      `Amount ${amount} exceeds invoice ${invoiceId}'s remaining balance of ${remaining} — ` +
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

// Defense in depth behind recordPaymentSchema's own superRefine — this
// re-check runs against the parsed input inside the transaction rather than
// trusting the Zod layer alone, same "validate twice" precedent as
// postJournalEntryWithClient re-checking balance against live DB state.
export class PaymentAllocationExceedsAmountError extends Error {
  constructor(totalAllocated: number, amount: number) {
    super(
      `Sum of allocations (${totalAllocated}) exceeds the payment amount (${amount}) — this is an ` +
        "over-allocation, not an overpayment; reduce an allocation or the payment amount"
    );
    this.name = "PaymentAllocationExceedsAmountError";
  }
}

export class InvoiceBelongsToDifferentPartnerError extends Error {
  constructor(invoiceId: string, partnerId: string) {
    super(`Invoice ${invoiceId} does not belong to partner ${partnerId}`);
    this.name = "InvoiceBelongsToDifferentPartnerError";
  }
}

export class InvoiceDirectionMismatchError extends Error {
  constructor(invoiceId: string, invoiceDirection: string, partnerType: string) {
    super(
      `Invoice ${invoiceId} has direction ${invoiceDirection}, which does not match a ${partnerType} ` +
        "partner's payment direction"
    );
    this.name = "InvoiceDirectionMismatchError";
  }
}

export class PartnerCreditNotFoundError extends Error {
  constructor(id: string) {
    super(`Partner credit ${id} not found`);
    this.name = "PartnerCreditNotFoundError";
  }
}

export class PartnerCreditNotApplicableError extends Error {
  constructor(id: string, status: string) {
    super(
      `Partner credit ${id} is ${status} and cannot be applied — only OPEN or PARTIALLY_APPLIED ` +
        "credits can be applied"
    );
    this.name = "PartnerCreditNotApplicableError";
  }
}

export class CreditAmountExceedsRemainingError extends Error {
  constructor(creditId: string, amount: number, remaining: number) {
    super(
      `Amount ${amount} exceeds partner credit ${creditId}'s remaining balance of ${remaining}`
    );
    this.name = "CreditAmountExceedsRemainingError";
  }
}

export class CreditInvoicePartnerMismatchError extends Error {
  constructor(creditId: string, invoiceId: string) {
    super(`Partner credit ${creditId} does not belong to the same partner as invoice ${invoiceId}`);
    this.name = "CreditInvoicePartnerMismatchError";
  }
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

const paymentInclude = {
  allocations: {
    include: {
      invoice: { select: { id: true, invoiceNumber: true, status: true, amountPaid: true } },
    },
  },
  creditGrant: true,
  journalEntry: { select: { id: true, documentNumber: true, status: true } },
} satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

/**
 * An invoice's remaining unpaid balance: grandTotal minus everything settled
 * against it so far, from BOTH settlement paths — PaymentAllocation (real
 * cash, via recordPayment) and CreditApplication (overpayment credit
 * consumed later, via applyPartnerCredit). The two are summed as one pool
 * deliberately: from the invoice's perspective, a PartnerCredit application
 * and a cash payment allocation are the same kind of event ("this much of
 * what's owed is now settled") — the only difference is where the money
 * came from, which CreditApplication/PaymentAllocation each record
 * separately for audit purposes. Pass `tx` to read within an already-open
 * transaction's view of uncommitted writes (both recordPayment and
 * applyPartnerCredit need this — the invoice's own allocations/applications
 * created earlier in the same transaction must count); otherwise reads
 * against current committed state.
 */
export async function getInvoiceRemainingBalance(
  invoiceId: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const client = tx ?? db;
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { grandTotal: true },
  });
  if (!invoice) {
    throw new InvoiceNotFoundError(invoiceId);
  }

  const [allocationSum, creditSum] = await Promise.all([
    client.paymentAllocation.aggregate({ where: { invoiceId }, _sum: { amountApplied: true } }),
    client.creditApplication.aggregate({ where: { invoiceId }, _sum: { amountApplied: true } }),
  ]);
  const applied = roundCurrency(
    Number(allocationSum._sum.amountApplied ?? 0) + Number(creditSum._sum.amountApplied ?? 0)
  );
  return roundCurrency(Number(invoice.grandTotal) - applied);
}

export type OpenInvoiceOption = {
  id: string;
  invoiceNumber: string;
  date: Date;
  grandTotal: number;
  amountPaid: number;
  status: string;
  remainingBalance: number;
};

/**
 * A partner's invoices/bills still open for payment — POSTED or
 * PARTIALLY_PAID, direction-aware from Partner.type same as recordPayment
 * (CUSTOMER -> their Customer Invoices, VENDOR -> their Vendor Bills) — for
 * the manual-matching payment picker UI. remainingBalance is computed the
 * same way recordPayment validates against it (getInvoiceRemainingBalance,
 * i.e. grandTotal minus BOTH prior PaymentAllocations and prior
 * CreditApplications), so a row's displayed remaining balance is exactly the
 * most this invoice can still absorb.
 */
export async function getOpenInvoicesForPartner(partnerId: string): Promise<OpenInvoiceOption[]> {
  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, type: true },
  });
  if (!partner) {
    throw new PartnerNotFoundError(partnerId);
  }

  const direction = partner.type === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
  const invoices = await db.invoice.findMany({
    where: { partnerId, direction, status: { in: ["POSTED", "PARTIALLY_PAID"] } },
    orderBy: { date: "asc" },
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      grandTotal: true,
      amountPaid: true,
      status: true,
    },
  });

  return Promise.all(
    invoices.map(async (invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      grandTotal: Number(invoice.grandTotal),
      amountPaid: Number(invoice.amountPaid),
      status: invoice.status,
      remainingBalance: await getInvoiceRemainingBalance(invoice.id),
    }))
  );
}

/**
 * Records a Payment from/to a Partner (direction inferred from
 * Partner.type — never stored redundantly), optionally allocated across
 * multiple of that partner's invoices in one call. Any amount left over
 * after allocations becomes an OPEN PartnerCredit rather than being
 * rejected — see the leftover handling below. Everything runs in one
 * transaction so a rejected payment never partially applies.
 *
 * Atomic, not two-step like Invoice's create-then-post: a Payment has no
 * DRAFT/review concept in the schema (no `status` field), so its
 * JournalEntry is created and posted back-to-back in the same call rather
 * than exposing a separate "post this payment" step — same as the Phase 3
 * version this replaces. This atomicity is also why the general
 * post/edit-via-general-journal-entries-list guard that Invoice needs
 * (JournalEntryMustPostViaInvoiceError) does NOT need a Payment
 * counterpart: a Payment-linked JournalEntry is never observable in a
 * postable DRAFT state outside this transaction — see
 * journal-entry-invoice-guard-manual-test.ts's header comment for the full
 * reasoning, which still holds unchanged here.
 *
 * The JournalEntry always posts for the FULL input.amount (not just what
 * gets allocated) — Debit [selected Cash/Bank account] / Credit Accounts
 * Receivable for a CUSTOMER partner; Debit Accounts Payable / Credit
 * [selected Cash/Bank account] for a VENDOR partner — reusing the exact
 * same AR/AP ChartOfAccount rows postInvoice uses (looked up by
 * ACCOUNTS_RECEIVABLE_CODE/ACCOUNTS_PAYABLE_CODE, same as postInvoice/the
 * Phase 3 recordPayment). Partner.outstandingBalance/payableBalance is
 * decremented by that same full amount, matching the full AR/AP credit/debit
 * on the ledger — the "unapplied" leftover sits as a negative sub-balance
 * within that same control total until a PartnerCredit is later applied to
 * a specific invoice via applyPartnerCredit, at which point it moves from
 * "leftover cash against the control account" to "settled against this
 * invoice" without any further cash movement or JournalEntry.
 *
 * On success, decrements exactly ONE Partner AR/AP field — direction:
 * CUSTOMER touches ONLY outstandingBalance, direction: VENDOR touches ONLY
 * payableBalance — same isolation guarantee as postInvoice, via the same
 * explicit if/else (not a dynamic key). creditBalance is incremented
 * separately, only when there's a leftover.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<PaymentWithRelations> {
  return db.$transaction(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner) {
      throw new PartnerNotFoundError(input.partnerId);
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

    const totalAllocated = roundCurrency(
      input.allocations.reduce((sum, allocation) => sum + allocation.amountApplied, 0)
    );
    if (totalAllocated > roundCurrency(input.amount)) {
      throw new PaymentAllocationExceedsAmountError(totalAllocated, input.amount);
    }

    const expectedInvoiceDirection = partner.type === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
    const invoiceIds = Array.from(new Set(input.allocations.map((a) => a.invoiceId)));
    const invoices = await tx.invoice.findMany({ where: { id: { in: invoiceIds } } });
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    // Running per-invoice allocated total *within this call* — catches two
    // allocation rows against the same invoice in one payment together
    // exceeding its remaining balance, even though each looks fine alone.
    const allocatedSoFarByInvoice = new Map<string, number>();

    for (const allocation of input.allocations) {
      const invoice = invoiceById.get(allocation.invoiceId);
      if (!invoice) {
        throw new InvoiceNotFoundError(allocation.invoiceId);
      }
      if (invoice.partnerId !== input.partnerId) {
        throw new InvoiceBelongsToDifferentPartnerError(invoice.id, input.partnerId);
      }
      if (invoice.direction !== expectedInvoiceDirection) {
        throw new InvoiceDirectionMismatchError(invoice.id, invoice.direction, partner.type);
      }
      if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
        throw new InvoiceNotPayableError(invoice.id, invoice.status);
      }

      const remaining = await getInvoiceRemainingBalance(invoice.id, tx);
      const alreadyAllocatedThisPayment = allocatedSoFarByInvoice.get(invoice.id) ?? 0;
      const availableRemaining = roundCurrency(remaining - alreadyAllocatedThisPayment);
      if (roundCurrency(allocation.amountApplied) > availableRemaining) {
        throw new PaymentExceedsRemainingBalanceError(
          invoice.id,
          allocation.amountApplied,
          availableRemaining
        );
      }
      allocatedSoFarByInvoice.set(
        invoice.id,
        roundCurrency(alreadyAllocatedThisPayment + allocation.amountApplied)
      );
    }

    const controlAccountCode =
      partner.type === "CUSTOMER" ? ACCOUNTS_RECEIVABLE_CODE : ACCOUNTS_PAYABLE_CODE;
    const controlAccount = await tx.chartOfAccount.findUnique({ where: { code: controlAccountCode } });
    if (!controlAccount) {
      throw partner.type === "CUSTOMER"
        ? new AccountsReceivableNotConfiguredError(controlAccountCode)
        : new AccountsPayableNotConfiguredError(controlAccountCode);
    }

    const journalEntryInput: JournalEntryInput =
      partner.type === "CUSTOMER"
        ? {
            date: input.date,
            description: `Payment received from ${partner.name}`,
            reference: input.reference,
            branchId: input.branchId,
            voucherType: "PAYMENT_VOUCHER",
            lines: [
              {
                accountId: input.cashBankAccountId,
                branchId: input.branchId,
                debit: input.amount,
                credit: 0,
                memo: `Payment received from ${partner.name}`,
              },
              {
                accountId: controlAccount.id,
                branchId: input.branchId,
                debit: 0,
                credit: input.amount,
                memo: "Accounts Receivable",
              },
            ],
          }
        : {
            date: input.date,
            description: `Payment made to ${partner.name}`,
            reference: input.reference,
            branchId: input.branchId,
            voucherType: "PAYMENT_VOUCHER",
            lines: [
              {
                accountId: controlAccount.id,
                branchId: input.branchId,
                debit: input.amount,
                credit: 0,
                memo: "Accounts Payable",
              },
              {
                accountId: input.cashBankAccountId,
                branchId: input.branchId,
                debit: 0,
                credit: input.amount,
                memo: `Payment made to ${partner.name}`,
              },
            ],
          };

    const journalEntry = await createJournalEntry(journalEntryInput, UNASSIGNED_USER_ID, tx);
    await postJournalEntry(journalEntry.id, tx);

    const payment = await tx.payment.create({
      data: {
        partnerId: input.partnerId,
        amount: input.amount,
        date: input.date,
        method: input.method,
        reference: input.reference,
        journalEntryId: journalEntry.id,
        createdById: input.createdById,
        allocations: {
          create: input.allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId,
            amountApplied: allocation.amountApplied,
          })),
        },
      },
    });

    for (const invoiceId of invoiceIds) {
      const invoice = invoiceById.get(invoiceId)!;
      const remaining = await getInvoiceRemainingBalance(invoiceId, tx);
      const grandTotal = Number(invoice.grandTotal);
      const newAmountPaid = roundCurrency(grandTotal - remaining);
      const newStatus = newAmountPaid >= grandTotal ? "PAID" : "PARTIALLY_PAID";
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: newAmountPaid, status: newStatus },
      });
    }

    const leftover = roundCurrency(input.amount - totalAllocated);
    const partnerUpdateData: Prisma.PartnerUpdateInput =
      partner.type === "CUSTOMER"
        ? { outstandingBalance: { decrement: input.amount } }
        : { payableBalance: { decrement: input.amount } };

    if (leftover > 0) {
      await tx.partnerCredit.create({
        data: {
          partnerId: input.partnerId,
          sourcePaymentId: payment.id,
          originalAmount: leftover,
          remainingAmount: leftover,
          status: "OPEN",
        },
      });
      partnerUpdateData.creditBalance = { increment: leftover };
    }

    await tx.partner.update({ where: { id: input.partnerId }, data: partnerUpdateData });

    return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude });
  });
}

/**
 * Thin adapter over recordPayment for the legacy single-invoice call shape —
 * powers POST /api/invoices/[id]/payments and RecordPaymentForm.tsx, which
 * only know an invoiceId (partnerId/branchId/allocations are derived from
 * it, not supplied by the caller). Builds a single-element allocations
 * array of the full amount, so the existing "overpayment against this one
 * invoice is rejected outright" behavior is preserved unchanged: with one
 * allocation equal to the full amount, leftover is always 0, and
 * recordPayment's per-allocation remaining-balance check
 * (PaymentExceedsRemainingBalanceError) fires exactly as it did before this
 * rework, rather than silently turning an overpayment into a credit for
 * this call shape.
 */
export async function recordPaymentForInvoice(
  invoiceId: string,
  input: RecordPaymentForInvoiceInput
): Promise<PaymentWithRelations> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { partnerId: true, branchId: true },
  });
  if (!invoice) {
    throw new InvoiceNotFoundError(invoiceId);
  }

  return recordPayment({
    ...input,
    partnerId: invoice.partnerId,
    branchId: invoice.branchId,
    allocations: [{ invoiceId, amountApplied: input.amount }],
  });
}

export type ApplyPartnerCreditResult = {
  creditApplication: { id: string; creditId: string; invoiceId: string; amountApplied: number; appliedAt: Date };
  partnerCredit: { id: string; remainingAmount: number; status: string };
  invoice: { id: string; amountPaid: number; status: string };
};

/**
 * Manually applies (part of) an OPEN/PARTIALLY_APPLIED PartnerCredit to one
 * of that same partner's invoices. Manual selection only, by design — this
 * is never invoked automatically against a partner's other open invoices
 * anywhere else in this codebase (see recordPayment, which only ever
 * creates credits, never consumes them).
 *
 * Does NOT touch the JournalEntry ledger: the cash behind this credit was
 * already fully recognized (Debit Cash/Bank, Credit AR/AP for the full
 * payment amount) when the original overpayment posted in recordPayment.
 * Applying it later to a specific invoice re-attributes already-recognized
 * cash from the partner's unapplied-credit bucket to that invoice's own
 * paid-to-date total — it is not a new cash movement, so it gets no second
 * JournalEntry. Consistently, this also does NOT touch
 * Partner.outstandingBalance/payableBalance (recordPayment already
 * decremented the full amount at receipt time) — only Partner.creditBalance
 * and the invoice's own amountPaid/status move here.
 */
export async function applyPartnerCredit(
  input: ApplyPartnerCreditInput
): Promise<ApplyPartnerCreditResult> {
  return db.$transaction(async (tx) => {
    const credit = await tx.partnerCredit.findUnique({ where: { id: input.partnerCreditId } });
    if (!credit) {
      throw new PartnerCreditNotFoundError(input.partnerCreditId);
    }
    if (credit.status !== "OPEN" && credit.status !== "PARTIALLY_APPLIED") {
      throw new PartnerCreditNotApplicableError(credit.id, credit.status);
    }

    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) {
      throw new InvoiceNotFoundError(input.invoiceId);
    }
    if (invoice.partnerId !== credit.partnerId) {
      throw new CreditInvoicePartnerMismatchError(credit.id, invoice.id);
    }
    if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
      throw new InvoiceNotPayableError(invoice.id, invoice.status);
    }

    const remainingCredit = roundCurrency(Number(credit.remainingAmount));
    if (roundCurrency(input.amountToApply) > remainingCredit) {
      throw new CreditAmountExceedsRemainingError(credit.id, input.amountToApply, remainingCredit);
    }

    const remainingBalance = await getInvoiceRemainingBalance(invoice.id, tx);
    if (roundCurrency(input.amountToApply) > remainingBalance) {
      throw new PaymentExceedsRemainingBalanceError(invoice.id, input.amountToApply, remainingBalance);
    }

    const creditApplication = await tx.creditApplication.create({
      data: { creditId: credit.id, invoiceId: invoice.id, amountApplied: input.amountToApply },
    });

    const newRemainingCredit = roundCurrency(remainingCredit - input.amountToApply);
    const newCreditStatus = newRemainingCredit <= 0 ? "FULLY_APPLIED" : "PARTIALLY_APPLIED";
    const updatedCredit = await tx.partnerCredit.update({
      where: { id: credit.id },
      data: { remainingAmount: newRemainingCredit, status: newCreditStatus },
    });

    await tx.partner.update({
      where: { id: credit.partnerId },
      data: { creditBalance: { decrement: input.amountToApply } },
    });

    const grandTotal = Number(invoice.grandTotal);
    const newRemainingBalance = roundCurrency(remainingBalance - input.amountToApply);
    const newAmountPaid = roundCurrency(grandTotal - newRemainingBalance);
    const newStatus = newAmountPaid >= grandTotal ? "PAID" : "PARTIALLY_PAID";
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: newAmountPaid, status: newStatus },
    });

    return {
      creditApplication: {
        id: creditApplication.id,
        creditId: creditApplication.creditId,
        invoiceId: creditApplication.invoiceId,
        amountApplied: Number(creditApplication.amountApplied),
        appliedAt: creditApplication.appliedAt,
      },
      partnerCredit: {
        id: updatedCredit.id,
        remainingAmount: Number(updatedCredit.remainingAmount),
        status: updatedCredit.status,
      },
      invoice: {
        id: updatedInvoice.id,
        amountPaid: Number(updatedInvoice.amountPaid),
        status: updatedInvoice.status,
      },
    };
  });
}
