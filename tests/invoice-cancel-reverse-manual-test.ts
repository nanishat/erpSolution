// Invoice cancellation/reversal manual test — cancelInvoice/reverseInvoice
// (invoice.service.ts), added as the two undo paths for Invoice
// (Customer Invoice / Vendor Bill alike): cancelInvoice for a DRAFT invoice
// that never touched the ledger, reverseInvoice for an already-POSTED one
// that did. See the doc comments on both functions for why these are
// deliberately NOT the same operation.
//
// Exercises the real HTTP API: POST /api/invoices/[id]/cancel and
// POST /api/invoices/[id]/reverse. Invoice creation still goes through
// createInvoice directly (same deviation as the other Phase 3 invoice
// scripts — no createInvoice API/UI layer yet), posting/payment go through
// the real POST /api/invoices/[id]/post and POST /api/invoices/[id]/payments
// endpoints. JournalEntry/Invoice state is read directly via Prisma where
// there's no GET route to use, same convention as payment-manual-test.ts.
//
// Same isolation rigor as payment-manual-test.ts/phase3-vendor-bill-manual-test.ts:
// every balance check seeds the "wrong" Partner field with a nonzero noise
// value first (direct Prisma write) and asserts it's bit-for-bit unchanged
// afterward, not just "still zero".
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

async function cancelInvoiceViaApi(id: string) {
  return api(`/api/invoices/${id}/cancel`, { method: "POST" });
}

async function reverseInvoiceViaApi(id: string, reason?: string) {
  return api(`/api/invoices/${id}/reverse`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
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
    journalEntryId: invoice.journalEntryId,
    amountPaid: Number(invoice.amountPaid),
    grandTotal: Number(invoice.grandTotal),
  };
}

