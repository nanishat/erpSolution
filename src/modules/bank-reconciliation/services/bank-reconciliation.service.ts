import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type {
  ConfirmMatchInput,
  ImportBankStatementInput,
  UnmatchLineInput,
} from "@/modules/bank-reconciliation/validations/bank-reconciliation.schema";

export class ReconciliationAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Account ${id} not found, inactive, or not reconcilable`);
    this.name = "ReconciliationAccountNotFoundError";
  }
}

// "Sensibly" = opening + sum(lines) must equal closing, after both sides are
// rounded to 2dp the same way every other Decimal(18,2) amount in this repo
// is rounded (roundCurrency below) — no extra tolerance beyond that
// standard rounding, same precedent as recordPayment's own balance checks.
export class BankStatementBalanceMismatchError extends Error {
  constructor(opening: number, linesSum: number, closing: number) {
    super(
      `Opening balance (${opening}) + sum of lines (${linesSum}) = ${roundCurrency(opening + linesSum)}, ` +
        `which does not match the stated closing balance (${closing})`
    );
    this.name = "BankStatementBalanceMismatchError";
  }
}

export class BankStatementNotFoundError extends Error {
  constructor(id: string) {
    super(`Bank statement ${id} not found`);
    this.name = "BankStatementNotFoundError";
  }
}

export class BankStatementLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Bank statement line ${id} not found`);
    this.name = "BankStatementLineNotFoundError";
  }
}

