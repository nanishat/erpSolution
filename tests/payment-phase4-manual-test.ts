// Phase 4 payment manual test — covers the general multi-invoice
// recordPayment + applyPartnerCredit rework (payment.service.ts) that
// replaces the Phase 3 minimal single-invoice model (see
// payment-manual-test.ts, which still covers and passes against the
// preserved legacy single-invoice shape via recordPaymentForInvoice — not
// duplicated here).
//
// Exercises the real HTTP API: POST /api/payments, POST
// /api/payments/credits/apply, POST /api/invoices/[id]/post. Invoice
// creation goes through createInvoice directly (no createInvoice API/UI
// layer yet, same deviation as every other Phase 3/4 invoice script).
// Invoice/Payment/PartnerCredit/JournalEntry state is read directly via
// Prisma; Partner balances are read via GET /api/partners/[id] (same as
// payment-manual-test.ts).
//
// Same isolation rigor as payment-manual-test.ts: every balance check seeds
// the "wrong" Partner field with a nonzero noise value first (direct Prisma
// write) and asserts it's bit-for-bit unchanged afterward.
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

async function recordPaymentViaApi(body: Record<string, unknown>) {
  return api("/api/payments", { method: "POST", body: JSON.stringify(body) });
}

async function applyCreditViaApi(body: Record<string, unknown>) {
  return api("/api/payments/credits/apply", { method: "POST", body: JSON.stringify(body) });
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

async function getInvoiceState(id: string) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id } });
  return {
    status: invoice.status,
    amountPaid: Number(invoice.amountPaid),
    grandTotal: Number(invoice.grandTotal),
  };
}