async function getJournalEntryState(id: string) {
  const entry = await db.journalEntry.findUniqueOrThrow({ where: { id } });
  return {
    status: entry.status,
    reversalOfEntryId: entry.reversalOfEntryId,
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
      code: `TEST-CXR-CUST-PS-${stamp}`,
      name: `TEST Cancel/Reverse Customer Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });
  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-CXR-VEND-PS-${stamp}`,
      name: `TEST Cancel/Reverse Vendor Service ${stamp}`,
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
      name: `TEST Cancel/Reverse Customer ${stamp}`,
      tin: `TIN-CXR-${stamp}`,
      bin: `BIN-CXR-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Cancel/Reverse Vendor ${stamp}`,
      tin: `TIN-CXRV-${stamp}`,
      bin: `BIN-CXRV-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string };

  function makeCustomerInvoice(sectorSuffix: string, unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector: `CX${stamp.toString().slice(-5)}${sectorSuffix}`,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: customerProductService.id,
          description: "Cancel/reverse test line",
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
          description: "Cancel/reverse test bill line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  // ============================================================
  // 1. Cancel a DRAFT customer invoice
  // ============================================================
  console.log("--- Cancel a DRAFT customer invoice ---");

  const draftToCancel = await makeCustomerInvoice("A", 4000);
  const balancesBeforeCancel = await getPartnerBalances(customer.id);

  const { res: cancelRes, json: cancelJson } = await cancelInvoiceViaApi(draftToCancel.id);
  check(
    "Cancel succeeds",
    cancelRes.ok,
    `status=${cancelRes.status} body=${JSON.stringify(cancelJson)}`
  );
  check(
    "Cancelled invoice's status -> CANCELLED",
    cancelJson.data?.invoice?.status === "CANCELLED",
    `status=${cancelJson.data?.invoice?.status}`
  );

  const cancelledInvoiceState = await getInvoiceState(draftToCancel.id);
  check(
    "Invoice status persisted as CANCELLED",
    cancelledInvoiceState.status === "CANCELLED",
    `status=${cancelledInvoiceState.status}`
  );

  const balancesAfterCancel = await getPartnerBalances(customer.id);
  check(
    "Customer's outstandingBalance is UNCHANGED by cancelling a never-posted DRAFT invoice",
    balancesAfterCancel.outstandingBalance === balancesBeforeCancel.outstandingBalance,
    `before=${balancesBeforeCancel.outstandingBalance} after=${balancesAfterCancel.outstandingBalance}`
  );

  // Chosen handling of the orphaned DRAFT JournalEntry: since
  // JournalEntryStatus has no "cancelled, never posted" state, it's flipped
  // straight to VOID (voidDraftJournalEntry) rather than left DRAFT forever.
  const cancelledEntryState = await getJournalEntryState(cancelledInvoiceState.journalEntryId);
  check(
    "The invoice's never-posted JournalEntry is VOIDed (not left as an orphaned DRAFT)",
    cancelledEntryState.status === "VOID",
    `journalEntry.status=${cancelledEntryState.status}`
  );
  check(
    "The VOIDed JournalEntry has no reversalOfEntryId (it was voided directly, not via a reversal entry)",
    cancelledEntryState.reversalOfEntryId === null,
    `reversalOfEntryId=${cancelledEntryState.reversalOfEntryId}`
  );
  check(
    "cancelInvoice's response echoes the now-VOID journal entry",
    cancelJson.data?.journalEntry?.status === "VOID",
    `journalEntry.status=${cancelJson.data?.journalEntry?.status}`
  );

  // ============================================================
  // 2. Attempt to cancel a POSTED invoice is rejected
  // ============================================================
  console.log("\n--- Attempt to cancel a POSTED invoice ---");

  const postedNotCancellable = await makeCustomerInvoice("B", 2500);
  const { res: postForCancelRes } = await postInvoiceViaApi(postedNotCancellable.id);
  check("Posting succeeds (setup)", postForCancelRes.ok, `status=${postForCancelRes.status}`);

  const { res: cancelPostedRes, json: cancelPostedJson } = await cancelInvoiceViaApi(
    postedNotCancellable.id
  );
  check(
    "Cancelling a POSTED invoice is rejected with 409",
    cancelPostedRes.status === 409,
    `status=${cancelPostedRes.status} body=${JSON.stringify(cancelPostedJson)}`
  );

  const stillPostedState = await getInvoiceState(postedNotCancellable.id);
  check(
    "Rejected cancel left the invoice untouched: still POSTED",
    stillPostedState.status === "POSTED",
    `status=${stillPostedState.status}`
  );

  // ============================================================
  // 3. Reverse a POSTED customer invoice with zero payments
  // ============================================================
  console.log("\n--- Reverse a POSTED customer invoice (zero payments) ---");

  const PAYABLE_NOISE_1 = 852.25;
  await db.partner.update({ where: { id: customer.id }, data: { payableBalance: PAYABLE_NOISE_1 } });

  const customerToReverse = await makeCustomerInvoice("C", 7000);
  const { res: postForReverseRes } = await postInvoiceViaApi(customerToReverse.id);
  check("Posting succeeds (setup)", postForReverseRes.ok, `status=${postForReverseRes.status}`);

  const custBalancesBeforeReverse = await getPartnerBalances(customer.id);
  const custStateBeforeReverse = await getInvoiceState(customerToReverse.id);

  const { res: reverseCustRes, json: reverseCustJson } = await reverseInvoiceViaApi(
    customerToReverse.id,
    "TEST: reverse customer invoice"
  );
  check(
    "Reverse succeeds",
    reverseCustRes.ok,
    `status=${reverseCustRes.status} body=${JSON.stringify(reverseCustJson)}`
  );
  check(
    "Reversed invoice's status -> VOID",
    reverseCustJson.data?.invoice?.status === "VOID",
    `status=${reverseCustJson.data?.invoice?.status}`
  );

  const custStateAfterReverse = await getInvoiceState(customerToReverse.id);
  check(
    "Invoice status persisted as VOID",
    custStateAfterReverse.status === "VOID",
    `status=${custStateAfterReverse.status}`
  );

  const custBalancesAfterReverse = await getPartnerBalances(customer.id);
  check(
    "Customer's outstandingBalance decreased by exactly the invoice's grandTotal (7000)",
    custBalancesBeforeReverse.outstandingBalance - custBalancesAfterReverse.outstandingBalance ===
      custStateBeforeReverse.grandTotal,
    `before=${custBalancesBeforeReverse.outstandingBalance} after=${custBalancesAfterReverse.outstandingBalance} grandTotal=${custStateBeforeReverse.grandTotal}`
  );
  check(
    "ISOLATION: Customer's payableBalance is bit-for-bit UNCHANGED by reversing the invoice (still exactly the noise value)",
    custBalancesAfterReverse.payableBalance === PAYABLE_NOISE_1,
    `after=${custBalancesAfterReverse.payableBalance} noise=${PAYABLE_NOISE_1}`
  );

  // JournalEntry reversal correctness: original flips to VOID, a new POSTED
  // reversal entry is linked back via reversalOfEntryId — same mechanics
  // reverseJournalEntry already guarantees for vouchers, reused here.
  const originalEntryAfterReverse = await getJournalEntryState(custStateAfterReverse.journalEntryId);
  check(
    "The invoice's original JournalEntry is now VOID",
    originalEntryAfterReverse.status === "VOID",
    `status=${originalEntryAfterReverse.status}`
  );
  check(
    "reverseInvoice's response includes a new POSTED reversal JournalEntry linked to the original",
    reverseCustJson.data?.journalEntry?.reversal?.status === "POSTED" &&
      reverseCustJson.data?.journalEntry?.reversal?.reversalOfEntryId ===
        custStateAfterReverse.journalEntryId,
    `reversal=${JSON.stringify(reverseCustJson.data?.journalEntry?.reversal, null, 0)?.slice(0, 200)}`
  );

  // ============================================================
  // 4. Reverse a POSTED vendor bill with zero payments
  // ============================================================
  console.log("\n--- Reverse a POSTED vendor bill (zero payments) ---");

  const OUTSTANDING_NOISE_1 = 617.4;
  await db.partner.update({
    where: { id: vendor.id },
    data: { outstandingBalance: OUTSTANDING_NOISE_1 },
  });

  const billToReverse = await makeVendorBill(9000);
  const { res: postBillForReverseRes } = await postInvoiceViaApi(billToReverse.id);
  check("Posting succeeds (setup)", postBillForReverseRes.ok, `status=${postBillForReverseRes.status}`);

  const vendorBalancesBeforeReverse = await getPartnerBalances(vendor.id);
  const billStateBeforeReverse = await getInvoiceState(billToReverse.id);

  const { res: reverseBillRes, json: reverseBillJson } = await reverseInvoiceViaApi(billToReverse.id);
  check(
    "Reverse succeeds",
    reverseBillRes.ok,
    `status=${reverseBillRes.status} body=${JSON.stringify(reverseBillJson)}`
  );

  const billStateAfterReverse = await getInvoiceState(billToReverse.id);
  check(
    "Vendor bill status -> VOID",
    billStateAfterReverse.status === "VOID",
    `status=${billStateAfterReverse.status}`
  );

  const vendorBalancesAfterReverse = await getPartnerBalances(vendor.id);
  check(
    "Vendor's payableBalance decreased by exactly the bill's grandTotal (9000)",
    vendorBalancesBeforeReverse.payableBalance - vendorBalancesAfterReverse.payableBalance ===
      billStateBeforeReverse.grandTotal,
    `before=${vendorBalancesBeforeReverse.payableBalance} after=${vendorBalancesAfterReverse.payableBalance} grandTotal=${billStateBeforeReverse.grandTotal}`
  );
  check(
    "ISOLATION: Vendor's outstandingBalance is bit-for-bit UNCHANGED by reversing the bill (still exactly the noise value)",
    vendorBalancesAfterReverse.outstandingBalance === OUTSTANDING_NOISE_1,
    `after=${vendorBalancesAfterReverse.outstandingBalance} noise=${OUTSTANDING_NOISE_1}`
  );

  // ============================================================
  // 5. Attempt to reverse an invoice with a payment recorded is rejected
  // ============================================================
  console.log("\n--- Attempt to reverse an invoice with a payment recorded ---");

  const partiallyPaidInvoice = await makeCustomerInvoice("D", 8000);
  await postInvoiceViaApi(partiallyPaidInvoice.id);
  const { res: partialPayRes } = await recordPaymentViaApi(partiallyPaidInvoice.id, {
    amount: 1000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check("Partial payment succeeds (setup)", partialPayRes.status === 201, `status=${partialPayRes.status}`);

  const { res: reversePartiallyPaidRes, json: reversePartiallyPaidJson } = await reverseInvoiceViaApi(
    partiallyPaidInvoice.id
  );
  check(
    "Reversing an invoice with a payment recorded is rejected with 409",
    reversePartiallyPaidRes.status === 409,
    `status=${reversePartiallyPaidRes.status} body=${JSON.stringify(reversePartiallyPaidJson)}`
  );

  const partiallyPaidStateAfterRejectedReverse = await getInvoiceState(partiallyPaidInvoice.id);
  check(
    "Rejected reverse left the invoice untouched: still PARTIALLY_PAID",
    partiallyPaidStateAfterRejectedReverse.status === "PARTIALLY_PAID",
    `status=${partiallyPaidStateAfterRejectedReverse.status}`
  );

  // ============================================================
  // 6. Attempt to reverse an already-PAID invoice is rejected
  // ============================================================
  console.log("\n--- Attempt to reverse an already-PAID invoice ---");

  const paidInvoice = await makeCustomerInvoice("E", 3000);
  await postInvoiceViaApi(paidInvoice.id);
  const { res: fullPayRes } = await recordPaymentViaApi(paidInvoice.id, {
    amount: 3000,
    date: new Date().toISOString(),
    cashBankAccountId: cashAccount.id,
  });
  check("Full payment succeeds (setup)", fullPayRes.status === 201, `status=${fullPayRes.status}`);

  const paidStateBeforeReverse = await getInvoiceState(paidInvoice.id);
  check("Invoice is PAID (setup)", paidStateBeforeReverse.status === "PAID", `status=${paidStateBeforeReverse.status}`);

  const { res: reversePaidRes, json: reversePaidJson } = await reverseInvoiceViaApi(paidInvoice.id);
  check(
    "Reversing an already-PAID invoice is rejected with 409 (flagged decision: PAID requires a credit note / refund process, not a plain reversal)",
    reversePaidRes.status === 409,
    `status=${reversePaidRes.status} body=${JSON.stringify(reversePaidJson)}`
  );

  const paidStateAfterRejectedReverse = await getInvoiceState(paidInvoice.id);
  check(
    "Rejected reverse left the invoice untouched: still PAID",
    paidStateAfterRejectedReverse.status === "PAID",
    `status=${paidStateAfterRejectedReverse.status}`
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
