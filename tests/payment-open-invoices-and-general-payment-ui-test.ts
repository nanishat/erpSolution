// Covers the new Phase 4 UI surface built on top of the general
// recordPayment engine (previously API-only, no UI — see
// payment-phase4-manual-test.ts and payment-partial-matching-chain-test.ts
// for the service/route-level coverage this builds on):
//
//   - GET /api/partners/[id]/open-invoices (getOpenInvoicesForPartner in
//     payment.service.ts) — direction-aware (CUSTOMER -> Customer Invoices,
//     VENDOR -> Vendor Bills), remainingBalance reflects BOTH prior
//     PaymentAllocations and prior CreditApplications, and a fully-settled
//     invoice drops out of the list.
//   - /accounting/payments/new (RecordPaymentForm.tsx, the new general
//     multi-invoice form — distinct from the legacy single-invoice
//     invoicing/RecordPaymentForm.tsx, unmodified and still covered by
//     payment-manual-test.ts) and its DashboardShell nav entry.
//   - A full round-trip through POST /api/payments (not just the service
//     function directly, per the isolation discipline already used
//     elsewhere in this suite) to catch any route-layer serialization
//     issues.
//
// There's no headless-browser/JSDOM runner wired up (see tests/README.md),
// so page checks fetch server-rendered HTML and assert on markup.
// RecordPaymentForm's partner <select> is SSR'd from a server-component
// prop (same shape as ProductServiceTable), so a plain substring search for
// a created partner's name would also match the JSON-escaped RSC hydration
// payload elsewhere in the document — `appearsRendered` checks the actual
// rendered option text (`>value<`) instead, same convention as
// product-service-ui-manual-test.ts. The open-invoices picker itself is
// populated by a client-side fetch after the user picks a partner (never
// present in the initial SSR payload at all), so it's checked directly
// against the GET endpoint's JSON below rather than through page markup.
//
// Same no-cleanup convention and `TEST ... <timestamp>` naming as the other
// scripts.
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

async function page(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  return { res, html };
}

function appearsRendered(html: string, text: string): boolean {
  return html.includes(`>${text}<`);
}

function createInvoiceViaSchema(raw: unknown) {
  return createInvoice(createInvoiceSchema.parse(raw));
}

async function postInvoiceViaApi(id: string) {
  return api(`/api/invoices/${id}/post`, { method: "POST" });
}

type OpenInvoiceRow = {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  amountPaid: number;
  status: string;
  remainingBalance: number;
};

