// Payment recording manual test — the minimal single-invoice payment service
// (payment.service.ts) added to unblock Invoice status transitions to
// PARTIALLY_PAID/PAID. Deliberately NOT full payment reconciliation:
// multi-invoice allocation, bank statement matching, and anything beyond
// "record a payment against one invoice" stay deferred to Phase 4 (Payments
// & Reconciliation).
//
// Exercises the real HTTP API: POST /api/invoices/[id]/payments. Invoice
// creation still goes through createInvoice directly (same deviation as the
// other Phase 3 invoice scripts — no createInvoice API/UI layer yet), and
// posting goes through the real POST /api/invoices/[id]/post endpoint.
// There's no GET /api/invoices/[id] route yet either, so Invoice/Payment
// state after each payment is read directly via Prisma, same convention as
// phase3-invoice-posting-manual-test.ts.
//
// recordPayment is atomic (not create-then-post like Invoice): a Payment has
// no DRAFT/status field of its own, so its JournalEntry is created and
// immediately posted in the same transaction — see the doc comment on
// recordPayment for the full reasoning.
//
// Same isolation rigor as phase3-vendor-bill-manual-test.ts: every balance
// check seeds the "wrong" Partner field with a nonzero noise value first
// (direct Prisma write) and asserts it's bit-for-bit unchanged afterward,
// not just "still zero".
//
// Same no-cleanup convention as the other scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming.
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

