import type { AccountSubType, Prisma, TaxDirection, TaxType } from "@prisma/client";

export const VAT_PAYABLE_CODE = "2110";
export const VAT_RECEIVABLE_CODE = "1210";
export const TDS_PAYABLE_CODE = "2120";
export const VDS_PAYABLE_CODE = "2130";

export class TaxAccountNotConfiguredError extends Error {
  constructor(code: string) {
    super(
      `Chart of account ${code} is required to post tax but does not exist — run prisma/seed-tax-accounts.ts`
    );
    this.name = "TaxAccountNotConfiguredError";
  }
}

export class TaxSettlementLineNotFoundError extends Error {
  constructor(taxApplicationId: string, journalEntryId: string) {
    super(
      `Journal entry ${journalEntryId} has no cash/bank/receivable/payable line to post tax application ${taxApplicationId} against`
    );
    this.name = "TaxSettlementLineNotFoundError";
  }
}

export class TaxSettlementLineAmbiguousError extends Error {
  constructor(taxApplicationId: string, journalEntryId: string) {
    super(
      `Journal entry ${journalEntryId} has more than one candidate settlement line for tax application ${taxApplicationId} — cannot determine which one to post tax against`
    );
    this.name = "TaxSettlementLineAmbiguousError";
  }
}

export class TaxAmountExceedsSettlementError extends Error {
  constructor(taxApplicationId: string, taxAmount: number, settlementAmount: number) {
    super(
      `Tax application ${taxApplicationId}'s tax amount (${taxAmount}) exceeds its settlement line's amount (${settlementAmount})`
    );
    this.name = "TaxAmountExceedsSettlementError";
  }
}

type LineSide = "debit" | "credit";

// Accepts either the raw Prisma Decimal (used internally, before the
// journal-entry.service.ts layer converts to number for UI consumption) or
// an already-serialized number — every access below goes through Number()
// anyway, so this function doesn't care which one it gets.
type JournalEntryForTaxPosting = {
  id: string;
  lines: {
    accountId: string;
    branchId: string;
    debit: Prisma.Decimal | number;
    credit: Prisma.Decimal | number;
    account: { subType: AccountSubType | null };
  }[];
};

type TaxPostingRule = {
  // Which ChartOfAccount the tax amount posts to.
  accountCode: string;
  // Which side of an existing line identifies it as "the settlement line"
  // (the cash/bank/AR/AP leg of the transaction this tax rides on).
  settlementSide: LineSide;
  settlementSubTypes: AccountSubType[];
  // Side of the NEW line added to the settlement account. For VAT this
  // extends the settlement amount (tax adds to what changes hands); for
  // TDS/VDS it's the opposite side of settlementSide, offsetting it (net
  // cash paid out is reduced by the withheld amount).
  settlementNewSide: LineSide;
  // Side of the NEW line added to the tax account itself.
  taxAccountSide: LineSide;
};

// VAT: extends the settlement line (buyer pays/collects the gross,
// tax-inclusive amount) — Output VAT is a liability owed to the authority,
// Input VAT is a reclaimable asset. TDS/VDS: withheld from a vendor payment,
// so it offsets (reduces the net effect of) the existing cash/bank credit
// rather than adding to it — the vendor is paid net, the withheld part is
// redirected to a payable.
const TAX_POSTING_RULES: Record<string, TaxPostingRule> = {
  "VAT:OUTPUT": {
    accountCode: VAT_PAYABLE_CODE,
    settlementSide: "debit",
    settlementSubTypes: ["CASH", "BANK", "RECEIVABLE"],
    settlementNewSide: "debit",
    taxAccountSide: "credit",
  },
  "VAT:INPUT": {
    accountCode: VAT_RECEIVABLE_CODE,
    settlementSide: "credit",
    settlementSubTypes: ["CASH", "BANK", "PAYABLE"],
    settlementNewSide: "credit",
    taxAccountSide: "debit",
  },
  "TDS:null": {
    accountCode: TDS_PAYABLE_CODE,
    settlementSide: "credit",
    settlementSubTypes: ["CASH", "BANK"],
    settlementNewSide: "debit",
    taxAccountSide: "credit",
  },
  "VDS:null": {
    accountCode: VDS_PAYABLE_CODE,
    settlementSide: "credit",
    settlementSubTypes: ["CASH", "BANK"],
    settlementNewSide: "debit",
    taxAccountSide: "credit",
  },
};