async function getOpenInvoices(partnerId: string): Promise<{ res: Response; rows: OpenInvoiceRow[] }> {
  const { res, json } = await api(`/api/partners/${partnerId}/open-invoices`);
  return { res, rows: json?.data ?? [] };
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

  // ============================================================
  // GET /api/partners/[id]/open-invoices — 404 for a nonexistent partner
  // ============================================================
  console.log("--- GET open-invoices: nonexistent partner ---");
  const { res: notFoundRes } = await getOpenInvoices("nonexistent-partner-id");
  check("Nonexistent partner is rejected with 404", notFoundRes.status === 404, `status=${notFoundRes.status}`);

  // ============================================================
  // CUSTOMER side
  // ============================================================
  console.log("\n--- GET open-invoices: CUSTOMER, correctness across allocations/credits ---");

  const customerProductService = await db.productService.create({
    data: {
      code: `TEST-OI-CUST-PS-${stamp}`,
      name: `TEST OpenInvoices Customer Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST OpenInvoices Customer ${stamp}`,
      tin: `TIN-OI-${stamp}`,
      bin: `BIN-OI-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string; name: string };

  function makeCustomerInvoice(sectorSuffix: string, unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector: `OI${stamp.toString().slice(-5)}${sectorSuffix}`,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: customerProductService.id,
          description: "OpenInvoices test line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  // Two open invoices, nothing paid yet.
  const invoice1 = await makeCustomerInvoice("A", 1000);
  const invoice2 = await makeCustomerInvoice("B", 2000);
  await postInvoiceViaApi(invoice1.id);
  await postInvoiceViaApi(invoice2.id);

  const { res: initialRes, rows: initialRows } = await getOpenInvoices(customer.id);
  check("GET open-invoices succeeds", initialRes.status === 200, `status=${initialRes.status}`);
  check(
    "Both freshly-posted invoices appear with remainingBalance == grandTotal",
    initialRows.length === 2 &&
      initialRows.find((r) => r.id === invoice1.id)?.remainingBalance === 1000 &&
      initialRows.find((r) => r.id === invoice2.id)?.remainingBalance === 2000,
    `rows=${JSON.stringify(initialRows)}`
  );

  // Partial payment (400) against invoice1 via the real POST /api/payments route.
  const { res: partialPayRes, json: partialPayJson } = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      partnerId: customer.id,
      branchId: branch.id,
      amount: 400,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
      reference: `TEST-OI-PARTIAL-${stamp}`,
      allocations: [{ invoiceId: invoice1.id, amountApplied: 400 }],
    }),
  });
  check(
    "Round-trip: POST /api/payments (partial) succeeds and echoes correct shape",
    partialPayRes.status === 201 &&
      Number(partialPayJson.data.amount) === 400 &&
      partialPayJson.data.allocations.length === 1 &&
      Number(partialPayJson.data.allocations[0].amountApplied) === 400 &&
      partialPayJson.data.journalEntry.status === "POSTED",
    `body=${JSON.stringify(partialPayJson)}`
  );

  const { rows: afterPartialRows } = await getOpenInvoices(customer.id);
  const invoice1AfterPartial = afterPartialRows.find((r) => r.id === invoice1.id);
  const invoice2AfterPartial = afterPartialRows.find((r) => r.id === invoice2.id);
  check(
    "Invoice1's remainingBalance reflects the 400 allocation: 600, status PARTIALLY_PAID",
    invoice1AfterPartial?.remainingBalance === 600 && invoice1AfterPartial?.status === "PARTIALLY_PAID",
    `invoice1=${JSON.stringify(invoice1AfterPartial)}`
  );
  check(
    "Invoice2 unaffected by the payment against invoice1: still remainingBalance 2000",
    invoice2AfterPartial?.remainingBalance === 2000,
    `invoice2=${JSON.stringify(invoice2AfterPartial)}`
  );

  // Fully settle invoice1's remaining 600 -> it should drop out of open-invoices entirely.
  await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      partnerId: customer.id,
      branchId: branch.id,
      amount: 600,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
      allocations: [{ invoiceId: invoice1.id, amountApplied: 600 }],
    }),
  });
  const { rows: afterFullRows } = await getOpenInvoices(customer.id);
  check(
    "Fully-paid invoice1 (now PAID) no longer appears in open-invoices",
    !afterFullRows.some((r) => r.id === invoice1.id) && afterFullRows.some((r) => r.id === invoice2.id),
    `rows=${JSON.stringify(afterFullRows)}`
  );

  // Overpay invoice2 to generate a credit, then partially apply it to a third invoice
  // -> remainingBalance must reflect the CreditApplication too, not just PaymentAllocations.
  const { json: overpayJson } = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      partnerId: customer.id,
      branchId: branch.id,
      amount: 2500,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
      allocations: [{ invoiceId: invoice2.id, amountApplied: 2000 }],
    }),
  });
  const credit = await db.partnerCredit.findUniqueOrThrow({ where: { sourcePaymentId: overpayJson.data.id } });
  check("Overpayment leftover credit is 500", Number(credit.remainingAmount) === 500, `credit=${JSON.stringify(credit)}`);

  const invoice3 = await makeCustomerInvoice("C", 800);
  await postInvoiceViaApi(invoice3.id);
  await api("/api/payments/credits/apply", {
    method: "POST",
    body: JSON.stringify({ partnerCreditId: credit.id, invoiceId: invoice3.id, amountToApply: 300 }),
  });

  const { rows: afterCreditRows } = await getOpenInvoices(customer.id);
  const invoice3AfterCredit = afterCreditRows.find((r) => r.id === invoice3.id);
  check(
    "Invoice3's remainingBalance reflects the 300 CreditApplication (not just PaymentAllocations): 800 - 300 = 500",
    invoice3AfterCredit?.remainingBalance === 500,
    `invoice3=${JSON.stringify(invoice3AfterCredit)}`
  );

  // ============================================================
  // VENDOR side — direction isolation
  // ============================================================
  console.log("\n--- GET open-invoices: VENDOR direction isolation ---");

  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-OI-VEND-PS-${stamp}`,
      name: `TEST OpenInvoices Vendor Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
      expenseAccountId: operatingExpense.id,
    },
  });

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST OpenInvoices Vendor ${stamp}`,
      tin: `TIN-OIV-${stamp}`,
      bin: `BIN-OIV-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string; name: string };

  const bill = await createInvoiceViaSchema({
    partnerId: vendor.id,
    direction: "VENDOR",
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      {
        productServiceId: vendorProductService.id,
        description: "OpenInvoices vendor bill line",
        quantity: 1,
        unitPrice: 750,
      },
    ],
  });
  await postInvoiceViaApi(bill.id);

  const { rows: vendorRows } = await getOpenInvoices(vendor.id);
  check(
    "Vendor's open-invoices returns only its own Vendor Bill",
    vendorRows.length === 1 && vendorRows[0].id === bill.id && vendorRows[0].remainingBalance === 750,
    `rows=${JSON.stringify(vendorRows)}`
  );

  const { rows: customerRowsFinal } = await getOpenInvoices(customer.id);
  check(
    "Customer's open-invoices never includes the vendor's bill (direction isolation)",
    !customerRowsFinal.some((r) => r.id === bill.id),
    `rows=${JSON.stringify(customerRowsFinal)}`
  );

  // ============================================================
  // UI: nav entry + /accounting/payments/new renders the partner picker
  // ============================================================
  console.log("\n--- UI: nav entry + Record Payment page ---");

  const { html: accountingHtml } = await page("/accounting");
  check(
    // Deliberately not "Record Payment" — that exact text is already used by
    // InvoiceDetailActions.tsx's per-invoice action button, and since
    // DashboardShell's sidebar renders on every page, reusing it would make
    // every invoice/vendor-bill detail page's "no action buttons" markup
    // check (invoice-ui-manual-test.ts, vendor-bill-ui-manual-test.ts) see a
    // false positive from the sidebar link, not the button they're testing.
    "Sidebar has a 'New Payment' link to /accounting/payments/new",
    accountingHtml.includes('href="/accounting/payments/new"') &&
      accountingHtml.includes("New Payment"),
    "link present"
  );

  const { res: formRes, html: formHtml } = await page("/accounting/payments/new");
  check("GET /accounting/payments/new succeeds", formRes.ok, `status=${formRes.status}`);
  check(
    "Form has the Record payment heading",
    formHtml.includes(">Record payment<"),
    "heading present"
  );
  check(
    "Freshly-created CUSTOMER partner appears as a rendered <option> (not just in the RSC hydration payload)",
    appearsRendered(formHtml, `${customer.name} (Customer)`),
    `looked for rendered ">${customer.name} (Customer)<"`
  );
  check(
    "Freshly-created VENDOR partner also appears as a rendered <option>",
    appearsRendered(formHtml, `${vendor.name} (Vendor)`),
    `looked for rendered ">${vendor.name} (Vendor)<"`
  );
  check(
    "Branch select is rendered (branchId is required input for the general form)",
    formHtml.includes('id="branchId"'),
    "branch select present"
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