async function getJournalEntryForPayment(paymentId: string) {
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { journalEntry: { include: { lines: true } } },
  });
  return payment.journalEntry;
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
      code: `TEST-PAY4-CUST-PS-${stamp}`,
      name: `TEST Phase4 Payment Customer Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });
  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-PAY4-VEND-PS-${stamp}`,
      name: `TEST Phase4 Payment Vendor Service ${stamp}`,
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
      name: `TEST Phase4 Payment Customer ${stamp}`,
      tin: `TIN-PAY4-${stamp}`,
      bin: `BIN-PAY4-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Phase4 Payment Vendor ${stamp}`,
      tin: `TIN-PAY4V-${stamp}`,
      bin: `BIN-PAY4V-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string };

  function makeCustomerInvoice(sectorSuffix: string, unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector: `P4${stamp.toString().slice(-5)}${sectorSuffix}`,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: customerProductService.id,
          description: "Phase4 payment test line",
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
          description: "Phase4 payment test bill line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  // ============================================================
  // 1. Multi-invoice split payment (CUSTOMER) — one Payment allocated
  //    across two invoices, no leftover
  // ============================================================
  console.log("--- Multi-invoice split payment (CUSTOMER) ---");

  const PAYABLE_NOISE_1 = 741.5;
  await db.partner.update({ where: { id: customer.id }, data: { payableBalance: PAYABLE_NOISE_1 } });

  const invoiceA = await makeCustomerInvoice("A", 6000);
  const invoiceB = await makeCustomerInvoice("B", 4000);
  await postInvoiceViaApi(invoiceA.id);
  await postInvoiceViaApi(invoiceB.id);

  const balancesBeforeSplit = await getPartnerBalances(customer.id);

  const { res: splitRes, json: splitJson } = await recordPaymentViaApi({
    partnerId: customer.id,
    branchId: branch.id,
    amount: 10000,
    date: new Date().toISOString(),
    method: "Bank Transfer",
    reference: `TEST-SPLIT-${stamp}`,
    cashBankAccountId: cashAccount.id,
    allocations: [
      { invoiceId: invoiceA.id, amountApplied: 6000 },
      { invoiceId: invoiceB.id, amountApplied: 4000 },
    ],
  });
  check(
    "Split payment succeeds",
    splitRes.status === 201,
    `status=${splitRes.status} body=${JSON.stringify(splitJson)}`
  );
  check(
    "Payment has 2 allocations",
    splitJson.data?.allocations?.length === 2,
    `allocations=${JSON.stringify(splitJson.data?.allocations)}`
  );

  const invoiceAState = await getInvoiceState(invoiceA.id);
  const invoiceBState = await getInvoiceState(invoiceB.id);
  check(
    "Invoice A -> PAID, amountPaid = 6000",
    invoiceAState.status === "PAID" && invoiceAState.amountPaid === 6000,
    `state=${JSON.stringify(invoiceAState)}`
  );
  check(
    "Invoice B -> PAID, amountPaid = 4000",
    invoiceBState.status === "PAID" && invoiceBState.amountPaid === 4000,
    `state=${JSON.stringify(invoiceBState)}`
  );

  const balancesAfterSplit = await getPartnerBalances(customer.id);
  check(
    "Customer's outstandingBalance decreased by exactly 10000 (the full payment amount)",
    balancesBeforeSplit.outstandingBalance - balancesAfterSplit.outstandingBalance === 10000,
    `before=${balancesBeforeSplit.outstandingBalance} after=${balancesAfterSplit.outstandingBalance}`
  );
  check(
    "ISOLATION: Customer's payableBalance is bit-for-bit UNCHANGED (still exactly the noise value)",
    balancesAfterSplit.payableBalance === PAYABLE_NOISE_1,
    `after=${balancesAfterSplit.payableBalance} noise=${PAYABLE_NOISE_1}`
  );

  const splitEntry = await getJournalEntryForPayment(splitJson.data.id);
  check(
    "JournalEntry posted with exactly 2 lines (Debit Cash 10000, Credit AR 10000)",
    splitEntry.status === "POSTED" &&
      splitEntry.lines.length === 2 &&
      splitEntry.lines.some((l) => Number(l.debit) === 10000 && l.accountId === cashAccount.id) &&
      splitEntry.lines.some((l) => Number(l.credit) === 10000 && l.accountId !== cashAccount.id),
    `entry=${JSON.stringify(splitEntry.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })))}`
  );

  // ============================================================
  // 2. Overpayment creates a PartnerCredit
  // ============================================================
  console.log("\n--- Overpayment creates a PartnerCredit ---");

  const invoiceOverpay = await makeCustomerInvoice("C", 5000);
  await postInvoiceViaApi(invoiceOverpay.id);

  const balancesBeforeOverpay = await getPartnerBalances(customer.id);

  const { res: overpayRes, json: overpayJson } = await recordPaymentViaApi({
    partnerId: customer.id,
    branchId: branch.id,
    amount: 7000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
    allocations: [{ invoiceId: invoiceOverpay.id, amountApplied: 5000 }],
  });
  check(
    "Overpayment (7000 paid, 5000 allocated) succeeds — not rejected",
    overpayRes.status === 201,
    `status=${overpayRes.status} body=${JSON.stringify(overpayJson)}`
  );

  const overpayInvoiceState = await getInvoiceState(invoiceOverpay.id);
  check(
    "Allocated invoice -> PAID, amountPaid = 5000 (not 7000)",
    overpayInvoiceState.status === "PAID" && overpayInvoiceState.amountPaid === 5000,
    `state=${JSON.stringify(overpayInvoiceState)}`
  );

  const credit = await db.partnerCredit.findUniqueOrThrow({
    where: { sourcePaymentId: overpayJson.data.id },
  });
  check(
    "PartnerCredit created: OPEN, originalAmount = remainingAmount = 2000 (the leftover)",
    credit.status === "OPEN" &&
      Number(credit.originalAmount) === 2000 &&
      Number(credit.remainingAmount) === 2000,
    `credit=${JSON.stringify({ status: credit.status, originalAmount: Number(credit.originalAmount), remainingAmount: Number(credit.remainingAmount) })}`
  );

  const balancesAfterOverpay = await getPartnerBalances(customer.id);
  check(
    "Customer's outstandingBalance decreased by the FULL 7000 (not just the 5000 allocated)",
    balancesBeforeOverpay.outstandingBalance - balancesAfterOverpay.outstandingBalance === 7000,
    `before=${balancesBeforeOverpay.outstandingBalance} after=${balancesAfterOverpay.outstandingBalance}`
  );
  check(
    "Customer's creditBalance increased by exactly 2000 (the leftover)",
    balancesAfterOverpay.creditBalance - balancesBeforeOverpay.creditBalance === 2000,
    `before=${balancesBeforeOverpay.creditBalance} after=${balancesAfterOverpay.creditBalance}`
  );

  // ============================================================
  // 3. applyPartnerCredit reduces the credit and settles another invoice,
  //    without touching outstandingBalance or the ledger again
  // ============================================================
  console.log("\n--- applyPartnerCredit ---");

  const invoiceForCredit = await makeCustomerInvoice("D", 1500);
  await postInvoiceViaApi(invoiceForCredit.id);

  const journalEntryCountBeforeApply = await db.journalEntry.count();
  const balancesBeforeApply = await getPartnerBalances(customer.id);

  const { res: applyRes, json: applyJson } = await applyCreditViaApi({
    partnerCreditId: credit.id,
    invoiceId: invoiceForCredit.id,
    amountToApply: 1500,
  });
  check(
    "applyPartnerCredit succeeds",
    applyRes.status === 201,
    `status=${applyRes.status} body=${JSON.stringify(applyJson)}`
  );
  check(
    "Credit remainingAmount -> 500 (2000 - 1500), status -> PARTIALLY_APPLIED",
    applyJson.data?.partnerCredit?.remainingAmount === 500 &&
      applyJson.data?.partnerCredit?.status === "PARTIALLY_APPLIED",
    `partnerCredit=${JSON.stringify(applyJson.data?.partnerCredit)}`
  );
  check(
    "Invoice settled by credit -> PAID, amountPaid = 1500",
    applyJson.data?.invoice?.status === "PAID" && applyJson.data?.invoice?.amountPaid === 1500,
    `invoice=${JSON.stringify(applyJson.data?.invoice)}`
  );

  const balancesAfterApply = await getPartnerBalances(customer.id);
  check(
    "Customer's creditBalance decreased by exactly 1500",
    balancesBeforeApply.creditBalance - balancesAfterApply.creditBalance === 1500,
    `before=${balancesBeforeApply.creditBalance} after=${balancesAfterApply.creditBalance}`
  );
  check(
    "ISOLATION: applyPartnerCredit does NOT touch outstandingBalance (bit-for-bit unchanged)",
    balancesAfterApply.outstandingBalance === balancesBeforeApply.outstandingBalance,
    `before=${balancesBeforeApply.outstandingBalance} after=${balancesAfterApply.outstandingBalance}`
  );

  const journalEntryCountAfterApply = await db.journalEntry.count();
  check(
    "applyPartnerCredit creates NO new JournalEntry",
    journalEntryCountAfterApply === journalEntryCountBeforeApply,
    `before=${journalEntryCountBeforeApply} after=${journalEntryCountAfterApply}`
  );

  // Fully consume the remaining 500 of the credit against a second invoice
  // to prove FULLY_APPLIED transition.
  const invoiceForCredit2 = await makeCustomerInvoice("E", 500);
  await postInvoiceViaApi(invoiceForCredit2.id);
  const { json: finalApplyJson } = await applyCreditViaApi({
    partnerCreditId: credit.id,
    invoiceId: invoiceForCredit2.id,
    amountToApply: 500,
  });
  check(
    "Fully consuming the credit -> status FULLY_APPLIED, remainingAmount = 0",
    finalApplyJson.data?.partnerCredit?.status === "FULLY_APPLIED" &&
      finalApplyJson.data?.partnerCredit?.remainingAmount === 0,
    `partnerCredit=${JSON.stringify(finalApplyJson.data?.partnerCredit)}`
  );

  // ============================================================
  // 4. Allocation exceeding an invoice's remaining balance is rejected
  // ============================================================
  console.log("\n--- Allocation exceeding invoice remaining balance ---");

  const invoiceSmall = await makeCustomerInvoice("F", 1000);
  await postInvoiceViaApi(invoiceSmall.id);

  const { res: exceedsInvoiceRes, json: exceedsInvoiceJson } = await recordPaymentViaApi({
    partnerId: customer.id,
    branchId: branch.id,
    amount: 2000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
    allocations: [{ invoiceId: invoiceSmall.id, amountApplied: 1500 }],
  });
  check(
    "Allocation (1500) exceeding invoice remaining balance (1000) is rejected with 409",
    exceedsInvoiceRes.status === 409,
    `status=${exceedsInvoiceRes.status} body=${JSON.stringify(exceedsInvoiceJson)}`
  );
  const invoiceSmallState = await getInvoiceState(invoiceSmall.id);
  check(
    "Rejected allocation left the invoice untouched: still POSTED, amountPaid still 0",
    invoiceSmallState.status === "POSTED" && invoiceSmallState.amountPaid === 0,
    `state=${JSON.stringify(invoiceSmallState)}`
  );

  // ============================================================
  // 5. Allocation total exceeding the payment amount is rejected
  //    (over-allocation, distinct from overpayment)
  // ============================================================
  console.log("\n--- Allocation total exceeding payment amount ---");

  const invoiceG = await makeCustomerInvoice("G", 3000);
  const invoiceH = await makeCustomerInvoice("H", 3000);
  await postInvoiceViaApi(invoiceG.id);
  await postInvoiceViaApi(invoiceH.id);

  const { res: overAllocRes, json: overAllocJson } = await recordPaymentViaApi({
    partnerId: customer.id,
    branchId: branch.id,
    amount: 3000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
    allocations: [
      { invoiceId: invoiceG.id, amountApplied: 2000 },
      { invoiceId: invoiceH.id, amountApplied: 2000 },
    ],
  });
  check(
    "Allocations summing to 4000 against a 3000 payment are rejected with 400",
    overAllocRes.status === 400,
    `status=${overAllocRes.status} body=${JSON.stringify(overAllocJson)}`
  );
  const invoiceGState = await getInvoiceState(invoiceG.id);
  const invoiceHState = await getInvoiceState(invoiceH.id);
  check(
    "Rejected over-allocation left both invoices untouched: still POSTED, amountPaid still 0",
    invoiceGState.status === "POSTED" &&
      invoiceGState.amountPaid === 0 &&
      invoiceHState.status === "POSTED" &&
      invoiceHState.amountPaid === 0,
    `G=${JSON.stringify(invoiceGState)} H=${JSON.stringify(invoiceHState)}`
  );

  // ============================================================
  // 6. Payment flow for a VENDOR bill — direction isolation proof
  // ============================================================
  console.log("\n--- Payment for a VENDOR bill (direction isolation) ---");

  const OUTSTANDING_NOISE = 369.75;
  await db.partner.update({ where: { id: vendor.id }, data: { outstandingBalance: OUTSTANDING_NOISE } });

  const bill = await makeVendorBill(8000);
  await postInvoiceViaApi(bill.id);

  const vendorBalancesBefore = await getPartnerBalances(vendor.id);

  const { res: billPayRes, json: billPayJson } = await recordPaymentViaApi({
    partnerId: vendor.id,
    branchId: branch.id,
    amount: 8000,
    date: new Date().toISOString(),
    method: "Cheque",
    reference: `TEST-VBILL-${stamp}`,
    cashBankAccountId: cashAccount.id,
    allocations: [{ invoiceId: bill.id, amountApplied: 8000 }],
  });
  check(
    "Vendor bill payment succeeds",
    billPayRes.status === 201,
    `status=${billPayRes.status} body=${JSON.stringify(billPayJson)}`
  );

  const billState = await getInvoiceState(bill.id);
  check(
    "Vendor bill -> PAID",
    billState.status === "PAID" && billState.amountPaid === 8000,
    `state=${JSON.stringify(billState)}`
  );

  const vendorBalancesAfter = await getPartnerBalances(vendor.id);
  check(
    "Vendor's payableBalance decreased by exactly 8000",
    vendorBalancesBefore.payableBalance - vendorBalancesAfter.payableBalance === 8000,
    `before=${vendorBalancesBefore.payableBalance} after=${vendorBalancesAfter.payableBalance}`
  );
  check(
    "ISOLATION: Vendor's outstandingBalance is bit-for-bit UNCHANGED (still exactly the noise value)",
    vendorBalancesAfter.outstandingBalance === OUTSTANDING_NOISE,
    `after=${vendorBalancesAfter.outstandingBalance} noise=${OUTSTANDING_NOISE}`
  );

  const billEntry = await getJournalEntryForPayment(billPayJson.data.id);
  check(
    "VENDOR direction JournalEntry: Debit AP 8000, Credit Cash 8000 (opposite of CUSTOMER direction)",
    billEntry.status === "POSTED" &&
      billEntry.lines.length === 2 &&
      billEntry.lines.some((l) => Number(l.credit) === 8000 && l.accountId === cashAccount.id) &&
      billEntry.lines.some((l) => Number(l.debit) === 8000 && l.accountId !== cashAccount.id),
    `entry=${JSON.stringify(billEntry.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })))}`
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
