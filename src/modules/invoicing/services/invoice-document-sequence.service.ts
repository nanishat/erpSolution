import type { Prisma } from "@prisma/client";

/** "202607" for a UTC date in July 2026. */
function toYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically reserves the next sequence number for a sector + month — shared
 * across all branches — and returns the formatted invoice number, e.g.
 * "GS/202607/0001". Mirrors generateDocumentNumber in
 * document-sequence.service.ts exactly, against a parallel sequence table
 * (InvoiceDocumentSequence) — see that model's schema comment for why
 * invoices don't share DocumentSequence with vouchers.
 *
 * Must be called inside the same transaction that creates the Invoice: an
 * upsert with an atomic `increment` avoids the read-then-write race that a
 * COUNT(*)-based scheme would have under concurrent requests, but the
 * increment still needs to roll back together with the invoice insert if
 * invoice creation fails, or numbers would be burned on every failed attempt.
 */
export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  params: { sector: string; date: Date }
): Promise<string> {
  const yearMonth = toYearMonth(params.date);

  const sequence = await tx.invoiceDocumentSequence.upsert({
    where: {
      sector_yearMonth: {
        sector: params.sector,
        yearMonth,
      },
    },
    create: {
      sector: params.sector,
      yearMonth,
      lastNumber: 1,
    },
    update: {
      lastNumber: { increment: 1 },
    },
  });

  const paddedNumber = String(sequence.lastNumber).padStart(4, "0");

  return `${params.sector}/${yearMonth}/${paddedNumber}`;
}

/**
 * Same atomic upsert + increment pattern as generateInvoiceNumber above,
 * against the separate VendorBillDocumentSequence table — per the locked
 * decision, Vendor Bill numbering does NOT use sector at all, so the key is
 * just month, shared across all branches. Format: "VB/{YYYYMM}/{Seq}", e.g.
 * "VB/202608/0001" — same shape as the Customer Invoice format minus the
 * sector segment, with a "VB" literal marking it as a Vendor Bill.
 *
 * Must be called inside the same transaction that creates the Invoice, same
 * reasoning as generateInvoiceNumber (the increment must roll back together
 * with a failed Invoice insert, or numbers get burned on every failed attempt).
 */
export async function generateVendorBillNumber(
  tx: Prisma.TransactionClient,
  params: { date: Date }
): Promise<string> {
  const yearMonth = toYearMonth(params.date);

  const sequence = await tx.vendorBillDocumentSequence.upsert({
    where: {
      yearMonth,
    },
    create: {
      yearMonth,
      lastNumber: 1,
    },
    update: {
      lastNumber: { increment: 1 },
    },
  });

  const paddedNumber = String(sequence.lastNumber).padStart(4, "0");

  return `VB/${yearMonth}/${paddedNumber}`;
}
