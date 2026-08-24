import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { generateDocumentNumber } from "@/modules/accounting/services/document-sequence.service";
import type {
  JournalEntryInput,
  UpdateJournalEntryInput,
} from "@/modules/accounting/validations/journal-entry.schema";
import { postTaxApplicationLines } from "@/modules/tax/services/tax-posting.service";

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

export class JournalEntryNotDraftForVoidError extends Error {
  constructor(id: string, status: string) {
    super(
      `Journal entry ${id} is ${status}, not DRAFT — only a still-DRAFT entry can be voided ` +
        "this way; a POSTED entry must go through reverseJournalEntry instead"
    );
    this.name = "JournalEntryNotDraftForVoidError";
  }
}

// Guards the data-integrity gap where posting an Invoice's eagerly-created
// JournalEntry through this generic path (e.g. the "Post" button on the
// general journal entries list) would flip the ledger live while skipping
// everything postInvoice does around it — the Invoice's own status update
// and the Partner balance increment. See postJournalEntryWithClient's
// invoice-link check and postInvoiceLinkedJournalEntry below.
export class JournalEntryMustPostViaInvoiceError extends Error {
  constructor(entryId: string, invoiceId: string, invoiceNumber: string) {
    super(
      `Journal entry ${entryId} belongs to Invoice ${invoiceNumber} (${invoiceId}) and cannot be ` +
        `posted directly — post it via POST /api/invoices/${invoiceId}/post instead, which also ` +
        "updates the Invoice's status and the Partner's balance"
    );
    this.name = "JournalEntryMustPostViaInvoiceError";
  }
}

