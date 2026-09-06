// Phase 3 (Invoicing & Billing) manual test — the Invoice draft creation
// service (invoice.service.ts) and its invoice-number sequence
// (invoice-document-sequence.service.ts).
//
// DEVIATION from the other scripts' convention: Invoice creation has no
// API/UI layer yet (explicitly out of scope for this prompt), so
// createInvoice is called directly against the dev DB rather than through an
// HTTP endpoint — inputs are still run through createInvoiceSchema first, the
// same way a future API route would, so the Zod layer gets exercised too.
// Branch/account lookups and the CUSTOMER/VENDOR partner fixtures go through
// the real API as usual. ProductService also has no API/UI yet (Phase 3
// catalog schema, intentionally schema-only so far), so its two fixtures are
// created directly via Prisma — same convention as tax-application's TaxRate
// fixture (see phase2-tax-application-manual-test.ts).
//
// Same no-cleanup convention as the other scripts: doesn't clean up after
// itself, safe to re-run, uses a `TEST ...`/timestamp-derived sector so
// re-runs don't collide.
//
// Not covered: a month boundary (would require manipulating the invoice date
// across a real month rollover). The counter no longer keys on branch at all
// (shared across all branches per sector+month), so a separate cross-branch
// case isn't needed. Sector boundaries and same-sector increments are
// covered below.
import "dotenv/config";

import { db } from "../src/lib/db";
import {
  createInvoice,
  InvoiceLineMissingIncomeAccountError,
  PartnerNotCustomerError,
} from "../src/modules/invoicing/services/invoice.service";
import { createInvoiceSchema } from "../src/modules/invoicing/validations/invoice.schema";

