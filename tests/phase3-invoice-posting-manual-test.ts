// Phase 3 (Invoicing & Billing) manual test — the Invoice posting service
// (postInvoice in invoice.service.ts) added on top of createInvoice (covered
// by phase3-invoice-manual-test.ts). Exercises the real HTTP API for
// posting: POST /api/invoices/[id]/post. Requires prisma/seed-tax-accounts.ts
// to have been run first (VAT Payable, looked up by postApprovedTaxApplicationLines
// when the VAT-attached invoice is posted).
//
// Also covers the taxTotal/grandTotal recomputation fix: postInvoice now
// sums every APPROVED TaxApplication on the invoice's JournalEntry into
// taxTotal right before posting, so grandTotal (and therefore the
// Partner.outstandingBalance increment) includes approved tax instead of
// silently staying at the pre-tax subtotal (the bug flagged in the previous
// session — see section 3 below, and section 3.5 for multiple approved
// TaxApplications summing correctly).
//
// DEVIATION (same as phase3-invoice-manual-test.ts): Invoice creation still
// has no API/UI layer, so createInvoice is called directly via the service
// (through createInvoiceSchema, mirroring a future API route). There is also
// no GET /api/invoices/[id] route yet, so Invoice/JournalEntry state is read
// directly via Prisma after each posting attempt. Posting itself goes
// through the real POST /api/invoices/[id]/post endpoint, and tax
// application create/approve go through their real endpoints
// (POST /api/tax-applications, POST /api/tax-applications/[id]/approve).
//
// TaxRate fixture is created directly via Prisma, same convention as
// phase3-tax-posting-manual-test.ts (no admin CRUD API involved in this
// script's flow). VAT OUTPUT is used (not TDS/VDS) because it's the only tax
// type whose settlement-line resolution matches an invoice's journal entry
// shape: postApprovedTaxApplicationLines requires a CASH/BANK/RECEIVABLE
// debit line, which an invoice always has (the Accounts Receivable debit) —
// TDS/VDS require a CASH/BANK *credit* line, which an invoice's credit side
// (income accounts) never has.
//
// Same no-cleanup convention as the other scripts, timestamp-derived sector
// (not `TEST ...` naming) so re-runs don't collide.
import "dotenv/config";

import { db } from "../src/lib/db";
import { createInvoice } from "../src/modules/invoicing/services/invoice.service";
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

