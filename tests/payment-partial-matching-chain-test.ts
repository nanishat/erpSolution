// Chained-scenario test for the previously-unconfirmed interaction between
// "full-amount balance decrement on overpayment" (recordPayment) and
// applyPartnerCredit — see payment.service.ts's getInvoiceRemainingBalance/
// recordPayment/applyPartnerCredit doc comments for the design this proves.
//
// Exact scenario (mirrored on both the CUSTOMER/outstandingBalance and
// VENDOR/payableBalance sides):
//   1. Invoice/Bill A posts for 1000                -> control balance = 1000
//   2. Pay 1200 against it (1000 allocated,
//      200 overpaid)                                -> control balance = -200, creditBalance = 200
//   3. Invoice/Bill B posts for 500                  -> control balance = 300
//   4. Apply the 200 credit to Invoice/Bill B         -> control balance STAYS 300 (not 100) —
//      the credit was already netted into the control total at step 2;
//      applying it only re-attributes which invoice it settles.
//
// Each side uses a brand-new Partner (control balance starts at exactly 0),
// so the numbers checked below are the literal scenario numbers, not deltas
// against a seeded noise value.
//
// Exercises the real HTTP API throughout: POST /api/partners, POST
// /api/invoices/[id]/post (invoice creation itself has no API/UI layer yet,
// same deviation as every other Phase 3/4 invoice script — createInvoice is
// called directly), POST /api/payments, POST /api/payments/credits/apply,
// GET /api/partners/[id] for balance reads. Same no-cleanup convention and
// `TEST ... <timestamp>` naming as the other scripts.
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

