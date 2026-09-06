// Phase 3 (Invoicing & Billing) manual test — Vendor Bills, i.e.
// Invoice.direction: VENDOR, added alongside the existing Customer Invoice
// path (direction: CUSTOMER, covered by phase3-invoice-manual-test.ts /
// phase3-invoice-posting-manual-test.ts). Exercises createInvoice/postInvoice
// directly via the service for creation (same deviation as the other Phase 3
// invoice scripts — no createInvoice API/UI layer yet), and the real
// POST /api/invoices/[id]/post endpoint for posting.
//
// Focus of this script specifically:
// - A Vendor Bill posts correctly: Accounts Payable credited, the
//   ProductService's expenseAccountId debited, balanced, VB/YYYYMM/Seq
//   document number, Partner.payableBalance increases by the right amount.
// - Strict balance-field isolation (the locked decision this prompt is built
//   around): Vendor Bill posting NEVER touches Partner.outstandingBalance,
//   and Customer Invoice posting NEVER touches Partner.payableBalance. Both
//   checks seed the "wrong" balance field with a nonzero noise value first
//   (via direct Prisma write) and assert it's bit-for-bit unchanged after
//   posting — not just "still zero", which would be true even if the
//   isolation were broken by coincidence.
// - direction: VENDOR against a CUSTOMER-type partner is rejected
//   (PartnerNotVendorError), and a VENDOR-direction line whose ProductService
//   has no expenseAccountId is rejected (InvoiceLineMissingExpenseAccountError).
//
// CUSTOMER-direction regression coverage lives in the two existing Phase 3
// invoice scripts (now updated to pass the newly-required `direction`
// field) — this script does not duplicate that, it only adds the VENDOR
// side plus the cross-direction isolation proof.
import "dotenv/config";