async function getPartnerBalance(id: string): Promise<number> {
  const { res, json } = await api(`/api/partners/${id}`);
  if (!res.ok) {
    throw new Error(`getPartnerBalance failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return Number(json.data.outstandingBalance);
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
  const vatPayable = accounts.find((a) => a.code === "2110")!;
  check(
    "VAT Payable account exists (run prisma/seed-tax-accounts.ts first if this fails)",
    Boolean(vatPayable),
    `vatPayable=${vatPayable?.id}`
  );

  const productService = await db.productService.create({
    data: {
      code: `TEST-POST-PS-${stamp}`,
      name: `TEST Posting Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST Invoice Posting Customer ${stamp}`,
      tin: `TIN-INVPOST-${stamp}`,
      bin: `BIN-INVPOST-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string; outstandingBalance: string };

  const outputVatRate = await db.taxRate.create({
    data: {
      type: "VAT",
      category: "Standard",
      name: `TEST Invoice Posting Output VAT 15% ${stamp}`,
      ratePercent: 15,
      direction: "OUTPUT",
      computationType: "EXCLUSIVE",
    },
  });
  // Second, distinct rate — used by section 3.5 to attach two APPROVED
  // TaxApplications to one invoice's JournalEntry (VAT OUTPUT is the only
  // tax type whose settlement line an invoice's JournalEntry has — see the
  // header comment — so both fixtures here are VAT, just different rates).
  const secondOutputVatRate = await db.taxRate.create({
    data: {
      type: "VAT",
      category: "Standard",
      name: `TEST Invoice Posting Output VAT 5% ${stamp}`,
      ratePercent: 5,
      direction: "OUTPUT",
      computationType: "EXCLUSIVE",
    },
  });

  const sector = `IP${stamp.toString().slice(-6)}`;

  check(
    "New CUSTOMER starts with outstandingBalance 0",
    Number(customer.outstandingBalance) === 0,
    `outstandingBalance=${customer.outstandingBalance}`
  );

  // ============================================================
  // 1. Post a DRAFT invoice with no tax attached
  // ============================================================
  console.log("\n--- Post a DRAFT invoice with no tax attached ---");

  const invoice1 = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      { productServiceId: productService.id, description: "No-tax line", quantity: 2, unitPrice: 5000 },
    ],
  });
  check("Invoice 1 grandTotal = 10000 (no tax)", Number(invoice1.grandTotal) === 10000, `grandTotal=${invoice1.grandTotal}`);

  const balanceBeforeInvoice1 = await getPartnerBalance(customer.id);

  const { res: post1Res, json: post1Json } = await postInvoiceViaApi(invoice1.id);
  check(
    "Posting a no-tax DRAFT invoice succeeds",
    post1Res.ok,
    `status=${post1Res.status} body=${JSON.stringify(post1Json)}`
  );
  check(
    "Response invoice status is POSTED",
    post1Json.data?.status === "POSTED",
    `status=${post1Json.data?.status}`
  );

  const journalEntry1 = await db.journalEntry.findUniqueOrThrow({ where: { id: invoice1.journalEntryId } });
  check(
    "Linked JournalEntry is now POSTED",
    journalEntry1.status === "POSTED",
    `status=${journalEntry1.status}`
  );

  const invoice1AfterPost = await db.invoice.findUniqueOrThrow({ where: { id: invoice1.id } });
  check("Invoice row is now POSTED", invoice1AfterPost.status === "POSTED", `status=${invoice1AfterPost.status}`);
  check(
    "No regression: taxTotal stays 0 and grandTotal stays subtotal (10000) when no tax was ever attached",
    Number(invoice1AfterPost.taxTotal) === 0 && Number(invoice1AfterPost.grandTotal) === 10000,
    `taxTotal=${invoice1AfterPost.taxTotal} grandTotal=${invoice1AfterPost.grandTotal}`
  );

  const balanceAfterInvoice1 = await getPartnerBalance(customer.id);
  check(
    "Partner.outstandingBalance increased by invoice1.grandTotal (10000)",
    balanceAfterInvoice1 - balanceBeforeInvoice1 === 10000,
    `before=${balanceBeforeInvoice1} after=${balanceAfterInvoice1}`
  );

  // ============================================================
  // 2. Post a DRAFT invoice with a PENDING_REVIEW tax application -> rejected
  // ============================================================
  console.log("\n--- Posting is rejected while a tax application is PENDING_REVIEW ---");

  const invoice2 = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      { productServiceId: productService.id, description: "Taxed line", quantity: 1, unitPrice: 20000 },
    ],
  });
  check("Invoice 2 subtotal = 20000", Number(invoice2.subtotal) === 20000, `subtotal=${invoice2.subtotal}`);
  check(
    "Invoice 2 grandTotal = subtotal (20000) at creation, before tax attaches",
    Number(invoice2.grandTotal) === 20000,
    `grandTotal=${invoice2.grandTotal}`
  );

  const { res: taxAppRes, json: taxAppJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: invoice2.journalEntryId,
      taxType: "VAT",
      direction: "OUTPUT",
      sourceTaxRateId: outputVatRate.id,
      baseAmount: 20000,
    }),
  });
  if (!taxAppRes.ok) {
    throw new Error(`createTaxApplication failed (${taxAppRes.status}): ${JSON.stringify(taxAppJson)}`);
  }
  const taxApplication = taxAppJson.data as { id: string; taxAmount: string; status: string };
  check("Tax application taxAmount = 3000.00 (15% of 20000)", Number(taxApplication.taxAmount) === 3000, `taxAmount=${taxApplication.taxAmount}`);
  check("Tax application starts PENDING_REVIEW", taxApplication.status === "PENDING_REVIEW", `status=${taxApplication.status}`);

  const balanceBeforePendingAttempt = await getPartnerBalance(customer.id);

  const { res: post2RejectRes, json: post2RejectJson } = await postInvoiceViaApi(invoice2.id);
  check(
    "Posting invoice2 while tax is PENDING_REVIEW is rejected with 409",
    post2RejectRes.status === 409,
    `status=${post2RejectRes.status} body=${JSON.stringify(post2RejectJson)}`
  );

  const invoice2AfterRejectedAttempt = await db.invoice.findUniqueOrThrow({ where: { id: invoice2.id } });
  check(
    "Invoice2 stays DRAFT after the rejected posting attempt",
    invoice2AfterRejectedAttempt.status === "DRAFT",
    `status=${invoice2AfterRejectedAttempt.status}`
  );

  const journalEntry2AfterRejectedAttempt = await db.journalEntry.findUniqueOrThrow({
    where: { id: invoice2.journalEntryId },
  });
  check(
    "JournalEntry2 stays DRAFT after the rejected posting attempt",
    journalEntry2AfterRejectedAttempt.status === "DRAFT",
    `status=${journalEntry2AfterRejectedAttempt.status}`
  );

  const balanceAfterPendingAttempt = await getPartnerBalance(customer.id);
  check(
    "Partner.outstandingBalance is untouched by the rejected posting attempt",
    balanceAfterPendingAttempt === balanceBeforePendingAttempt,
    `before=${balanceBeforePendingAttempt} after=${balanceAfterPendingAttempt}`
  );

  // ============================================================
  // 3. Approve the tax application, then posting succeeds
  // ============================================================
  console.log("\n--- Approving the tax application unblocks posting ---");

  const { res: approveRes, json: approveJson } = await api(
    `/api/tax-applications/${taxApplication.id}/approve`,
    { method: "POST" }
  );
  if (!approveRes.ok) {
    throw new Error(`approveTaxApplication failed (${approveRes.status}): ${JSON.stringify(approveJson)}`);
  }

  const { res: post2Res, json: post2Json } = await postInvoiceViaApi(invoice2.id);
  check(
    "Posting invoice2 succeeds once the tax application is APPROVED",
    post2Res.ok,
    `status=${post2Res.status} body=${JSON.stringify(post2Json)}`
  );

  const invoice2AfterPost = await db.invoice.findUniqueOrThrow({ where: { id: invoice2.id } });
  check("Invoice2 is now POSTED", invoice2AfterPost.status === "POSTED", `status=${invoice2AfterPost.status}`);

  // FIXED (previously the flagged bug): taxTotal/grandTotal are now
  // recomputed from APPROVED TaxApplications at posting time, so the 3000
  // approved VAT above lands in both — grandTotal is 23000 (20000 subtotal +
  // 3000 tax), not 20000.
  check(
    "Invoice2 taxTotal = 3000.00 (the approved VAT application)",
    Number(invoice2AfterPost.taxTotal) === 3000,
    `taxTotal=${invoice2AfterPost.taxTotal}`
  );
  check(
    "Invoice2 grandTotal = 23000 (20000 subtotal + 3000 tax), not 20000",
    Number(invoice2AfterPost.grandTotal) === 23000,
    `grandTotal=${invoice2AfterPost.grandTotal}`
  );

  const balanceAfterInvoice2Post = await getPartnerBalance(customer.id);
  const invoice2BalanceDelta = balanceAfterInvoice2Post - balanceAfterPendingAttempt;
  check(
    "Partner.outstandingBalance increased by the corrected grandTotal (23000), not the pre-fix 20000",
    invoice2BalanceDelta === 23000,
    `delta=${invoice2BalanceDelta} grandTotal=${invoice2AfterPost.grandTotal}`
  );

  const vatPayableLine = await db.journalLine.findFirst({
    where: { journalEntryId: invoice2.journalEntryId, accountId: vatPayable.id },
  });
  check(
    "The ledger itself is also correct: VAT Payable line for 3000.00 exists on the posted JournalEntry",
    Number(vatPayableLine?.credit) === 3000,
    `credit=${vatPayableLine?.credit}`
  );

  // ============================================================
  // 3.5. Multiple APPROVED TaxApplications on one invoice sum correctly
  // ============================================================
  console.log("\n--- Multiple approved TaxApplications sum correctly into taxTotal ---");

  const invoice3 = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      { productServiceId: productService.id, description: "Multi-tax line", quantity: 1, unitPrice: 8000 },
    ],
  });
  check("Invoice 3 subtotal = 8000", Number(invoice3.subtotal) === 8000, `subtotal=${invoice3.subtotal}`);

  const taxAppA = (
    await api("/api/tax-applications", {
      method: "POST",
      body: JSON.stringify({
        journalEntryId: invoice3.journalEntryId,
        taxType: "VAT",
        direction: "OUTPUT",
        sourceTaxRateId: outputVatRate.id, // 15%
        baseAmount: 8000,
      }),
    })
  ).json.data as { id: string; taxAmount: string };
  const taxAppB = (
    await api("/api/tax-applications", {
      method: "POST",
      body: JSON.stringify({
        journalEntryId: invoice3.journalEntryId,
        taxType: "VAT",
        direction: "OUTPUT",
        sourceTaxRateId: secondOutputVatRate.id, // 5%
        baseAmount: 8000,
      }),
    })
  ).json.data as { id: string; taxAmount: string };
  check("Tax application A = 1200.00 (15% of 8000)", Number(taxAppA.taxAmount) === 1200, `taxAmount=${taxAppA.taxAmount}`);
  check("Tax application B = 400.00 (5% of 8000)", Number(taxAppB.taxAmount) === 400, `taxAmount=${taxAppB.taxAmount}`);

  await api(`/api/tax-applications/${taxAppA.id}/approve`, { method: "POST" });
  await api(`/api/tax-applications/${taxAppB.id}/approve`, { method: "POST" });

  const balanceBeforeInvoice3 = await getPartnerBalance(customer.id);

  const { res: post3Res, json: post3Json } = await postInvoiceViaApi(invoice3.id);
  check(
    "Posting invoice3 with two APPROVED TaxApplications succeeds",
    post3Res.ok,
    `status=${post3Res.status} body=${JSON.stringify(post3Json)}`
  );

  const invoice3AfterPost = await db.invoice.findUniqueOrThrow({ where: { id: invoice3.id } });
  check(
    "Invoice3 taxTotal = 1600.00 (1200 + 400, both approved applications summed)",
    Number(invoice3AfterPost.taxTotal) === 1600,
    `taxTotal=${invoice3AfterPost.taxTotal}`
  );
  check(
    "Invoice3 grandTotal = 9600 (8000 subtotal + 1600 combined tax)",
    Number(invoice3AfterPost.grandTotal) === 9600,
    `grandTotal=${invoice3AfterPost.grandTotal}`
  );

  const balanceAfterInvoice3 = await getPartnerBalance(customer.id);
  check(
    "Partner.outstandingBalance increased by invoice3.grandTotal (9600)",
    balanceAfterInvoice3 - balanceBeforeInvoice3 === 9600,
    `before=${balanceBeforeInvoice3} after=${balanceAfterInvoice3}`
  );

  // ============================================================
  // 4. Posting an already-POSTED invoice is rejected
  // ============================================================
  console.log("\n--- Posting an already-POSTED invoice is rejected ---");

  const { res: repostRes, json: repostJson } = await postInvoiceViaApi(invoice1.id);
  check(
    "Re-posting invoice1 (already POSTED) is rejected with 409",
    repostRes.status === 409,
    `status=${repostRes.status} body=${JSON.stringify(repostJson)}`
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