const BASE_URL = process.env.DEV_SERVER_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`PASS - ${label}: ${detail}`);
    pass++;
  } else {
    console.log(`FAIL - ${label}: ${detail}`);
    fail++;
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

/** Parses raw input through createInvoiceSchema before calling the service — mirrors what a future API route will do. */
function createInvoiceViaSchema(raw: unknown) {
  return createInvoice(createInvoiceSchema.parse(raw));
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixtures ---
  const { json: branchesJson } = await api("/api/branches");
  const branch = branchesJson.data[0] as { id: string; code: string };

  const { json: accountsJson } = await api("/api/accounts");
  const accounts: { id: string; code: string }[] = accountsJson.data;
  const salesRevenue = accounts.find((a) => a.code === "4010")!;

  const { res: secondIncomeRes, json: secondIncomeJson } = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-INC-${stamp}`,
      name: `TEST Second Income Account ${stamp}`,
      type: "REVENUE",
      subType: "OTHER_REVENUE",
    }),
  });
  if (!secondIncomeRes.ok) {
    throw new Error(`Failed to create second income account: ${JSON.stringify(secondIncomeJson)}`);
  }
  const secondIncomeAccount = secondIncomeJson.data as { id: string };

  const productServiceA = await db.productService.create({
    data: {
      code: `TEST-PS-A-${stamp}`,
      name: `TEST Guard Service A ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });
  const productServiceB = await db.productService.create({
    data: {
      code: `TEST-PS-B-${stamp}`,
      name: `TEST Product B ${stamp}`,
      type: "PRODUCT",
      unitPrice: 0,
      incomeAccountId: secondIncomeAccount.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST Invoice Customer ${stamp}`,
      tin: `TIN-INV-${stamp}`,
      bin: `BIN-INV-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Invoice Vendor ${stamp}`,
      tin: `TIN-INVV-${stamp}`,
      bin: `BIN-INVV-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string };

  // Lowercase on purpose — also exercises createInvoiceSchema's
  // uppercase-normalization of `sector`.
  const sector = `ts${stamp.toString().slice(-6)}`;
  const sectorUpper = sector.toUpperCase();

  // --- 1. Create an invoice with 2 lines against different ProductServices ---
  console.log("--- Create invoice: 2 lines, 2 distinct income accounts ---");
  const invoice = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      {
        productServiceId: productServiceA.id,
        description: "Guard deployment - August",
        quantity: 2,
        unitPrice: 15000,
      },
      {
        productServiceId: productServiceB.id,
        description: "Equipment rental",
        quantity: 3,
        unitPrice: 500,
      },
    ],
  });

  check(
    "Invoice number format is SECTOR/YYYYMM/SEQ, sector uppercased",
    new RegExp(`^${sectorUpper}/\\d{6}/0001$`).test(invoice.invoiceNumber),
    `invoiceNumber=${invoice.invoiceNumber}`
  );
  check("Invoice starts DRAFT", invoice.status === "DRAFT", `status=${invoice.status}`);
  check(
    "Line A total = 2 * 15000 = 30000",
    Number(invoice.lines[0].lineTotal) === 30000,
    `lineTotal=${invoice.lines[0].lineTotal}`
  );
  check(
    "Line B total = 3 * 500 = 1500",
    Number(invoice.lines[1].lineTotal) === 1500,
    `lineTotal=${invoice.lines[1].lineTotal}`
  );
  check(
    "subtotal = 30000 + 1500 = 31500",
    Number(invoice.subtotal) === 31500,
    `subtotal=${invoice.subtotal}`
  );
  check(
    "taxTotal is 0 at creation (tax attaches later via TaxApplication)",
    Number(invoice.taxTotal) === 0,
    `taxTotal=${invoice.taxTotal}`
  );
  check(
    "grandTotal = subtotal (31500) since taxTotal is 0",
    Number(invoice.grandTotal) === 31500,
    `grandTotal=${invoice.grandTotal}`
  );

  const journalEntry = await db.journalEntry.findUniqueOrThrow({
    where: { id: invoice.journalEntryId },
    include: { lines: true },
  });
  check(
    "JournalEntry is DRAFT with voucherType INVOICE_VOUCHER",
    journalEntry.status === "DRAFT" && journalEntry.voucherType === "INVOICE_VOUCHER",
    `status=${journalEntry.status} voucherType=${journalEntry.voucherType}`
  );
  check(
    "JournalEntry has exactly 3 lines: 1 AR debit + 2 grouped income credits",
    journalEntry.lines.length === 3,
    `lines=${journalEntry.lines.length}`
  );
  const arLine = journalEntry.lines.find((l) => Number(l.debit) > 0);
  check("AR debit line = 31500 (full subtotal)", Number(arLine?.debit) === 31500, `debit=${arLine?.debit}`);
  const creditLineForA = journalEntry.lines.find((l) => l.accountId === salesRevenue.id);
  const creditLineForB = journalEntry.lines.find((l) => l.accountId === secondIncomeAccount.id);
  check(
    "Credit line for income account A = 30000",
    Number(creditLineForA?.credit) === 30000,
    `credit=${creditLineForA?.credit}`
  );
  check(
    "Credit line for income account B = 1500",
    Number(creditLineForB?.credit) === 1500,
    `credit=${creditLineForB?.credit}`
  );
  const totalDebit = journalEntry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = journalEntry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
  check(
    "JournalEntry balances: total debit = total credit",
    totalDebit === totalCredit,
    `totalDebit=${totalDebit} totalCredit=${totalCredit}`
  );

  // --- 2. Second invoice, same sector/month -> sequence increments ---
  console.log("\n--- Invoice number increments within the same sector/month ---");
  const invoice2 = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      {
        productServiceId: productServiceA.id,
        description: "Guard deployment - September",
        quantity: 1,
        unitPrice: 10000,
      },
    ],
  });
  check(
    "Second invoice in the same sector/month gets seq 0002",
    invoice2.invoiceNumber === invoice.invoiceNumber.replace(/0001$/, "0002"),
    `invoiceNumber=${invoice2.invoiceNumber}`
  );

  // --- 3. Different sector, same month -> resets to 0001 ---
  console.log("\n--- A different sector resets the sequence to 0001 ---");
  const otherSectorUpper = `${sectorUpper}X`;
  const invoice3 = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector: otherSectorUpper,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      { productServiceId: productServiceB.id, description: "Different sector line", quantity: 1, unitPrice: 100 },
    ],
  });
  check(
    "A different sector starts its own sequence at 0001",
    new RegExp(`^${otherSectorUpper}/\\d{6}/0001$`).test(invoice3.invoiceNumber),
    `invoiceNumber=${invoice3.invoiceNumber}`
  );

  // --- 4. Rejected: partner is a VENDOR, not a CUSTOMER ---
  console.log("\n--- Creating an invoice against a VENDOR partner is rejected ---");
  let vendorRejected = false;
  let vendorRejectMessage = "";
  try {
    await createInvoiceViaSchema({
      partnerId: vendor.id,
      direction: "CUSTOMER",
      sector,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        { productServiceId: productServiceA.id, description: "Should be rejected", quantity: 1, unitPrice: 100 },
      ],
    });
  } catch (error) {
    vendorRejected = error instanceof PartnerNotCustomerError;
    vendorRejectMessage = error instanceof Error ? error.message : String(error);
  }
  check(
    "Invoice creation against a VENDOR partner throws PartnerNotCustomerError",
    vendorRejected,
    `message=${vendorRejectMessage}`
  );

  // --- 5. Rejected: a line has no productServiceId ---
  console.log("\n--- A line without productServiceId is rejected ---");
  let freeTextRejected = false;
  let freeTextRejectMessage = "";
  try {
    await createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        { productServiceId: productServiceA.id, description: "Fine line", quantity: 1, unitPrice: 100 },
        { description: "Free-text line, no catalog reference", quantity: 1, unitPrice: 200 },
      ],
    });
  } catch (error) {
    freeTextRejected = error instanceof InvoiceLineMissingIncomeAccountError;
    freeTextRejectMessage = error instanceof Error ? error.message : String(error);
  }
  check(
    "A line with no productServiceId throws InvoiceLineMissingIncomeAccountError",
    freeTextRejected,
    `message=${freeTextRejectMessage}`
  );

  // Both rejected attempts ran inside createInvoice's own transaction, which
  // should have rolled back completely — confirm no stray rows landed.
  const vendorInvoiceCount = await db.invoice.count({ where: { partnerId: vendor.id } });
  check(
    "Rejected VENDOR attempt created no Invoice row",
    vendorInvoiceCount === 0,
    `count=${vendorInvoiceCount}`
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
