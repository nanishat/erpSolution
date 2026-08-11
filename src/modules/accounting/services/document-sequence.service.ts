import { Prisma, VoucherType } from "@prisma/client";

const VOUCHER_TYPE_SHORT_CODE: Record<VoucherType, string> = {
  DEBIT_VOUCHER: "DV",
  CREDIT_VOUCHER: "CV",
  JOURNAL_VOUCHER: "JV",
  CASH_VOUCHER: "CSV",
  INVOICE_VOUCHER: "IV",
};

/** "202607" for a UTC date in July 2026. */
function toYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically reserves the next sequence number for a voucher type + branch +
 * month, and returns the formatted document number, e.g. "JV/HO/202607/0001".
 *
 * Must be called inside the same transaction that creates the JournalEntry:
 * an upsert with an atomic `increment` avoids the read-then-write race that a
 * COUNT(*)-based scheme would have under concurrent requests, but the
 * increment still needs to roll back together with the entry insert if entry
 * creation fails, or numbers would be burned on every failed attempt.
 */
export async function generateDocumentNumber(
  tx: Prisma.TransactionClient,
  params: { voucherType: VoucherType; branchId: string; branchCode: string; date: Date }
): Promise<string> {
  const yearMonth = toYearMonth(params.date);

  const sequence = await tx.documentSequence.upsert({
    where: {
      voucherType_branchId_yearMonth: {
        voucherType: params.voucherType,
        branchId: params.branchId,
        yearMonth,
      },
    },
    create: {
      voucherType: params.voucherType,
      branchId: params.branchId,
      yearMonth,
      lastNumber: 1,
    },
    update: {
      lastNumber: { increment: 1 },
    },
  });

  const shortCode = VOUCHER_TYPE_SHORT_CODE[params.voucherType];
  const paddedNumber = String(sequence.lastNumber).padStart(4, "0");

  return `${shortCode}/${params.branchCode}/${yearMonth}/${paddedNumber}`;
}
