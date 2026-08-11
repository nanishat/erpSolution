import type { Prisma } from "@prisma/client";

/** "202607" for a UTC date in July 2026. */
function toYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically reserves the next sequence number for a sector + branch + month,
 * and returns the formatted invoice number, e.g. "GS/HO/202607/0001". Mirrors
 * generateDocumentNumber in document-sequence.service.ts exactly, against a
 * parallel sequence table (InvoiceDocumentSequence) — see that model's schema
 * comment for why invoices don't share DocumentSequence with vouchers.
 *
 * Must be called inside the same transaction that creates the Invoice: an
 * upsert with an atomic `increment` avoids the read-then-write race that a
 * COUNT(*)-based scheme would have under concurrent requests, but the
 * increment still needs to roll back together with the invoice insert if
 * invoice creation fails, or numbers would be burned on every failed attempt.
 */
export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  params: { sector: string; branchId: string; branchCode: string; date: Date }
): Promise<string> {
  const yearMonth = toYearMonth(params.date);

  const sequence = await tx.invoiceDocumentSequence.upsert({
    where: {
      sector_branchId_yearMonth: {
        sector: params.sector,
        branchId: params.branchId,
        yearMonth,
      },
    },
    create: {
      sector: params.sector,
      branchId: params.branchId,
      yearMonth,
      lastNumber: 1,
    },
    update: {
      lastNumber: { increment: 1 },
    },
  });

  const paddedNumber = String(sequence.lastNumber).padStart(4, "0");

  return `${params.sector}/${params.branchCode}/${yearMonth}/${paddedNumber}`;
}