// Same category of gap as JournalEntryMustPostViaInvoiceError above, for
// editing instead of posting: an Invoice's eagerly-created JournalEntry's
// lines are the source Invoice.subtotal/lines were computed from — editing
// them directly here would silently diverge the two. There is deliberately
// no "edit it via the invoice instead" pointer in this message (unlike the
// posting error, which points to a real endpoint): Invoice has no
// updateInvoice function yet, so there is no alternate path to direct
// callers to. This message says only that direct edits aren't allowed.
export class JournalEntryMustEditViaInvoiceError extends Error {
  constructor(entryId: string, invoiceId: string, invoiceNumber: string) {
    super(
      `Journal entry ${entryId} belongs to Invoice ${invoiceNumber} (${invoiceId}) and cannot be ` +
        "edited directly — its lines are derived from the Invoice and editing them here would " +
        "diverge from it"
    );
    this.name = "JournalEntryMustEditViaInvoiceError";
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
  // Surfaced so the UI can hide/disable the generic "Post" button on an
  // invoice-linked entry and link to the Invoice/Vendor Bill detail page
  // instead — see JournalEntryMustPostViaInvoiceError for why posting it
  // here directly is rejected at the service layer regardless of what the
  // UI shows. `direction` picks which of the two basePaths
  // (/accounting/invoices vs /accounting/vendor-bills) that link should use.
  invoice: { select: { id: true, invoiceNumber: true, direction: true } },
} satisfies Prisma.JournalEntryInclude;

type JournalEntryRow = Prisma.JournalEntryGetPayload<{
  include: typeof journalEntryInclude;
}>;

// debit/credit (JournalLine), ratePercent/baseAmount/taxAmount
// (TaxApplication), and the nested line.account.openingBalance (the full
// ChartOfAccount pulled in via `account: true`) are all Prisma Decimals,
// which React Server Components can't pass to "use client" components
// ("Decimal objects are not supported") — convert every one of them to a
// plain number before this ever reaches a page/component, mirroring
// serializeProductService() in product-service.service.ts.
export type JournalEntryWithLines = Omit<JournalEntryRow, "lines" | "taxApplications"> & {
  lines: (Omit<JournalEntryRow["lines"][number], "debit" | "credit" | "account"> & {
    debit: number;
    credit: number;
    account: Omit<JournalEntryRow["lines"][number]["account"], "openingBalance"> & {
      openingBalance: number;
    };
  })[];
  taxApplications: (Omit<
    JournalEntryRow["taxApplications"][number],
    "ratePercent" | "baseAmount" | "taxAmount"
  > & {
    ratePercent: number;
    baseAmount: number;
    taxAmount: number;
  })[];
};

function serializeJournalEntry(entry: JournalEntryRow): JournalEntryWithLines {
  return {
    ...entry,
    lines: entry.lines.map((line) => ({
      ...line,
      debit: Number(line.debit),
      credit: Number(line.credit),
      account: { ...line.account, openingBalance: Number(line.account.openingBalance) },
    })),
    taxApplications: entry.taxApplications.map((app) => ({
      ...app,
      ratePercent: Number(app.ratePercent),
      baseAmount: Number(app.baseAmount),
      taxAmount: Number(app.taxAmount),
    })),
  };
}

export async function getJournalEntries(): Promise<JournalEntryWithLines[]> {
  const entries = await db.journalEntry.findMany({
    include: journalEntryInclude,
    orderBy: { date: "desc" },
  });
  return entries.map(serializeJournalEntry);
}

export async function getJournalEntryById(
  id: string
): Promise<JournalEntryWithLines | null> {
  const entry = await db.journalEntry.findUnique({
    where: { id },
    include: journalEntryInclude,
  });
  return entry ? serializeJournalEntry(entry) : null;
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

  const created = await tx.journalEntry.create({
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
  return serializeJournalEntry(created);
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
 *
 * Rejects with JournalEntryMustEditViaInvoiceError if the entry is linked to
 * an Invoice — same data-integrity concern as postJournalEntry's invoice-link
 * guard: editing an invoice-linked entry's lines directly here would silently
 * diverge them from Invoice.subtotal/lines, which are computed and stored
 * independently on the Invoice row. Unlike the posting case there is no
 * bypass here (no postInvoiceLinkedJournalEntry equivalent): nothing in this
 * codebase legitimately calls updateJournalEntry on an invoice-linked entry
 * today — Invoice has no updateInvoice function yet, and
 * createInvoice/postInvoice never call updateJournalEntry — so this is an
 * unconditional guard, not an opt-out-able one. If/when Invoice editing is
 * built, it should get its own dedicated update path (mirroring
 * postInvoiceLinkedJournalEntry), not a bypass grafted onto this function.
 */
export async function updateJournalEntry(
  entryId: string,
  input: UpdateJournalEntryInput
): Promise<JournalEntryWithLines> {
  return db.$transaction(async (tx) => {
    const existing = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { invoice: { select: { id: true, invoiceNumber: true } } },
    });
    if (!existing) {
      throw new JournalEntryNotFoundError(entryId);
    }
    if (existing.status !== "DRAFT") {
      throw new JournalEntryImmutableError(entryId, existing.status);
    }
    if (existing.invoice) {
      throw new JournalEntryMustEditViaInvoiceError(
        entryId,
        existing.invoice.id,
        existing.invoice.invoiceNumber
      );
    }

    await tx.journalLine.deleteMany({ where: { journalEntryId: entryId } });

    const updated = await tx.journalEntry.update({
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
    return serializeJournalEntry(updated);
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

  return {
    original: serializeJournalEntry(updatedOriginal),
    reversal: serializeJournalEntry(reversal),
  };
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

async function voidDraftJournalEntryWithClient(
  tx: Prisma.TransactionClient,
  entryId: string
): Promise<JournalEntryWithLines> {
  const entry = await tx.journalEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new JournalEntryNotFoundError(entryId);
  }
  if (entry.status !== "DRAFT") {
    throw new JournalEntryNotDraftForVoidError(entryId, entry.status);
  }

  const voided = await tx.journalEntry.update({
    where: { id: entryId },
    data: { status: "VOID" },
    include: journalEntryInclude,
  });
  return serializeJournalEntry(voided);
}

/**
 * Marks a still-DRAFT JournalEntry as VOID without ever posting it — for
 * when whatever eagerly created this entry (an Invoice, a voucher) is
 * cancelled before posting. Deliberately NOT reverseJournalEntry: that
 * function only accepts an already-POSTED entry and creates a whole second
 * offsetting entry to undo real ledger effects. A DRAFT entry was never
 * posted and never touched the ledger (getTrialBalance excludes DRAFT rows
 * entirely), so there is nothing to reverse — this just flips status
 * straight to VOID, reusing the same terminal "dead, no ledger effect"
 * status reverseJournalEntry already uses for reversed entries, rather than
 * leaving the row an orphaned, seemingly-still-editable DRAFT that would
 * keep showing up on the journal entries list with a live "Post" button.
 * Only valid on a DRAFT entry; rejects otherwise (a POSTED entry must go
 * through reverseJournalEntry instead, and an already-VOID one has nothing
 * left to do). Pass `tx` to run as part of an already-open transaction;
 * otherwise a new one is opened.
 */
export async function voidDraftJournalEntry(
  entryId: string,
  tx?: Prisma.TransactionClient
): Promise<JournalEntryWithLines> {
  if (tx) {
    return voidDraftJournalEntryWithClient(tx, entryId);
  }
  return db.$transaction((transaction) => voidDraftJournalEntryWithClient(transaction, entryId));
}

async function postJournalEntryWithClient(
  tx: Prisma.TransactionClient,
  entryId: string,
  options?: { allowInvoiceLinked?: boolean }
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

  // The real enforcement point for the data-integrity gap this guards
  // against: an Invoice's eagerly-created JournalEntry must never be posted
  // through this generic path (UI hiding the "Post" button is only a
  // nice-to-have, not the fix) — doing so would flip the ledger live while
  // skipping postInvoice's own Invoice.status transition and Partner
  // balance update entirely. `entry.invoice` comes from journalEntryInclude
  // above, so this needs no extra query. postInvoice's own posting step
  // goes through postInvoiceLinkedJournalEntry instead, which explicitly
  // opts out via `allowInvoiceLinked` since it IS the sanctioned path this
  // error message points callers to.
  if (!options?.allowInvoiceLinked && entry.invoice) {
    throw new JournalEntryMustPostViaInvoiceError(entryId, entry.invoice.id, entry.invoice.invoiceNumber);
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

  // Adds the JournalLine pair for every tax application on this entry (VAT
  // Payable/Receivable, TDS/VDS Payable) right before posting — see
  // postTaxApplicationLines. Runs here, not at TaxApplication creation time,
  // so a still-DRAFT entry (which may yet be edited wholesale via
  // updateJournalEntry, which deletes and recreates all lines) never carries
  // tax lines that could be silently wiped out from under a TaxApplication.
  await postTaxApplicationLines(tx, entry);

  const posted = await tx.journalEntry.update({
    where: { id: entryId },
    data: { status: "POSTED" },
    include: journalEntryInclude,
  });
  return serializeJournalEntry(posted);
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

/**
 * Posts a JournalEntry known to be linked to an Invoice — for postInvoice's
 * own internal use ONLY. postJournalEntry (above) rejects any invoice-linked
 * entry with JournalEntryMustPostViaInvoiceError specifically to stop it
 * being posted through any path other than POST /api/invoices/[id]/post;
 * this function IS that path's internal posting step, so it deliberately
 * opts back in via `allowInvoiceLinked`. Always requires an already-open
 * transaction (never opens its own) since it only ever runs as one step
 * inside postInvoice's larger transaction — there is no standalone use case
 * for calling this outside of that flow.
 */
export async function postInvoiceLinkedJournalEntry(
  entryId: string,
  tx: Prisma.TransactionClient
): Promise<JournalEntryWithLines> {
  return postJournalEntryWithClient(tx, entryId, { allowInvoiceLinked: true });
}
