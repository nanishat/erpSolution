import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { generateDocumentNumber } from "@/modules/accounting/services/document-sequence.service";
import type {
  JournalEntryInput,
  UpdateJournalEntryInput,
} from "@/modules/accounting/validations/journal-entry.schema";
import { postApprovedTaxApplicationLines } from "@/modules/tax/services/tax-posting.service";

export class BranchNotFoundError extends Error {
  constructor(id: string) {
    super(`Branch ${id} not found`);
    this.name = "BranchNotFoundError";
  }
}

export class JournalEntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Journal entry ${id} not found`);
    this.name = "JournalEntryNotFoundError";
  }
}

export class JournalEntryAlreadyPostedError extends Error {
  constructor(id: string) {
    super(`Journal entry ${id} is already posted`);
    this.name = "JournalEntryAlreadyPostedError";
  }
}

export class JournalEntryVoidError extends Error {
  constructor(id: string) {
    super(`Journal entry ${id} is void and cannot be posted`);
    this.name = "JournalEntryVoidError";
  }
}

export class UnbalancedJournalEntryError extends Error {
  constructor(id: string, totalDebit: number, totalCredit: number) {
    super(
      `Journal entry ${id} is not balanced: debits (${totalDebit}) must equal credits (${totalCredit})`
    );
    this.name = "UnbalancedJournalEntryError";
  }
}

export class InactiveAccountJournalLineError extends Error {
  constructor(accountId: string) {
    super(`Account ${accountId} is deactivated and cannot be used to post a journal entry`);
    this.name = "InactiveAccountJournalLineError";
  }
}

export class JournalEntryImmutableError extends Error {
  constructor(id: string, status: string) {
    super(`Journal entry ${id} is ${status} and cannot be modified`);
    this.name = "JournalEntryImmutableError";
  }
}

export class JournalEntryNotPostedError extends Error {
  constructor(id: string) {
    super(`Journal entry ${id} is not posted and has nothing to reverse`);
    this.name = "JournalEntryNotPostedError";
  }
}

export class JournalEntryAlreadyReversedError extends Error {
  constructor(id: string) {
    super(`Journal entry ${id} has already been reversed`);
    this.name = "JournalEntryAlreadyReversedError";
  }
}

export class CannotReverseAReversalError extends Error {
  constructor(id: string) {
    super(`Journal entry ${id} is itself a reversal and cannot be reversed`);
    this.name = "CannotReverseAReversalError";
  }
}

export class PendingTaxApprovalError extends Error {
  constructor(id: string) {
    super(
      `Journal entry ${id} has a tax application still PENDING_REVIEW and cannot be posted until it is approved or rejected`
    );
    this.name = "PendingTaxApprovalError";
  }
}

const journalEntryInclude = {
  branch: { select: { id: true, name: true, code: true } },
  lines: { include: { account: true, branch: { select: { id: true, name: true, code: true } } } },
  reversalOfEntry: { select: { id: true, documentNumber: true } },
  reversedByEntry: { select: { id: true, documentNumber: true } },
  taxApplications: {
    include: {
      partner: { select: { id: true, name: true } },
      sourceTaxRate: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.JournalEntryInclude;

export type JournalEntryWithLines = Prisma.JournalEntryGetPayload<{
  include: typeof journalEntryInclude;
}>;

export async function getJournalEntries(): Promise<JournalEntryWithLines[]> {
  return db.journalEntry.findMany({
    include: journalEntryInclude,
    orderBy: { date: "desc" },
  });
}

export async function getJournalEntryById(
  id: string
): Promise<JournalEntryWithLines | null> {
  return db.journalEntry.findUnique({
    where: { id },
    include: journalEntryInclude,
  });
}

async function createJournalEntryWithClient(
  tx: Prisma.TransactionClient,
  input: JournalEntryInput,
  createdById: string
): Promise<JournalEntryWithLines> {
  const branch = await tx.branch.findUnique({
    where: { id: input.branchId },
    select: { code: true },
  });
  if (!branch) {
    throw new BranchNotFoundError(input.branchId);
  }

  const documentNumber = await generateDocumentNumber(tx, {
    voucherType: input.voucherType,
    branchId: input.branchId,
    branchCode: branch.code,
    date: input.date,
  });

  return tx.journalEntry.create({
    data: {
      date: input.date,
      description: input.description,
      reference: input.reference,
      branchId: input.branchId,
      voucherType: input.voucherType,
      documentNumber,
      createdById,
      lines: {
        create: input.lines.map((line) => ({
          accountId: line.accountId,
          branchId: line.branchId,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo,
        })),
      },
    },
    include: journalEntryInclude,
  });
}

/**
 * Creates a JournalEntry with its lines and a generated document number.
 * Pass `tx` to run as part of an already-open transaction (e.g. Invoice
 * creation, which needs the entry, the Invoice row, and its lines to commit
 * atomically) — mirrors the optional-tx pattern already used by
 * postJournalEntry/reverseJournalEntry below; otherwise a new transaction is
 * opened for this call alone.
 */
export async function createJournalEntry(
  input: JournalEntryInput,
  createdById: string,
  tx?: Prisma.TransactionClient
): Promise<JournalEntryWithLines> {
  if (tx) {
    return createJournalEntryWithClient(tx, input, createdById);
  }
  return db.$transaction((transaction) =>
    createJournalEntryWithClient(transaction, input, createdById)
  );
}

/**
 * Updates a DRAFT journal entry's date/description/reference/lines wholesale
 * (lines are replaced, not diffed). voucherType, branchId, and documentNumber
 * are intentionally not editable — the document number is stamped from the
 * voucher type/branch/month at creation and must stay a stable reference.
 * Rejects with JournalEntryImmutableError if the entry is POSTED or VOID.
 */
export async function updateJournalEntry(
  entryId: string,
  input: UpdateJournalEntryInput
): Promise<JournalEntryWithLines> {
  return db.$transaction(async (tx) => {
    const existing = await tx.journalEntry.findUnique({ where: { id: entryId } });
    if (!existing) {
      throw new JournalEntryNotFoundError(entryId);
    }
    if (existing.status !== "DRAFT") {
      throw new JournalEntryImmutableError(entryId, existing.status);
    }

    await tx.journalLine.deleteMany({ where: { journalEntryId: entryId } });

    return tx.journalEntry.update({
      where: { id: entryId },
      data: {
        date: input.date,
        description: input.description,
        reference: input.reference,
        lines: {
          create: input.lines.map((line) => ({
            accountId: line.accountId,
            branchId: line.branchId,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo,
          })),
        },
      },
      include: journalEntryInclude,
    });
  });
}

async function reverseJournalEntryWithClient(
  tx: Prisma.TransactionClient,
  entryId: string,
  reason?: string
): Promise<{ original: JournalEntryWithLines; reversal: JournalEntryWithLines }> {
  const original = await tx.journalEntry.findUnique({
    where: { id: entryId },
    include: journalEntryInclude,
  });

  if (!original) {
    throw new JournalEntryNotFoundError(entryId);
  }
  if (original.reversalOfEntryId) {
    throw new CannotReverseAReversalError(entryId);
  }
  if (original.status === "DRAFT") {
    throw new JournalEntryNotPostedError(entryId);
  }
  // status === "VOID" is only ever reached via a prior reversal (see below),
  // and reversedByEntry is the same fact via the unique self-relation — check
  // both since the relation is the more direct signal to detect double-reversal.
  if (original.status === "VOID" || original.reversedByEntry) {
    throw new JournalEntryAlreadyReversedError(entryId);
  }

  const branch = await tx.branch.findUnique({
    where: { id: original.branchId },
    select: { code: true },
  });
  if (!branch) {
    throw new BranchNotFoundError(original.branchId);
  }

  const reversalDate = new Date();
  const documentNumber = await generateDocumentNumber(tx, {
    voucherType: original.voucherType,
    branchId: original.branchId,
    branchCode: branch.code,
    date: reversalDate,
  });

  // Created straight to POSTED rather than routed through postJournalEntry:
  // swapping debit/credit on an already-balanced entry is balanced by
  // construction, and re-running the active-account check here would wrongly
  // block reversing an entry whose account was deactivated *after* the
  // original posting — undoing history shouldn't be gated on that.
  const reversal = await tx.journalEntry.create({
    data: {
      date: reversalDate,
      description: reason
        ? `Reversal of ${original.documentNumber}: ${reason}`
        : `Reversal of ${original.documentNumber}`,
      reference: original.documentNumber,
      branchId: original.branchId,
      voucherType: original.voucherType,
      documentNumber,
      status: "POSTED",
      createdById: original.createdById,
      reversalOfEntryId: original.id,
      lines: {
        create: original.lines.map((line) => ({
          accountId: line.accountId,
          branchId: line.branchId,
          debit: line.credit,
          credit: line.debit,
          memo: line.memo,
        })),
      },
    },
    include: journalEntryInclude,
  });

  const updatedOriginal = await tx.journalEntry.update({
    where: { id: entryId },
    data: { status: "VOID" },
    include: journalEntryInclude,
  });

  return { original: updatedOriginal, reversal };
}

/**
 * Reverses a POSTED journal entry by creating a new, separate POSTED entry
 * with debit/credit swapped on every line (net effect zero), linked back via
 * reversalOfEntryId, and flips the original to VOID — VOID is only ever
 * reached through this path, there is no direct "void" action. Only
 * original entries can be reversed — an entry that is itself a reversal
 * (reversalOfEntryId set) is rejected, so reversal chains can't grow past
 * one level. Pass `tx` to run as part of an already-open transaction;
 * otherwise a new one is opened.
 */
export async function reverseJournalEntry(
  entryId: string,
  reason?: string,
  tx?: Prisma.TransactionClient
): Promise<{ original: JournalEntryWithLines; reversal: JournalEntryWithLines }> {
  if (tx) {
    return reverseJournalEntryWithClient(tx, entryId, reason);
  }
  return db.$transaction((transaction) =>
    reverseJournalEntryWithClient(transaction, entryId, reason)
  );
}

async function postJournalEntryWithClient(
  tx: Prisma.TransactionClient,
  entryId: string
): Promise<JournalEntryWithLines> {
  const entry = await tx.journalEntry.findUnique({
    where: { id: entryId },
    include: journalEntryInclude,
  });

  if (!entry) {
    throw new JournalEntryNotFoundError(entryId);
  }
  if (entry.status === "POSTED") {
    throw new JournalEntryAlreadyPostedError(entryId);
  }
  if (entry.status === "VOID") {
    throw new JournalEntryVoidError(entryId);
  }

  // Defense in depth: re-check the balance against current DB state rather than
  // trusting create-time validation, in case the entry was edited since creation.
  const totalDebit = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0);
  if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
    throw new UnbalancedJournalEntryError(entryId, totalDebit, totalCredit);
  }

  const inactiveLine = entry.lines.find((line) => !line.account.isActive);
  if (inactiveLine) {
    throw new InactiveAccountJournalLineError(inactiveLine.accountId);
  }

  // Approval gates posting, not the reverse (confirmed business rule) — any
  // tax application still awaiting review blocks the entry from posting.
  const pendingTaxApplication = await tx.taxApplication.findFirst({
    where: { journalEntryId: entryId, status: "PENDING_REVIEW" },
    select: { id: true },
  });
  if (pendingTaxApplication) {
    throw new PendingTaxApprovalError(entryId);
  }

  // Adds the JournalLine pair for every APPROVED tax application on this
  // entry (VAT Payable/Receivable, TDS/VDS Payable) before posting — see
  // postApprovedTaxApplicationLines. Runs here rather than at the moment of
  // approval so a still-DRAFT entry (which may yet be edited wholesale via
  // updateJournalEntry, which deletes and recreates all lines) never carries
  // tax lines that could be silently wiped out from under an already-APPROVED
  // TaxApplication.
  await postApprovedTaxApplicationLines(tx, entry);

  return tx.journalEntry.update({
    where: { id: entryId },
    data: { status: "POSTED" },
    include: journalEntryInclude,
  });
}

/**
 * Transitions a DRAFT journal entry to POSTED, re-validating balance and
 * account status against current DB state. Pass `tx` to run as part of an
 * already-open transaction (e.g. a caller posting multiple entries atomically);
 * otherwise a new transaction is opened for this call alone.
 */
export async function postJournalEntry(
  entryId: string,
  tx?: Prisma.TransactionClient
): Promise<JournalEntryWithLines> {
  if (tx) {
    return postJournalEntryWithClient(tx, entryId);
  }
  return db.$transaction((transaction) => postJournalEntryWithClient(transaction, entryId));
}
