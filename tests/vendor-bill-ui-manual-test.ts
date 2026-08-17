// Vendor Bill UI manual test — covers what's actually new in this task:
// the vendor-bills/* pages composed from the already-tested, direction-
// agnostic components (InvoiceTable, InvoiceForm, InvoiceDetailActions,
// PaymentHistoryTable, RecordPaymentForm) built for the Customer Invoice UI.
// Backend behavior (createInvoice's VENDOR branch, generateVendorBillNumber,
// PartnerNotVendorError, InvoiceLineMissingExpenseAccountError) is already
// covered by phase3-vendor-bill-manual-test.ts and
// invoice-cancel-reverse-manual-test.ts — this script focuses on:
//   1. end-to-end creation through the same POST /api/invoices InvoiceForm
//      calls, with the correct VB/{Branch}/{YYYYMM}/{Seq} number and
//      partner-type restriction,
//   2. the client-side expense-account-only line filtering InvoiceForm now
//      applies for direction: VENDOR — checked via the actual SSR'd HTML of
//      /accounting/vendor-bills/new, since the filtering logic runs during
//      server rendering too, not just after hydration,
//   3. list isolation in both directions (no cross-contamination between
//      /accounting/invoices and /accounting/vendor-bills),
//   4. the vendor bill detail page rendering line items/totals and the
//      correct status-based actions per status, reusing InvoiceDetailActions.
//
// Same no-cleanup convention as the other scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming.
import "dotenv/config";

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

