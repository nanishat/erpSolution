import { InvoiceDirection, InvoiceStatus } from "@prisma/client";
import { z } from "zod";
import { CREDIT_VOUCHER_SECTOR_CODES } from "@/modules/accounting/constants/sector";

// Only meaningful for direction: CUSTOMER — see below.
const sectorField = z
  .string()
  .trim()
  .min(1, "Select a sector.")
  .max(10, "Select a sector.")
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(CREDIT_VOUCHER_SECTOR_CODES, { error: "Select a sector." }));

const invoiceLineSchema = z.object({
  // Optional at the type level, but createInvoice rejects any line that
  // resolves to no productServiceId — see InvoiceLineMissingIncomeAccountError
  // (direction: CUSTOMER) / InvoiceLineMissingExpenseAccountError (direction: VENDOR).
  productServiceId: z.string().optional(),
  description: z.string({ error: "Enter a description." }).min(1, "Enter a description."),
  quantity: z.coerce.number({ error: "Enter a quantity." }).positive("Quantity must be greater than 0."),
  unitPrice: z.coerce.number({ error: "Enter a unit price." }).min(0, "Unit price must be 0 or more."),
});

const baseInvoiceFields = {
  partnerId: z.string({ error: "Select a customer or vendor." }).min(1, "Select a customer or vendor."),
  branchId: z.string({ error: "Select a branch." }).min(1, "Select a branch."),
  date: z.coerce.date({ error: "Enter a valid date." }),
  dueDate: z.coerce.date({ error: "Enter a valid due date." }).optional(),
  notes: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line item."),
  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
};

// direction: CUSTOMER — Customer Invoice, numbered Sector/YYYYMM/Seq, so
// sector is required here.
const customerInvoiceSchema = z
  .object({
    ...baseInvoiceFields,
    direction: z.literal(InvoiceDirection.CUSTOMER),
    sector: sectorField,
  })
  .strict();

// direction: VENDOR — Vendor Bill. Per the locked decision, Vendor Bill
// numbering does NOT use sector at all (separate VB/YYYYMM/Seq scheme —
// see generateVendorBillNumber), so sector is deliberately not a field
// here at all rather than an optional/ignored one — createInvoice stores
// Invoice.sector as null for this direction.
const vendorBillSchema = z
  .object({
    ...baseInvoiceFields,
    direction: z.literal(InvoiceDirection.VENDOR),
  })
  .strict();

export const createInvoiceSchema = z.discriminatedUnion("direction", [
  customerInvoiceSchema,
  vendorBillSchema,
]);

// Mirrors reverseJournalEntrySchema (journal-entry.schema.ts) — same
// optional, non-empty-when-present `reason` shape.
export const reverseInvoiceSchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

// Powers API invoice listing for either direction. The paginated accounting
// pages apply the same filters directly in their service queries.
export const listInvoicesQuerySchema = z.object({
  direction: z.nativeEnum(InvoiceDirection).optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  partnerId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type ReverseInvoiceInput = z.infer<typeof reverseInvoiceSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
