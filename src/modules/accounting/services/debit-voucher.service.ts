import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { generateDocumentNumber } from "@/modules/accounting/services/document-sequence.service";
import {
  BranchNotFoundError,
  journalEntryInclude,
  serializeJournalEntry,
  type JournalEntryWithLines,
} from "@/modules/accounting/services/journal-entry.service";
import type { DebitVoucherInput } from "@/modules/accounting/validations/debit-voucher.schema";

export class CashBankAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Account ${id} not found`);
    this.name = "CashBankAccountNotFoundError";
  }
}

// The real enforcement point for the Bank-account conditional requirement —
// Zod (debit-voucher.schema.ts) can't check this since it needs the
// account's AccountSubType from the DB, so it accepts bankName/chequeNo/
// chequeDate as plain optional fields and this is where they're actually
// required, once cashBankAccountId's subType is known.
export class BankDetailsRequiredError extends Error {
  constructor() {
    super(
      "Bank Name, Cheque No, and Cheque Date are required when the Cash/Bank Account is a Bank-type account"
    );
    this.name = "BankDetailsRequiredError";
  }
}

// Fixed, generic memo for the single consolidated credit line posted against
// the shared Cash/Bank account — each debit line keeps its own per-expense
// description, but the credit side represents their combined total, not any
// one line, so it gets this shared marker instead of a line's description.
const CONSOLIDATED_CREDIT_MEMO = "Consolidated payment — see lines";

async function createDebitVoucherWithClient(
  tx: Prisma.TransactionClient,
  input: DebitVoucherInput,
  createdById: string
): Promise<JournalEntryWithLines> {
  const branch = await tx.branch.findUnique({
    where: { id: input.branchId },
    select: { code: true },
  });
  if (!branch) {
    throw new BranchNotFoundError(input.branchId);
  }

  const cashBankAccount = await tx.chartOfAccount.findUnique({
    where: { id: input.cashBankAccountId },
    select: { subType: true },
  });
  if (!cashBankAccount) {
    throw new CashBankAccountNotFoundError(input.cashBankAccountId);
  }

  const isBankAccount = cashBankAccount.subType === "BANK";
  if (isBankAccount && (!input.bankName?.trim() || !input.chequeNo?.trim() || !input.chequeDate)) {
    throw new BankDetailsRequiredError();
  }

  const totalAmount = input.lines.reduce((sum, line) => sum + line.amount, 0);

  const documentNumber = await generateDocumentNumber(tx, {
    voucherType: "DEBIT_VOUCHER",
    branchId: input.branchId,
    branchCode: branch.code,
    date: input.date,
  });

  const created = await tx.journalEntry.create({
    data: {
      date: input.date,
      description: input.description,
      branchId: input.branchId,
      voucherType: "DEBIT_VOUCHER",
      documentNumber,
      createdById,
      bankName: isBankAccount ? input.bankName!.trim() : null,
      chequeNo: isBankAccount ? input.chequeNo!.trim() : null,
      chequeDate: isBankAccount ? input.chequeDate! : null,
      lines: {
        create: [
          ...input.lines.map((line) => ({
            accountId: line.expenseAccountId,
            branchId: input.branchId,
            debit: line.amount,
            credit: 0,
            memo: line.description,
          })),
          {
            accountId: input.cashBankAccountId,
            branchId: input.branchId,
            debit: 0,
            credit: totalAmount,
            memo: CONSOLIDATED_CREDIT_MEMO,
          },
        ],
      },
    },
    include: journalEntryInclude,
  });
  return serializeJournalEntry(created);
}

/**
 * Creates a Debit Voucher: one JournalEntry with one debit JournalLine per
 * input line (against that line's own expense/payable account) plus a
 * single consolidated credit line against the shared cashBankAccountId for
 * their sum. Reuses createJournalEntry's document-numbering/posting
 * conventions but isn't a thin wrapper around it — the multi-debit/
 * one-credit shape and the Bank-account conditional requirement are
 * specific to this voucher type. The created entry is DRAFT, same as
 * createJournalEntry; posting goes through the existing postJournalEntry.
 */
export async function createDebitVoucher(
  input: DebitVoucherInput,
  createdById: string,
  tx?: Prisma.TransactionClient
): Promise<JournalEntryWithLines> {
  if (tx) {
    return createDebitVoucherWithClient(tx, input, createdById);
  }
  return db.$transaction((transaction) =>
    createDebitVoucherWithClient(transaction, input, createdById)
  );
}