async function getPartnerBalances(id: string) {
  const { res, json } = await api(`/api/partners/${id}`);
  if (!res.ok) {
    throw new Error(`getPartnerBalances failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return {
    outstandingBalance: Number(json.data.outstandingBalance),
    payableBalance: Number(json.data.payableBalance),
    creditBalance: Number(json.data.creditBalance),
  };
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  const { json: branchesJson } = await api("/api/branches");
  const branch = branchesJson.data[0] as { id: string; code: string };

  const { json: accountsJson } = await api("/api/accounts");
  const accounts: { id: string; code: string; subType: string | null }[] = accountsJson.data;
  const salesRevenue = accounts.find((a) => a.code === "4010")!;
  const operatingExpense = accounts.find((a) => a.code === "5010")!;
  const cashAccount = accounts.find((a) => a.code === "1010")!;
  check(
    "Cash account (1010) exists (run prisma/seed-coa.ts first if this fails)",
    Boolean(cashAccount) && cashAccount.subType === "CASH",
    `cashAccount=${cashAccount?.id} subType=${cashAccount?.subType}`
  );

  // ============================================================
  // CUSTOMER side — outstandingBalance
  // ============================================================
  console.log("--- CUSTOMER side: chained overpayment + credit application ---");

  const customerProductService = await db.productService.create({
    data: {
      code: `TEST-CHAIN-CUST-PS-${stamp}`,
      name: `TEST Chain Customer Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST Chain Customer ${stamp}`,
      tin: `TIN-CHAIN-${stamp}`,
      bin: `BIN-CHAIN-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  function makeCustomerInvoice(sectorSuffix: string, unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector: `CHN${stamp.toString().slice(-5)}${sectorSuffix}`,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: customerProductService.id,
          description: "Chain test line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  // Step 1: Invoice A posts for 1000.
  const invoiceA = await makeCustomerInvoice("A", 1000);
  await postInvoiceViaApi(invoiceA.id);
  const balancesStep1 = await getPartnerBalances(customer.id);
  console.log(`  [1] After Invoice A (1000) posts: outstandingBalance=${balancesStep1.outstandingBalance}`);
  check(
    "Step 1: outstandingBalance == 1000",
    balancesStep1.outstandingBalance === 1000,
    `outstandingBalance=${balancesStep1.outstandingBalance}`
  );

  // Step 2: Pay 1200 against Invoice A (1000 allocated, 200 overpaid).
  const { res: payRes, json: payJson } = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      partnerId: customer.id,
      branchId: branch.id,
      amount: 1200,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
      allocations: [{ invoiceId: invoiceA.id, amountApplied: 1000 }],
    }),
  });
  check("Step 2: overpayment (1200 paid, 1000 allocated) succeeds", payRes.status === 201, `status=${payRes.status} body=${JSON.stringify(payJson)}`);

  const balancesStep2 = await getPartnerBalances(customer.id);
  console.log(
    `  [2] After paying 1200 against Invoice A: outstandingBalance=${balancesStep2.outstandingBalance}, creditBalance=${balancesStep2.creditBalance}`
  );
  check(
    "Step 2: outstandingBalance == -200 (decremented by the FULL 1200 paid, not just the 1000 allocated)",
    balancesStep2.outstandingBalance === -200,
    `outstandingBalance=${balancesStep2.outstandingBalance}`
  );
  check(
    "Step 2: creditBalance == 200 (the leftover)",
    balancesStep2.creditBalance === 200,
    `creditBalance=${balancesStep2.creditBalance}`
  );

  const credit = await db.partnerCredit.findUniqueOrThrow({ where: { sourcePaymentId: payJson.data.id } });

  // Step 3: Invoice B posts for 500.
  const invoiceB = await makeCustomerInvoice("B", 500);
  await postInvoiceViaApi(invoiceB.id);
  const balancesStep3 = await getPartnerBalances(customer.id);
  console.log(`  [3] After Invoice B (500) posts: outstandingBalance=${balancesStep3.outstandingBalance}`);
  check(
    "Step 3: outstandingBalance == 300 (-200 + 500)",
    balancesStep3.outstandingBalance === 300,
    `outstandingBalance=${balancesStep3.outstandingBalance}`
  );

  // Step 4: Apply the 200 credit to Invoice B.
  const { res: applyRes, json: applyJson } = await api("/api/payments/credits/apply", {
    method: "POST",
    body: JSON.stringify({ partnerCreditId: credit.id, invoiceId: invoiceB.id, amountToApply: 200 }),
  });
  check("Step 4: applyPartnerCredit succeeds", applyRes.status === 201, `status=${applyRes.status} body=${JSON.stringify(applyJson)}`);

  const balancesStep4 = await getPartnerBalances(customer.id);
  console.log(
    `  [4] After applying 200 credit to Invoice B: outstandingBalance=${balancesStep4.outstandingBalance} (expected 300, NOT 100)`
  );
  check(
    "Step 4 (THE BLOCKER CHECK): outstandingBalance STAYS AT 300 — applyPartnerCredit must NOT decrement it a second time to 100",
    balancesStep4.outstandingBalance === 300,
    `outstandingBalance=${balancesStep4.outstandingBalance}`
  );

  const invoiceBState = await db.invoice.findUniqueOrThrow({ where: { id: invoiceB.id } });
  check(
    "Invoice B settled by credit: amountPaid = 200, status = PARTIALLY_PAID (300 of 500 still owed)",
    Number(invoiceBState.amountPaid) === 200 && invoiceBState.status === "PARTIALLY_PAID",
    `amountPaid=${Number(invoiceBState.amountPaid)} status=${invoiceBState.status}`
  );

  // ============================================================
  // VENDOR side — payableBalance (mirror scenario, proven independently)
  // ============================================================
  console.log("\n--- VENDOR side: chained overpayment + credit application (mirror) ---");

  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-CHAIN-VEND-PS-${stamp}`,
      name: `TEST Chain Vendor Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id, // required by schema, unused for VENDOR direction
      expenseAccountId: operatingExpense.id,
    },
  });

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Chain Vendor ${stamp}`,
      tin: `TIN-CHAINV-${stamp}`,
      bin: `BIN-CHAINV-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string };

  function makeVendorBill(unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: vendor.id,
      direction: "VENDOR",
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: vendorProductService.id,
          description: "Chain test bill line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  // Step 1: Bill A posts for 1000.
  const billA = await makeVendorBill(1000);
  await postInvoiceViaApi(billA.id);
  const vBalancesStep1 = await getPartnerBalances(vendor.id);
  console.log(`  [1] After Bill A (1000) posts: payableBalance=${vBalancesStep1.payableBalance}`);
  check(
    "VENDOR Step 1: payableBalance == 1000",
    vBalancesStep1.payableBalance === 1000,
    `payableBalance=${vBalancesStep1.payableBalance}`
  );

  // Step 2: Pay 1200 against Bill A (1000 allocated, 200 overpaid).
  const { res: vPayRes, json: vPayJson } = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      partnerId: vendor.id,
      branchId: branch.id,
      amount: 1200,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
      allocations: [{ invoiceId: billA.id, amountApplied: 1000 }],
    }),
  });
  check("VENDOR Step 2: overpayment (1200 paid, 1000 allocated) succeeds", vPayRes.status === 201, `status=${vPayRes.status} body=${JSON.stringify(vPayJson)}`);

  const vBalancesStep2 = await getPartnerBalances(vendor.id);
  console.log(
    `  [2] After paying 1200 against Bill A: payableBalance=${vBalancesStep2.payableBalance}, creditBalance=${vBalancesStep2.creditBalance}`
  );
  check(
    "VENDOR Step 2: payableBalance == -200 (decremented by the FULL 1200 paid, not just the 1000 allocated)",
    vBalancesStep2.payableBalance === -200,
    `payableBalance=${vBalancesStep2.payableBalance}`
  );
  check(
    "VENDOR Step 2: creditBalance == 200 (the leftover)",
    vBalancesStep2.creditBalance === 200,
    `creditBalance=${vBalancesStep2.creditBalance}`
  );

  const vendorCredit = await db.partnerCredit.findUniqueOrThrow({ where: { sourcePaymentId: vPayJson.data.id } });

  // Step 3: Bill B posts for 500.
  const billB = await makeVendorBill(500);
  await postInvoiceViaApi(billB.id);
  const vBalancesStep3 = await getPartnerBalances(vendor.id);
  console.log(`  [3] After Bill B (500) posts: payableBalance=${vBalancesStep3.payableBalance}`);
  check(
    "VENDOR Step 3: payableBalance == 300 (-200 + 500)",
    vBalancesStep3.payableBalance === 300,
    `payableBalance=${vBalancesStep3.payableBalance}`
  );

  // Step 4: Apply the 200 credit to Bill B.
  const { res: vApplyRes, json: vApplyJson } = await api("/api/payments/credits/apply", {
    method: "POST",
    body: JSON.stringify({ partnerCreditId: vendorCredit.id, invoiceId: billB.id, amountToApply: 200 }),
  });
  check("VENDOR Step 4: applyPartnerCredit succeeds", vApplyRes.status === 201, `status=${vApplyRes.status} body=${JSON.stringify(vApplyJson)}`);

  const vBalancesStep4 = await getPartnerBalances(vendor.id);
  console.log(
    `  [4] After applying 200 credit to Bill B: payableBalance=${vBalancesStep4.payableBalance} (expected 300, NOT 100)`
  );
  check(
    "VENDOR Step 4 (THE BLOCKER CHECK): payableBalance STAYS AT 300 — applyPartnerCredit must NOT decrement it a second time to 100",
    vBalancesStep4.payableBalance === 300,
    `payableBalance=${vBalancesStep4.payableBalance}`
  );

  const billBState = await db.invoice.findUniqueOrThrow({ where: { id: billB.id } });
  check(
    "Bill B settled by credit: amountPaid = 200, status = PARTIALLY_PAID (300 of 500 still owed)",
    Number(billBState.amountPaid) === 200 && billBState.status === "PARTIALLY_PAID",
    `amountPaid=${Number(billBState.amountPaid)} status=${billBState.status}`
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