function getTaxPostingRule(taxType: TaxType, direction: TaxDirection | null): TaxPostingRule {
  const rule = TAX_POSTING_RULES[`${taxType}:${direction ?? "null"}`];
  if (!rule) {
    throw new Error(`No tax posting rule configured for ${taxType}:${direction}`);
  }
  return rule;
}

/**
 * Adds the JournalLine pair for every APPROVED TaxApplication on this entry,
 * called from postJournalEntryWithClient right before it flips the entry to
 * POSTED (posting is already gated on no PENDING_REVIEW tax applications
 * remaining — see PendingTaxApprovalError). Each tax application contributes
 * exactly two new lines: one on its resolved settlement line's account (the
 * existing cash/bank/AR/AP leg of the transaction) and one on the tax
 * account (VAT Payable/Receivable, TDS/VDS Payable) — always an
 * equal-and-opposite pair, so the entry's overall balance is preserved
 * without needing to touch its original lines.
 *
 * Settlement line resolution is by account subType + side on the entry's
 * ORIGINAL lines (not lines added by a prior tax application in this same
 * call) — requires exactly one match per tax application, or throws.
 */
export async function postApprovedTaxApplicationLines(
  tx: Prisma.TransactionClient,
  entry: JournalEntryForTaxPosting
): Promise<void> {
  const taxApplications = await tx.taxApplication.findMany({
    where: { journalEntryId: entry.id, status: "APPROVED" },
  });
  if (taxApplications.length === 0) {
    return;
  }

  const accountCodes = Array.from(
    new Set(
      taxApplications.map((t) => getTaxPostingRule(t.taxType, t.direction).accountCode)
    )
  );
  const taxAccounts = await tx.chartOfAccount.findMany({ where: { code: { in: accountCodes } } });
  const taxAccountByCode = new Map(taxAccounts.map((a) => [a.code, a]));

  const originalLines = entry.lines;

  for (const taxApplication of taxApplications) {
    const rule = getTaxPostingRule(taxApplication.taxType, taxApplication.direction);

    const taxAccount = taxAccountByCode.get(rule.accountCode);
    if (!taxAccount) {
      throw new TaxAccountNotConfiguredError(rule.accountCode);
    }

    const matches = originalLines.filter(
      (line) =>
        line.account.subType != null &&
        rule.settlementSubTypes.includes(line.account.subType) &&
        Number(line[rule.settlementSide]) > 0
    );
    if (matches.length === 0) {
      throw new TaxSettlementLineNotFoundError(taxApplication.id, entry.id);
    }
    if (matches.length > 1) {
      throw new TaxSettlementLineAmbiguousError(taxApplication.id, entry.id);
    }
    const settlementLine = matches[0];

    const taxAmount = Number(taxApplication.taxAmount);
    const settlementAmount = Number(settlementLine[rule.settlementSide]);
    if (taxAmount > settlementAmount) {
      throw new TaxAmountExceedsSettlementError(taxApplication.id, taxAmount, settlementAmount);
    }

    await tx.journalLine.createMany({
      data: [
        {
          journalEntryId: entry.id,
          accountId: settlementLine.accountId,
          branchId: settlementLine.branchId,
          debit: rule.settlementNewSide === "debit" ? taxAmount : 0,
          credit: rule.settlementNewSide === "credit" ? taxAmount : 0,
          memo: `${taxApplication.taxType} on tax application ${taxApplication.id}`,
        },
        {
          journalEntryId: entry.id,
          accountId: taxAccount.id,
          branchId: settlementLine.branchId,
          debit: rule.taxAccountSide === "debit" ? taxAmount : 0,
          credit: rule.taxAccountSide === "credit" ? taxAmount : 0,
          memo: `${taxApplication.taxType} on tax application ${taxApplication.id}`,
        },
      ],
    });
  }
}