export class JournalLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Journal line ${id} not found`);
    this.name = "JournalLineNotFoundError";
  }
}

export class LineAlreadyMatchedError extends Error {
  constructor(id: string, status: string) {
    super(`Bank statement line ${id} is ${status}, not UNMATCHED — unmatch it first before rematching`);
    this.name = "LineAlreadyMatchedError";
  }
}

export class JournalLineAlreadyMatchedError extends Error {
  constructor(id: string) {
    super(`Journal line ${id} is already matched to a different bank statement line`);
    this.name = "JournalLineAlreadyMatchedError";
  }
}

export class AccountMismatchError extends Error {
  constructor(bankStatementLineId: string, journalLineId: string) {
    super(
      `Journal line ${journalLineId} is not on the same account as bank statement line ${bankStatementLineId}`
    );
    this.name = "AccountMismatchError";
  }
}

export class LineNotMatchedError extends Error {
  constructor(id: string, status: string) {
    super(`Bank statement line ${id} is ${status}, not MATCHED — nothing to unmatch`);
    this.name = "LineNotMatchedError";
  }
}

// Route-layer defense in depth: POST .../statements/[id]/match and
// .../unmatch take the statement id from the URL and the line id from the
// body — this catches a client sending a line id that doesn't actually
// belong to the statement named in the URL, rather than silently matching
// against whatever statement the line happens to belong to.
export class BankStatementLineMismatchError extends Error {
  constructor(bankStatementLineId: string, expectedBankStatementId: string) {
    super(
      `Bank statement line ${bankStatementLineId} does not belong to bank statement ${expectedBankStatementId}`
    );
    this.name = "BankStatementLineMismatchError";
  }
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

const bankStatementInclude = {
  lines: { orderBy: { date: "asc" } },
} satisfies Prisma.BankStatementInclude;

type BankStatementRow = Prisma.BankStatementGetPayload<{ include: typeof bankStatementInclude }>;
type BankStatementLineRow = BankStatementRow["lines"][number];

export type BankStatementLineDTO = {
  id: string;
  bankStatementId: string;
  date: Date;
  description: string;
  amount: number;
  referenceNo: string | null;
  matchStatus: string;
  matchedJournalLineId: string | null;
  matchedAt: Date | null;
  matchedById: number | null;
  createdAt: Date;
};

export type BankStatementDTO = {
  id: string;
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: number;
  closingBalance: number;
  status: string;
  importedById: number | null;
  importedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lines: BankStatementLineDTO[];
};

function serializeLine(line: BankStatementLineRow): BankStatementLineDTO {
  return {
    id: line.id,
    bankStatementId: line.bankStatementId,
    date: line.date,
    description: line.description,
    amount: Number(line.amount),
    referenceNo: line.referenceNo,
    matchStatus: line.matchStatus,
    matchedJournalLineId: line.matchedJournalLineId,
    matchedAt: line.matchedAt,
    matchedById: line.matchedById,
    createdAt: line.createdAt,
  };
}

function serializeStatement(statement: BankStatementRow): BankStatementDTO {
  return {
    id: statement.id,
    accountId: statement.accountId,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    openingBalance: Number(statement.openingBalance),
    closingBalance: Number(statement.closingBalance),
    status: statement.status,
    importedById: statement.importedById,
    importedAt: statement.importedAt,
    createdAt: statement.createdAt,
    updatedAt: statement.updatedAt,
    lines: statement.lines.map(serializeLine),
  };
}

/**
 * Derives BankStatement.status from its lines' current matchStatus —
 * IMPORTED (nothing resolved yet) -> IN_PROGRESS (some MATCHED, at least one
 * still UNMATCHED) -> RECONCILED (no UNMATCHED lines left). Recomputed after
 * every confirmMatch/unmatchLine call rather than tracked independently, so
 * it can never drift from the lines' actual state.
 */
function deriveBankStatementStatus(
  lines: { matchStatus: string }[]
): "IMPORTED" | "IN_PROGRESS" | "RECONCILED" {
  if (lines.length === 0) {
    return "IMPORTED";
  }
  if (lines.every((line) => line.matchStatus !== "UNMATCHED")) {
    return "RECONCILED";
  }
  return lines.some((line) => line.matchStatus === "MATCHED") ? "IN_PROGRESS" : "IMPORTED";
}

async function syncBankStatementStatus(
  tx: Prisma.TransactionClient,
  bankStatementId: string
): Promise<void> {
  const lines = await tx.bankStatementLine.findMany({
    where: { bankStatementId },
    select: { matchStatus: true },
  });
  await tx.bankStatement.update({
    where: { id: bankStatementId },
    data: { status: deriveBankStatementStatus(lines) },
  });
}

/**
 * Imports a bank statement header + its lines in one transaction. Rejects
 * unless the target account is reconcilable (isActive + isReconcilable, same
 * guard shape as recordPayment's CashBankAccountNotFoundError check) and
 * unless opening + sum(lines) balances against the stated closing (see
 * BankStatementBalanceMismatchError for the exact tolerance rule).
 *
 * Input is a plain structured array of lines, not raw CSV — parsing an
 * uploaded file is a UI-adjacent concern deferred to the reconciliation UI
 * follow-up, same "schema/service first, UI later" precedent as
 * ProductService/Partner/TaxRate.
 */
export async function importBankStatement(input: ImportBankStatementInput): Promise<BankStatementDTO> {
  return db.$transaction(async (tx) => {
    const account = await tx.chartOfAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true, isActive: true, isReconcilable: true },
    });
    if (!account || !account.isActive || !account.isReconcilable) {
      throw new ReconciliationAccountNotFoundError(input.accountId);
    }

    const linesSum = roundCurrency(input.lines.reduce((sum, line) => sum + line.amount, 0));
    const expectedClosing = roundCurrency(roundCurrency(input.openingBalance) + linesSum);
    if (expectedClosing !== roundCurrency(input.closingBalance)) {
      throw new BankStatementBalanceMismatchError(input.openingBalance, linesSum, input.closingBalance);
    }

    const statement = await tx.bankStatement.create({
      data: {
        accountId: input.accountId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        openingBalance: input.openingBalance,
        closingBalance: input.closingBalance,
        importedById: input.importedById,
        lines: {
          create: input.lines.map((line) => ({
            date: line.date,
            description: line.description,
            amount: line.amount,
            referenceNo: line.referenceNo,
          })),
        },
      },
      include: bankStatementInclude,
    });

    return serializeStatement(statement);
  });
}

export async function getBankStatementById(id: string): Promise<BankStatementDTO | null> {
  const statement = await db.bankStatement.findUnique({
    where: { id },
    include: bankStatementInclude,
  });
  return statement ? serializeStatement(statement) : null;
}

export type MatchCandidate = {
  journalLineId: string;
  journalEntryId: string;
  documentNumber: string;
  date: Date;
  description: string;
  debit: number;
  credit: number;
};

export type LineSuggestion = {
  bankStatementLineId: string;
  candidates: MatchCandidate[];
};

/**
 * Read-only. For each UNMATCHED line on this statement, finds candidate
 * JournalLines on the same ChartOfAccount, dated within the statement's
 * period, on a POSTED JournalEntry (a DRAFT entry isn't a real ledger
 * movement yet), not already claimed by another statement line, with an
 * exact same-direction amount match — a positive (inflow) statement line
 * candidates against a debit of that magnitude, negative (outflow) against a
 * credit. Basic exact matching only, per this pass's scope — no fuzzy/near-
 * amount matching. Never writes anything; confirmMatch is the only function
 * that actually matches.
 */
export async function suggestMatches(bankStatementId: string): Promise<LineSuggestion[]> {
  const statement = await db.bankStatement.findUnique({
    where: { id: bankStatementId },
    select: {
      accountId: true,
      periodStart: true,
      periodEnd: true,
      lines: { where: { matchStatus: "UNMATCHED" } },
    },
  });
  if (!statement) {
    throw new BankStatementNotFoundError(bankStatementId);
  }

  return Promise.all(
    statement.lines.map(async (line) => {
      const amount = Math.abs(Number(line.amount));
      const isInflow = Number(line.amount) > 0;

      const candidates = await db.journalLine.findMany({
        where: {
          accountId: statement.accountId,
          matchedBankStatementLine: null,
          debit: isInflow ? amount : 0,
          credit: isInflow ? 0 : amount,
          journalEntry: {
            status: "POSTED",
            date: { gte: statement.periodStart, lte: statement.periodEnd },
          },
        },
        include: {
          journalEntry: { select: { id: true, documentNumber: true, date: true, description: true } },
        },
      });

      return {
        bankStatementLineId: line.id,
        candidates: candidates.map((journalLine) => ({
          journalLineId: journalLine.id,
          journalEntryId: journalLine.journalEntry.id,
          documentNumber: journalLine.journalEntry.documentNumber,
          date: journalLine.journalEntry.date,
          description: journalLine.memo ?? journalLine.journalEntry.description,
          debit: Number(journalLine.debit),
          credit: Number(journalLine.credit),
        })),
      };
    })
  );
}

/**
 * The actual matching action — suggestMatches only suggests, this confirms.
 * Validates both sides are unmatched and on the same account, then marks the
 * statement line MATCHED (status + matchedAt/matchedById) and points it at
 * the JournalLine via the unique matchedJournalLineId FK. Does not require
 * the amount to exactly equal a suggestMatches candidate — a human
 * confirming a match is trusted to have looked at it, same manual-first
 * trust already given to applyPartnerCredit. Never touches JournalLine's own
 * financial fields (debit/credit/memo/etc.) or JournalEntry at all.
 */
export async function confirmMatch(
  bankStatementId: string,
  input: ConfirmMatchInput
): Promise<BankStatementLineDTO> {
  return db.$transaction(async (tx) => {
    const line = await tx.bankStatementLine.findUnique({
      where: { id: input.bankStatementLineId },
      include: { bankStatement: { select: { accountId: true } } },
    });
    if (!line) {
      throw new BankStatementLineNotFoundError(input.bankStatementLineId);
    }
    if (line.bankStatementId !== bankStatementId) {
      throw new BankStatementLineMismatchError(line.id, bankStatementId);
    }
    if (line.matchStatus !== "UNMATCHED") {
      throw new LineAlreadyMatchedError(line.id, line.matchStatus);
    }

    const journalLine = await tx.journalLine.findUnique({
      where: { id: input.journalLineId },
      include: { matchedBankStatementLine: { select: { id: true } } },
    });
    if (!journalLine) {
      throw new JournalLineNotFoundError(input.journalLineId);
    }
    if (journalLine.matchedBankStatementLine) {
      throw new JournalLineAlreadyMatchedError(journalLine.id);
    }
    if (journalLine.accountId !== line.bankStatement.accountId) {
      throw new AccountMismatchError(line.id, journalLine.id);
    }

    const updated = await tx.bankStatementLine.update({
      where: { id: line.id },
      data: {
        matchStatus: "MATCHED",
        matchedJournalLineId: journalLine.id,
        matchedAt: new Date(),
        matchedById: input.matchedById,
      },
    });

    await syncBankStatementStatus(tx, line.bankStatementId);

    return serializeLine(updated);
  });
}

/**
 * Reverses a confirmed match — clears the statement line back to UNMATCHED
 * (and its matchedJournalLineId/matchedAt/matchedById), freeing the
 * JournalLine to be matched again. Only touches this reconciliation
 * metadata: JournalEntry/JournalLine's financial fields are never written
 * here, so this is not a "mutate a posted record" violation, just
 * reconciliation bookkeeping.
 */
export async function unmatchLine(
  bankStatementId: string,
  input: UnmatchLineInput
): Promise<BankStatementLineDTO> {
  return db.$transaction(async (tx) => {
    const line = await tx.bankStatementLine.findUnique({ where: { id: input.bankStatementLineId } });
    if (!line) {
      throw new BankStatementLineNotFoundError(input.bankStatementLineId);
    }
    if (line.bankStatementId !== bankStatementId) {
      throw new BankStatementLineMismatchError(line.id, bankStatementId);
    }
    if (line.matchStatus !== "MATCHED") {
      throw new LineNotMatchedError(line.id, line.matchStatus);
    }

    const updated = await tx.bankStatementLine.update({
      where: { id: line.id },
      data: {
        matchStatus: "UNMATCHED",
        matchedJournalLineId: null,
        matchedAt: null,
        matchedById: null,
      },
    });

    await syncBankStatementStatus(tx, line.bankStatementId);

    return serializeLine(updated);
  });
}

export type ReconciliationSummary = {
  bankStatementId: string;
  status: string;
  openingBalance: number;
  closingBalance: number;
  matchedLinesTotal: number;
  reconciledBalance: number;
  difference: number;
  totalLines: number;
  matchedCount: number;
  unmatchedCount: number;
  ignoredCount: number;
  isReconciled: boolean;
};

/**
 * The basic "are we reconciled yet" check: openingBalance + sum(MATCHED
 * lines' amounts) = reconciledBalance, compared against the bank-stated
 * closingBalance (difference is 0 once every line is matched or ignored,
 * since import already guarantees opening + sum(ALL lines) = closing).
 * isReconciled mirrors BankStatement.status === RECONCILED (no UNMATCHED
 * lines left) — exposed as its own boolean here so a caller doesn't need to
 * know the status enum's exact spelling.
 */
export async function getReconciliationSummary(bankStatementId: string): Promise<ReconciliationSummary> {
  const statement = await db.bankStatement.findUnique({
    where: { id: bankStatementId },
    select: {
      status: true,
      openingBalance: true,
      closingBalance: true,
      lines: { select: { amount: true, matchStatus: true } },
    },
  });
  if (!statement) {
    throw new BankStatementNotFoundError(bankStatementId);
  }

  const matchedLines = statement.lines.filter((line) => line.matchStatus === "MATCHED");
  const unmatchedCount = statement.lines.filter((line) => line.matchStatus === "UNMATCHED").length;
  const ignoredCount = statement.lines.filter((line) => line.matchStatus === "IGNORED").length;

  const openingBalance = Number(statement.openingBalance);
  const closingBalance = Number(statement.closingBalance);
  const matchedLinesTotal = roundCurrency(
    matchedLines.reduce((sum, line) => sum + Number(line.amount), 0)
  );
  const reconciledBalance = roundCurrency(openingBalance + matchedLinesTotal);

  return {
    bankStatementId,
    status: statement.status,
    openingBalance,
    closingBalance,
    matchedLinesTotal,
    reconciledBalance,
    difference: roundCurrency(closingBalance - reconciledBalance),
    totalLines: statement.lines.length,
    matchedCount: matchedLines.length,
    unmatchedCount,
    ignoredCount,
    isReconciled: statement.lines.length > 0 && unmatchedCount === 0,
  };
}