async function html(path: string): Promise<{ res: Response; body: string }> {
  const res = await fetch(`${BASE_URL}${path}`);
  const body = await res.text();
  return { res, body };
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

  // Vendor-eligible: has expenseAccountId set, selectable for a VENDOR line.
  const { json: eligiblePsJson } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-VB-ELIGIBLE-${stamp}`,
      name: `TEST VB Eligible Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
      expenseAccountId: operatingExpense.id,
    }),
  });
  const eligibleProductService = eligiblePsJson.data as { id: string; code: string };

  // Vendor-ineligible: no expenseAccountId — createInvoice rejects this for
  // direction: VENDOR (InvoiceLineMissingExpenseAccountError), so InvoiceForm
  // must filter it out of the dropdown for a VENDOR bill.
  const { json: ineligiblePsJson } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-VB-INELIGIBLE-${stamp}`,
      name: `TEST VB Ineligible Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    }),
  });
  const ineligibleProductService = ineligiblePsJson.data as { id: string; code: string };

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST VB Vendor ${stamp}`,
      tin: `TIN-VB-${stamp}`,
      bin: `BIN-VB-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string; name: string };

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST VB Customer ${stamp}`,
      tin: `TIN-VBC-${stamp}`,
      bin: `BIN-VBC-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  // ============================================================
  // 1. Create flow: POST /api/invoices with direction: VENDOR
  // ============================================================
  console.log("--- Create flow: VENDOR bill via POST /api/invoices ---");

  const { res: createRes, json: createJson } = await api("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      direction: "VENDOR",
      partnerId: vendor.id,
      branchId: branch.id,
      date: new Date().toISOString(),
      notes: "TEST VB bill",
      lines: [
        {
          productServiceId: eligibleProductService.id,
          description: "TEST VB line",
          quantity: 3,
          unitPrice: 800,
        },
      ],
    }),
  });
  check("Create succeeds (201)", createRes.status === 201, `status=${createRes.status} body=${JSON.stringify(createJson)}`);
  const bill = createJson.data as { id: string; invoiceNumber: string; sector: string | null };

  check(
    "invoiceNumber follows the VB/{Branch}/{YYYYMM}/{Seq} format (no sector segment)",
    /^VB\/[A-Za-z0-9]+\/\d{6}\/\d{4}$/.test(bill.invoiceNumber),
    `invoiceNumber=${bill.invoiceNumber}`
  );
  check("sector is stored null for direction: VENDOR", bill.sector === null, `sector=${bill.sector}`);
  check("subtotal computed correctly (3 x 800 = 2400)", createJson.data.subtotal === 2400, `subtotal=${createJson.data.subtotal}`);

  // Partner-type restriction — same PartnerNotVendorError already covered by
  // phase3-vendor-bill-manual-test.ts at the service layer; re-checked here
  // through the actual API route this UI's InvoiceForm calls.
  const { res: wrongPartnerRes, json: wrongPartnerJson } = await api("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      direction: "VENDOR",
      partnerId: customer.id,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [{ productServiceId: eligibleProductService.id, description: "x", quantity: 1, unitPrice: 1 }],
    }),
  });
  check(
    "Creating a VENDOR bill against a CUSTOMER partner is rejected (400) via the API route",
    wrongPartnerRes.status === 400,
    `status=${wrongPartnerRes.status} body=${JSON.stringify(wrongPartnerJson)}`
  );

  // Expense-account-only line restriction — the server-side enforcement
  // behind InvoiceForm's client-side filtering.
  const { res: noExpenseRes, json: noExpenseJson } = await api("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      direction: "VENDOR",
      partnerId: vendor.id,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        { productServiceId: ineligibleProductService.id, description: "x", quantity: 1, unitPrice: 1 },
      ],
    }),
  });
  check(
    "Creating a VENDOR line against a ProductService with no expenseAccountId is rejected (400)",
    noExpenseRes.status === 400,
    `status=${noExpenseRes.status} body=${JSON.stringify(noExpenseJson)}`
  );

  // ============================================================
  // 2. InvoiceForm's client-side expense-account-only filtering (SSR'd HTML)
  // ============================================================
  console.log("\n--- New vendor bill page filters the product/service dropdown ---");

  // Next.js embeds the full server-fetched `productServices` array in a
  // hidden RSC hydration payload for the "use client" InvoiceForm regardless
  // of what it actually renders, so a whole-page substring check on the
  // product/service `code` would false-positive on data that never reaches
  // the visible <select> — check for the literal rendered `<option
  // value="{id}">` markup instead, which only exists for options InvoiceForm
  // actually renders.
  const optionMarkup = (id: string) => `option value="${id}"`;

  const { res: newBillPageRes, body: newBillPageBody } = await html("/accounting/vendor-bills/new");
  check("New vendor bill page returns 200", newBillPageRes.status === 200, `status=${newBillPageRes.status}`);
  check(
    "New vendor bill page offers the expense-account-eligible service",
    newBillPageBody.includes(optionMarkup(eligibleProductService.id)),
    `code=${eligibleProductService.code}`
  );
  check(
    "New vendor bill page does NOT offer the service with no expenseAccountId",
    !newBillPageBody.includes(optionMarkup(ineligibleProductService.id)),
    `code=${ineligibleProductService.code}`
  );
  check(
    "New vendor bill page does NOT render a Sector field (not applicable to direction: VENDOR)",
    !newBillPageBody.includes('id="sector"'),
    "sector input should be hidden for VENDOR direction"
  );
  check(
    "New vendor bill page's partner dropdown offers the vendor",
    newBillPageBody.includes(vendor.name),
    `vendor=${vendor.name}`
  );
  check(
    "New vendor bill page's partner dropdown does NOT offer the customer",
    !newBillPageBody.includes(customer.id),
    "partners prop should be pre-filtered to type: VENDOR"
  );

  // Cross-check: the reused InvoiceForm must still show BOTH product
  // services (no expense-account filtering) on the Customer Invoice side —
  // confirms the VENDOR-only filter didn't leak into the CUSTOMER branch.
  const { body: newInvoicePageBody } = await html("/accounting/invoices/new");
  check(
    "New CUSTOMER invoice page still offers the expense-account-less service (no VENDOR-only filtering leaked in)",
    newInvoicePageBody.includes(optionMarkup(ineligibleProductService.id)),
    `code=${ineligibleProductService.code}`
  );

  // ============================================================
  // 3. List isolation — no cross-contamination between the two lists
  // ============================================================
  console.log("\n--- List isolation: vendor-bills vs invoices ---");

  const { json: vendorListJson } = await api("/api/invoices?direction=VENDOR");
  check(
    "direction=VENDOR list includes the created bill",
    (vendorListJson.data as { id: string }[]).some((i) => i.id === bill.id),
    `count=${vendorListJson.data.length}`
  );
  check(
    "direction=VENDOR list contains only VENDOR-direction rows",
    (vendorListJson.data as { direction: string }[]).every((i) => i.direction === "VENDOR"),
    "every row returned by direction=VENDOR should itself be direction: VENDOR"
  );

  const { json: customerListJson } = await api("/api/invoices?direction=CUSTOMER");
  check(
    "direction=CUSTOMER list excludes the VENDOR bill just created",
    !(customerListJson.data as { id: string }[]).some((i) => i.id === bill.id),
    `count=${customerListJson.data.length}`
  );
  check(
    "direction=CUSTOMER list contains only CUSTOMER-direction rows",
    (customerListJson.data as { direction: string }[]).every((i) => i.direction === "CUSTOMER"),
    "every row returned by direction=CUSTOMER should itself be direction: CUSTOMER"
  );

  const { body: vendorBillsPageBody } = await html("/accounting/vendor-bills");
  check(
    "/accounting/vendor-bills page HTML includes the created bill's number",
    vendorBillsPageBody.includes(bill.invoiceNumber),
    `invoiceNumber=${bill.invoiceNumber}`
  );
  const { body: invoicesPageBody } = await html("/accounting/invoices");
  check(
    "/accounting/invoices page HTML does NOT include the vendor bill's number",
    !invoicesPageBody.includes(bill.invoiceNumber),
    `invoiceNumber=${bill.invoiceNumber} should not leak into the Customer Invoice list`
  );

  // ============================================================
  // 4. Detail page — line items, totals, status-based actions per status
  // ============================================================
  console.log("\n--- Vendor bill detail page renders per status ---");

  const { body: draftDetailBody } = await html(`/accounting/vendor-bills/${bill.id}`);
  check(
    "DRAFT bill detail shows the line item and grand total",
    draftDetailBody.includes("TEST VB line") && draftDetailBody.includes("2400.00"),
    "line description and grandTotal (2400.00) should appear"
  );
  check(
    "DRAFT bill detail shows Post and Cancel actions",
    draftDetailBody.includes(">Post<") && draftDetailBody.includes(">Cancel<"),
    "DRAFT should offer Post/Cancel via the reused InvoiceDetailActions"
  );
  check(
    "DRAFT bill detail has no Print button/link (out of scope for Vendor Bill)",
    !draftDetailBody.includes(">Print<"),
    "Vendor Bill detail page should not offer Print"
  );

  const { res: postRes } = await api(`/api/invoices/${bill.id}/post`, { method: "POST" });
  check("Post succeeds (setup)", postRes.ok, `status=${postRes.status}`);

  const { body: postedDetailBody } = await html(`/accounting/vendor-bills/${bill.id}`);
  check(
    "POSTED bill detail shows Record Payment and Reverse, pointed at /accounting/vendor-bills",
    postedDetailBody.includes(`/accounting/vendor-bills/${bill.id}/payments/new`) &&
      postedDetailBody.includes(">Reverse<"),
    "Record Payment link should use the vendor-bills basePath, not /accounting/invoices"
  );

  const { res: payRes, json: payJson } = await api(`/api/invoices/${bill.id}/payments`, {
    method: "POST",
    body: JSON.stringify({
      amount: 2400,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
    }),
  });
  check("Payment succeeds (setup)", payRes.status === 201, `status=${payRes.status} body=${JSON.stringify(payJson)}`);

  const { body: paidDetailBody } = await html(`/accounting/vendor-bills/${bill.id}`);
  check(
    "PAID bill detail shows the payment in payment history",
    paidDetailBody.includes("2400.00"),
    "payment amount (2400.00) should appear in the payment history table"
  );
  check(
    "PAID bill detail shows no action buttons",
    !paidDetailBody.includes(">Post<") &&
      !paidDetailBody.includes(">Cancel<") &&
      !paidDetailBody.includes("Record Payment") &&
      !paidDetailBody.includes(">Reverse<"),
    "PAID should render no action buttons per InvoiceDetailActions"
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