async function recordPaymentViaApi(invoiceId: string, body: Record<string, unknown>) {
  return api(`/api/invoices/${invoiceId}/payments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
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

async function getInvoiceState(id: string) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id } });
  return {
    status: invoice.status,
    amountPaid: Number(invoice.amountPaid),
    grandTotal: Number(invoice.grandTotal),
  };
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixtures ---
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

  const customerProductService = await db.productService.create({
    data: {
      code: `TEST-PAY-CUST-PS-${stamp}`,
      name: `TEST Payment Customer Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });
  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-PAY-VEND-PS-${stamp}`,
      name: `TEST Payment Vendor Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id, // required by schema, unused for VENDOR direction
      expenseAccountId: operatingExpense.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST Payment Customer ${stamp}`,
      tin: `TIN-PAY-${stamp}`,
      bin: `BIN-PAY-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Payment Vendor ${stamp}`,
      tin: `TIN-PAYV-${stamp}`,
      bin: `BIN-PAYV-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string };

  function makeCustomerInvoice(sectorSuffix: string, unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector: `PY${stamp.toString().slice(-5)}${sectorSuffix}`,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: customerProductService.id,
          description: "Payment test line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  function makeVendorBill(unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: vendor.id,
      direction: "VENDOR",
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: vendorProductService.id,
          description: "Payment test bill line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  // ============================================================
  // 1. Full payment on a CUSTOMER invoice -> PAID, isolation proof
  // ============================================================
  console.log("--- Full payment on a CUSTOMER invoice ---");

  const PAYABLE_NOISE_1 = 741.5;
  await db.partner.update({ where: { id: customer.id }, data: { payableBalance: PAYABLE_NOISE_1 } });

  const invoiceFull = await makeCustomerInvoice("A", 10000);
  const { res: postFullRes } = await postInvoiceViaApi(invoiceFull.id);
  check("Posting invoiceFull succeeds", postFullRes.ok, `status=${postFullRes.status}`);

  const balancesBeforeFullPay = await getPartnerBalances(customer.id);

  const { res: fullPayRes, json: fullPayJson } = await recordPaymentViaApi(invoiceFull.id, {
    amount: 10000,
    date: new Date().toISOString(),
    method: "Bank Transfer",
    reference: `TEST-REF-${stamp}-A`,
    cashBankAccountId: cashAccount.id,
  });
  check(
    "Full payment succeeds",
    fullPayRes.status === 201,
    `status=${fullPayRes.status} body=${JSON.stringify(fullPayJson)}`
  );
  check("Payment amount = 10000", Number(fullPayJson.data?.amount) === 10000, `amount=${fullPayJson.data?.amount}`);

  const invoiceFullState = await getInvoiceState(invoiceFull.id);
  check(
    "Invoice status -> PAID after full payment",
    invoiceFullState.status === "PAID",
    `status=${invoiceFullState.status}`
  );
  check(
    "Invoice amountPaid = grandTotal (10000)",
    invoiceFullState.amountPaid === 10000,
    `amountPaid=${invoiceFullState.amountPaid}`
  );

  const balancesAfterFullPay = await getPartnerBalances(customer.id);
  check(
    "Customer's outstandingBalance decreased by exactly 10000",
    balancesBeforeFullPay.outstandingBalance - balancesAfterFullPay.outstandingBalance === 10000,
    `before=${balancesBeforeFullPay.outstandingBalance} after=${balancesAfterFullPay.outstandingBalance}`
  );
  check(
    "ISOLATION: Customer's payableBalance is bit-for-bit UNCHANGED by the payment (still exactly the noise value)",
    balancesAfterFullPay.payableBalance === PAYABLE_NOISE_1,
    `after=${balancesAfterFullPay.payableBalance} noise=${PAYABLE_NOISE_1}`
  );

  // ============================================================
  // 2. Partial payment -> PARTIALLY_PAID
  // ============================================================
  console.log("\n--- Partial payment ---");

  const invoicePartial = await makeCustomerInvoice("B", 20000);
  await postInvoiceViaApi(invoicePartial.id);

  const { res: partialPayRes, json: partialPayJson } = await recordPaymentViaApi(invoicePartial.id, {
    amount: 12000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check(
    "Partial payment succeeds",
    partialPayRes.status === 201,
    `status=${partialPayRes.status} body=${JSON.stringify(partialPayJson)}`
  );

  const invoicePartialState = await getInvoiceState(invoicePartial.id);
  check(
    "Invoice status -> PARTIALLY_PAID",
    invoicePartialState.status === "PARTIALLY_PAID",
    `status=${invoicePartialState.status}`
  );
  check(
    "Invoice amountPaid = 12000",
    invoicePartialState.amountPaid === 12000,
    `amountPaid=${invoicePartialState.amountPaid}`
  );

  // ============================================================
  // 3. Second partial payment summing to the full amount -> PAID
  // ============================================================
  console.log("\n--- Second partial payment completes the invoice ---");

  const { res: secondPayRes } = await recordPaymentViaApi(invoicePartial.id, {
    amount: 8000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check("Second partial payment succeeds", secondPayRes.status === 201, `status=${secondPayRes.status}`);

  const invoicePartialStateAfterSecond = await getInvoiceState(invoicePartial.id);
  check(
    "Invoice status -> PAID after the second partial payment",
    invoicePartialStateAfterSecond.status === "PAID",
    `status=${invoicePartialStateAfterSecond.status}`
  );
  check(
    "Invoice amountPaid = 20000 (12000 + 8000)",
    invoicePartialStateAfterSecond.amountPaid === 20000,
    `amountPaid=${invoicePartialStateAfterSecond.amountPaid}`
  );

  // ============================================================
  // 4. Overpayment attempt is rejected
  // ============================================================
  console.log("\n--- Overpayment attempt ---");

  const invoiceOverpay = await makeCustomerInvoice("C", 5000);
  await postInvoiceViaApi(invoiceOverpay.id);

  const { res: overpayRes, json: overpayJson } = await recordPaymentViaApi(invoiceOverpay.id, {
    amount: 6000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check(
    "Overpayment (6000 against a 5000 grandTotal) is rejected with 409",
    overpayRes.status === 409,
    `status=${overpayRes.status} body=${JSON.stringify(overpayJson)}`
  );

  const invoiceOverpayState = await getInvoiceState(invoiceOverpay.id);
  check(
    "Rejected overpayment left the invoice untouched: still POSTED, amountPaid still 0",
    invoiceOverpayState.status === "POSTED" && invoiceOverpayState.amountPaid === 0,
    `status=${invoiceOverpayState.status} amountPaid=${invoiceOverpayState.amountPaid}`
  );

  // ============================================================
  // 5. Full + partial payment flow for a VENDOR bill, isolation proof
  // ============================================================
  console.log("\n--- Payment flow for a VENDOR bill ---");

  const OUTSTANDING_NOISE = 369.75;
  await db.partner.update({ where: { id: vendor.id }, data: { outstandingBalance: OUTSTANDING_NOISE } });

  const bill = await makeVendorBill(15000);
  await postInvoiceViaApi(bill.id);

  const vendorBalancesBeforePay = await getPartnerBalances(vendor.id);

  const { res: billPartialPayRes } = await recordPaymentViaApi(bill.id, {
    amount: 9000,
    date: new Date().toISOString(),
    method: "Cheque",
    reference: `TEST-CHQ-${stamp}`,
    cashBankAccountId: cashAccount.id,
  });
  check("Vendor bill partial payment succeeds", billPartialPayRes.status === 201, `status=${billPartialPayRes.status}`);

  const billStateAfterPartial = await getInvoiceState(bill.id);
  check(
    "Vendor bill status -> PARTIALLY_PAID after 9000 of 15000",
    billStateAfterPartial.status === "PARTIALLY_PAID",
    `status=${billStateAfterPartial.status}`
  );

  const { res: billFinalPayRes } = await recordPaymentViaApi(bill.id, {
    amount: 6000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check("Vendor bill final payment succeeds", billFinalPayRes.status === 201, `status=${billFinalPayRes.status}`);

  const billStateAfterFinal = await getInvoiceState(bill.id);
  check(
    "Vendor bill status -> PAID after the final payment",
    billStateAfterFinal.status === "PAID",
    `status=${billStateAfterFinal.status}`
  );

  const vendorBalancesAfterPay = await getPartnerBalances(vendor.id);
  check(
    "Vendor's payableBalance decreased by exactly 15000 (9000 + 6000)",
    vendorBalancesBeforePay.payableBalance - vendorBalancesAfterPay.payableBalance === 15000,
    `before=${vendorBalancesBeforePay.payableBalance} after=${vendorBalancesAfterPay.payableBalance}`
  );
  check(
    "ISOLATION: Vendor's outstandingBalance is bit-for-bit UNCHANGED by the bill payments (still exactly the noise value)",
    vendorBalancesAfterPay.outstandingBalance === OUTSTANDING_NOISE,
    `after=${vendorBalancesAfterPay.outstandingBalance} noise=${OUTSTANDING_NOISE}`
  );

  // ============================================================
  // 6. Payment against a DRAFT invoice is rejected
  // ============================================================
  console.log("\n--- Payment against a DRAFT invoice ---");

  const draftInvoice = await makeCustomerInvoice("D", 3000);
  // Deliberately not posted — stays DRAFT.
  const { res: draftPayRes, json: draftPayJson } = await recordPaymentViaApi(draftInvoice.id, {
    amount: 1000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check(
    "Payment against a DRAFT invoice is rejected with 409",
    draftPayRes.status === 409,
    `status=${draftPayRes.status} body=${JSON.stringify(draftPayJson)}`
  );

  // ============================================================
  // 7. Payment against an already-PAID invoice is rejected
  // ============================================================
  console.log("\n--- Payment against an already-PAID invoice ---");

  // invoiceFull was fully paid in step 1.
  const { res: paidAgainRes, json: paidAgainJson } = await recordPaymentViaApi(invoiceFull.id, {
    amount: 100,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check(
    "Payment against an already-PAID invoice is rejected with 409",
    paidAgainRes.status === 409,
    `status=${paidAgainRes.status} body=${JSON.stringify(paidAgainJson)}`
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
