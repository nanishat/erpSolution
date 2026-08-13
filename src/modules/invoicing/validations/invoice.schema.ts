import { InvoiceDirection } from "@prisma/client";
import { z } from "zod";

// Free text, same precedent as TaxRate.category — the full sector list isn't
// known yet (only "GS"/"CC" mentioned as examples so far), so this is
// intentionally not an enum. Loosely validated (trimmed, length-capped,
// uppercased for consistency in generated invoice numbers) rather than
// format-restricted. Only meaningful for direction: CUSTOMER — see below.
const sectorField = z
  .string()
  .trim()
  .min(1, "Sector is required")
  .max(10, "Sector must be 10 characters or fewer")
  .transform((value) => value.toUpperCase());

const invoiceLineSchema = z.object({
  // Optional at the type level, but createInvoice rejects any line that
  // resolves to no productServiceId — see InvoiceLineMissingIncomeAccountError
  // (direction: CUSTOMER) / InvoiceLineMissingExpenseAccountError (direction: VENDOR).
  productServiceId: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
});

const baseInvoiceFields = {
  partnerId: z.string().min(1, "Partner is required"),
  branchId: z.string().min(1, "Branch is required"),
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, "An invoice needs at least one line item"),
  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
};

// direction: CUSTOMER — Customer Invoice, numbered Sector/Branch/YYYYMM/Seq,
// so sector is required here.
const customerInvoiceSchema = z
  .object({
    ...baseInvoiceFields,
    direction: z.literal(InvoiceDirection.CUSTOMER),
    sector: sectorField,
  })
  .strict();

// direction: VENDOR — Vendor Bill. Per the locked decision, Vendor Bill
// numbering does NOT use sector at all (separate VB/Branch/YYYYMM/Seq
// scheme — see generateVendorBillNumber), so sector is deliberately not a
// field here at all rather than an optional/ignored one — createInvoice
// stores Invoice.sector as null for this direction.
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

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