import { db } from "../src/lib/db";
import {
  createInvoice,
  InvoiceLineMissingExpenseAccountError,
  PartnerNotVendorError,
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

function createInvoiceViaSchema(raw: unknown) {
  return createInvoice(createInvoiceSchema.parse(raw));
}

async function postInvoiceViaApi(id: string) {
  return api(`/api/invoices/${id}/post`, { method: "POST" });
}

async function getPartnerBalances(
  id: string
): Promise<{ outstandingBalance: number; payableBalance: number }> {
  const { res, json } = await api(`/api/partners/${id}`);
  if (!res.ok) {
    throw new Error(`getPartnerBalances failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return {
    outstandingBalance: Number(json.data.outstandingBalance),
    payableBalance: Number(json.data.payableBalance),
  };
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
  const operatingExpense = accounts.find((a) => a.code === "5010")!;
  const accountsPayable = accounts.find((a) => a.code === "2100")!;
  check(
    "Accounts Payable (2100) exists (run prisma/seed-coa.ts first if this fails)",
    Boolean(accountsPayable),
    `accountsPayable=${accountsPayable?.id}`
  );

  // ProductService with a real expenseAccountId — usable on a VENDOR line.
  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-VB-PS-${stamp}`,
      name: `TEST Vendor Bill Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id, // required by schema, unused for VENDOR direction
      expenseAccountId: operatingExpense.id,
    },
  });
  // ProductService with NO expenseAccountId — used to prove the rejection.
  const noExpenseProductService = await db.productService.create({
    data: {
      code: `TEST-VB-NOEXP-${stamp}`,
      name: `TEST No-Expense-Account Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
      // expenseAccountId intentionally omitted (null)
    },
  });
  // ProductService for the reverse-isolation Customer Invoice fixture.
  const customerProductService = await db.productService.create({
    data: {
      code: `TEST-VB-CUST-PS-${stamp}`,
      name: `TEST Customer-side Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Vendor Bill Vendor ${stamp}`,
      tin: `TIN-VB-${stamp}`,
      bin: `BIN-VB-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string; outstandingBalance: string; payableBalance: string };
  check(
    "New VENDOR partner starts with both balances 0",
    Number(vendor.outstandingBalance) === 0 && Number(vendor.payableBalance) === 0,
    `outstandingBalance=${vendor.outstandingBalance} payableBalance=${vendor.payableBalance}`
  );

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST Vendor Bill Customer ${stamp}`,
      tin: `TIN-VBC-${stamp}`,
      bin: `BIN-VBC-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  // ============================================================
  // 1. Create and post a VENDOR-direction Vendor Bill
  // ============================================================
  console.log("\n--- Create and post a Vendor Bill (direction: VENDOR) ---");

  const bill = await createInvoiceViaSchema({
    partnerId: vendor.id,
    direction: "VENDOR",
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      {
        productServiceId: vendorProductService.id,
        description: "Contractor services",
        quantity: 2,
        unitPrice: 7500,
      },
    ],
  });

  check("Vendor Bill subtotal = 15000", Number(bill.subtotal) === 15000, `subtotal=${bill.subtotal}`);
  check("Vendor Bill grandTotal = subtotal (15000), no tax", Number(bill.grandTotal) === 15000, `grandTotal=${bill.grandTotal}`);
  check("Vendor Bill sector is null (VENDOR direction doesn't use sector)", bill.sector === null, `sector=${bill.sector}`);
  check(
    "Vendor Bill number format is VB/YYYYMM/SEQ",
    new RegExp(`^VB/\\d{6}/\\d{4}$`).test(bill.invoiceNumber),
    `invoiceNumber=${bill.invoiceNumber}`
  );

  const billJournalEntryBeforePost = await db.journalEntry.findUniqueOrThrow({
    where: { id: bill.journalEntryId },
    include: { lines: true },
  });
  check(
    "Vendor Bill JournalEntry has exactly 2 lines: 1 AP credit + 1 expense debit",
    billJournalEntryBeforePost.lines.length === 2,
    `lines=${billJournalEntryBeforePost.lines.length}`
  );
  const apLineBefore = billJournalEntryBeforePost.lines.find((l) => l.accountId === accountsPayable.id);
  const expenseLineBefore = billJournalEntryBeforePost.lines.find((l) => l.accountId === operatingExpense.id);
  check("AP credit line = 15000 (full subtotal)", Number(apLineBefore?.credit) === 15000, `credit=${apLineBefore?.credit}`);
  check("Expense debit line = 15000 (full subtotal)", Number(expenseLineBefore?.debit) === 15000, `debit=${expenseLineBefore?.debit}`);
  const billTotalDebit = billJournalEntryBeforePost.lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const billTotalCredit = billJournalEntryBeforePost.lines.reduce((sum, l) => sum + Number(l.credit), 0);
  check(
    "Vendor Bill JournalEntry balances: total debit = total credit",
    billTotalDebit === billTotalCredit,
    `totalDebit=${billTotalDebit} totalCredit=${billTotalCredit}`
  );

  // Seed the vendor's outstandingBalance with a nonzero NOISE value before
  // posting — proves isolation for real, not just "coincidentally still 0".
  const OUTSTANDING_NOISE = 555.25;
  await db.partner.update({
    where: { id: vendor.id },
    data: { outstandingBalance: OUTSTANDING_NOISE },
  });
  const vendorBalancesBeforePost = await getPartnerBalances(vendor.id);
  check(
    "Vendor's outstandingBalance noise value took effect before posting",
    vendorBalancesBeforePost.outstandingBalance === OUTSTANDING_NOISE,
    `outstandingBalance=${vendorBalancesBeforePost.outstandingBalance}`
  );

  const { res: postBillRes, json: postBillJson } = await postInvoiceViaApi(bill.id);
  check(
    "Posting the Vendor Bill succeeds",
    postBillRes.ok,
    `status=${postBillRes.status} body=${JSON.stringify(postBillJson)}`
  );
  check("Response Vendor Bill status is POSTED", postBillJson.data?.status === "POSTED", `status=${postBillJson.data?.status}`);

  const billJournalEntryAfterPost = await db.journalEntry.findUniqueOrThrow({ where: { id: bill.journalEntryId } });
  check(
    "Vendor Bill's linked JournalEntry is now POSTED",
    billJournalEntryAfterPost.status === "POSTED",
    `status=${billJournalEntryAfterPost.status}`
  );

  const vendorBalancesAfterPost = await getPartnerBalances(vendor.id);
  check(
    "Vendor's payableBalance increased by exactly 15000 (the bill's grandTotal)",
    vendorBalancesAfterPost.payableBalance - vendorBalancesBeforePost.payableBalance === 15000,
    `before=${vendorBalancesBeforePost.payableBalance} after=${vendorBalancesAfterPost.payableBalance}`
  );

  // --- ISOLATION PROOF: outstandingBalance is bit-for-bit unchanged ---
  check(
    "ISOLATION: Vendor's outstandingBalance is bit-for-bit UNCHANGED by Vendor Bill posting (still exactly the noise value)",
    vendorBalancesAfterPost.outstandingBalance === OUTSTANDING_NOISE,
    `before=${vendorBalancesBeforePost.outstandingBalance} after=${vendorBalancesAfterPost.outstandingBalance} noise=${OUTSTANDING_NOISE}`
  );

  // ============================================================
  // 2. Reverse isolation: Customer Invoice posting never touches payableBalance
  // ============================================================
  console.log("\n--- ISOLATION (reverse): Customer Invoice posting never touches payableBalance ---");

  // Seed the customer's payableBalance with a nonzero NOISE value — same
  // reasoning as above, applied to the opposite direction/field pairing.
  const PAYABLE_NOISE = 888.5;
  await db.partner.update({
    where: { id: customer.id },
    data: { payableBalance: PAYABLE_NOISE },
  });

  const invoice = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector: `VB${stamp.toString().slice(-6)}`,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      { productServiceId: customerProductService.id, description: "Customer-side line", quantity: 1, unitPrice: 12000 },
    ],
  });

  const customerBalancesBeforePost = await getPartnerBalances(customer.id);
  check(
    "Customer's payableBalance noise value took effect before posting",
    customerBalancesBeforePost.payableBalance === PAYABLE_NOISE,
    `payableBalance=${customerBalancesBeforePost.payableBalance}`
  );

  const { res: postInvoiceRes } = await postInvoiceViaApi(invoice.id);
  check("Posting the Customer Invoice succeeds", postInvoiceRes.ok, `status=${postInvoiceRes.status}`);

  const customerBalancesAfterPost = await getPartnerBalances(customer.id);
  check(
    "Customer's outstandingBalance increased by exactly 12000 (the invoice's grandTotal)",
    customerBalancesAfterPost.outstandingBalance - customerBalancesBeforePost.outstandingBalance === 12000,
    `before=${customerBalancesBeforePost.outstandingBalance} after=${customerBalancesAfterPost.outstandingBalance}`
  );
  check(
    "ISOLATION: Customer's payableBalance is bit-for-bit UNCHANGED by Customer Invoice posting (still exactly the noise value)",
    customerBalancesAfterPost.payableBalance === PAYABLE_NOISE,
    `before=${customerBalancesBeforePost.payableBalance} after=${customerBalancesAfterPost.payableBalance} noise=${PAYABLE_NOISE}`
  );

  // ============================================================
  // 3. Rejected: VENDOR-direction invoice against a CUSTOMER-type partner
  // ============================================================
  console.log("\n--- A VENDOR-direction Vendor Bill against a CUSTOMER partner is rejected ---");
  let wrongTypeRejected = false;
  let wrongTypeMessage = "";
  try {
    await createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "VENDOR",
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        { productServiceId: vendorProductService.id, description: "Should be rejected", quantity: 1, unitPrice: 100 },
      ],
    });
  } catch (error) {
    wrongTypeRejected = error instanceof PartnerNotVendorError;
    wrongTypeMessage = error instanceof Error ? error.message : String(error);
  }
  check(
    "VENDOR-direction bill against a CUSTOMER partner throws PartnerNotVendorError",
    wrongTypeRejected,
    `message=${wrongTypeMessage}`
  );

  // ============================================================
  // 4. Rejected: VENDOR-direction line using a ProductService with no expenseAccountId
  // ============================================================
  console.log("\n--- A VENDOR-direction line with no expenseAccountId is rejected ---");
  let noExpenseRejected = false;
  let noExpenseMessage = "";
  try {
    await createInvoiceViaSchema({
      partnerId: vendor.id,
      direction: "VENDOR",
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        { productServiceId: noExpenseProductService.id, description: "No expense account configured", quantity: 1, unitPrice: 100 },
      ],
    });
  } catch (error) {
    noExpenseRejected = error instanceof InvoiceLineMissingExpenseAccountError;
    noExpenseMessage = error instanceof Error ? error.message : String(error);
  }
  check(
    "VENDOR line with a ProductService lacking expenseAccountId throws InvoiceLineMissingExpenseAccountError",
    noExpenseRejected,
    `message=${noExpenseMessage}`
  );

  // Both rejected attempts ran inside createInvoice's own transaction —
  // confirm no stray Invoice rows landed for either.
  const strayInvoiceCount = await db.invoice.count({
    where: { partnerId: { in: [customer.id, vendor.id] }, direction: "VENDOR", subtotal: 100 },
  });
  check("Neither rejected attempt left a stray Invoice row behind", strayInvoiceCount === 0, `count=${strayInvoiceCount}`);

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
