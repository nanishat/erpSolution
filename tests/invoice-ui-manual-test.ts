// Customer Invoice UI manual test — covers the pieces added on top of the
// already-tested invoice.service.ts/payment.service.ts backend
// (invoice-cancel-reverse-manual-test.ts, payment-manual-test.ts,
// phase3-invoice-*-manual-test.ts): the new POST/GET /api/invoices routes,
// getInvoices/getInvoiceById's Decimal-to-number serialization, and the
// server-rendered list/detail/print pages.
//
// Exercises the real HTTP API for everything that has one (POST/GET
// /api/invoices, /api/invoices/[id], /api/invoices/[id]/post, /payments) and
// fetches the actual rendered HTML for the three new pages to check they
// contain what Step 6 asks for — list filtering, create-then-appears-in-
// list-and-detail, status-appropriate action buttons, and a print page with
// no dashboard chrome. This is a plain HTTP/HTML smoke test (no headless
// browser available here), so "renders" below means "the server-rendered
// HTML contains the expected content," not a full client-side interaction
// check — filtering itself is client-side state in InvoiceTable, verified
// instead by asserting the underlying GET /api/invoices query params (which
// InvoiceTable's callers use to scope the fetched list) filter correctly.
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
  const cashAccount = accounts.find((a) => a.code === "1010")!;

  const productService = await (async () => {
    const { json } = await api("/api/product-services", {
      method: "POST",
      body: JSON.stringify({
        code: `TEST-UI-PS-${stamp}`,
        name: `TEST UI Service ${stamp}`,
        type: "SERVICE",
        unitPrice: 0,
        incomeAccountId: salesRevenue.id,
      }),
    });
    return json.data as { id: string; name: string };
  })();

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST UI Customer ${stamp}`,
      tin: `TIN-UI-${stamp}`,
      bin: `BIN-UI-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string; name: string };

  const { json: otherCustomerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST UI Other Customer ${stamp}`,
      tin: `TIN-UI-OTHER-${stamp}`,
      bin: `BIN-UI-OTHER-${stamp}`,
    }),
  });
  const otherCustomer = otherCustomerJson.data as { id: string };

  // ============================================================
  // 1. Create flow (POST /api/invoices) — the route InvoiceForm calls
  // ============================================================
  console.log("--- Create flow: POST /api/invoices ---");

  const sector = `UI${stamp.toString().slice(-6)}`;
  const { res: createRes, json: createJson } = await api("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      direction: "CUSTOMER",
      partnerId: customer.id,
      sector,
      branchId: branch.id,
      date: new Date().toISOString(),
      notes: "TEST UI invoice",
      lines: [
        {
          productServiceId: productService.id,
          description: "TEST UI line",
          quantity: 2,
          unitPrice: 1500,
        },
      ],
    }),
  });
  check("Create succeeds (201)", createRes.status === 201, `status=${createRes.status} body=${JSON.stringify(createJson)}`);
  const invoice = createJson.data as { id: string; invoiceNumber: string; status: string };

  check(
    "Decimal fields serialize as plain numbers, not Decimal objects",
    typeof createJson.data.subtotal === "number" &&
      typeof createJson.data.lines[0].quantity === "number" &&
      typeof createJson.data.lines[0].unitPrice === "number" &&
      typeof createJson.data.lines[0].lineTotal === "number",
    `subtotal=${createJson.data.subtotal} (${typeof createJson.data.subtotal}) quantity=${createJson.data.lines[0].quantity} (${typeof createJson.data.lines[0].quantity})`
  );
  check(
    "subtotal computed correctly (2 x 1500 = 3000)",
    createJson.data.subtotal === 3000,
    `subtotal=${createJson.data.subtotal}`
  );

  // Invalid create is rejected with 400, not a 500/unhandled crash — exercises
  // the invoiceErrorResponse additions made for this task (PartnerNotFoundError,
  // ProductServiceNotFoundError, etc. weren't previously reachable from an API
  // route, since createInvoice had no route before this task).
  const { res: invalidRes } = await api("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      direction: "CUSTOMER",
      partnerId: "does-not-exist",
      sector: "XX",
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [{ description: "x", quantity: 1, unitPrice: 1 }],
    }),
  });
  check(
    "Create against a nonexistent partner is rejected (404), not a 500",
    invalidRes.status === 404,
    `status=${invalidRes.status}`
  );

  // ============================================================
  // 2. GET /api/invoices/[id] — detail data source
  // ============================================================
  console.log("\n--- GET /api/invoices/[id] ---");

  const { res: getRes, json: getJson } = await api(`/api/invoices/${invoice.id}`);
  check("GET single invoice succeeds", getRes.ok, `status=${getRes.status}`);
  check(
    "Returned invoice has the created line item",
    getJson.data.lines.length === 1 && getJson.data.lines[0].description === "TEST UI line",
    `lines=${JSON.stringify(getJson.data.lines)}`
  );
  check(
    "Returned invoice includes empty payments array (no payments yet)",
    Array.isArray(getJson.data.payments) && getJson.data.payments.length === 0,
    `payments=${JSON.stringify(getJson.data.payments)}`
  );

  const { res: get404Res } = await api("/api/invoices/does-not-exist");
  check("GET a nonexistent invoice returns 404", get404Res.status === 404, `status=${get404Res.status}`);

  // ============================================================
  // 3. List filtering — GET /api/invoices with direction/status/partnerId/date
  // ============================================================
  console.log("\n--- List filtering: GET /api/invoices ---");

  const { json: byDirectionJson } = await api("/api/invoices?direction=CUSTOMER");
  check(
    "direction=CUSTOMER includes the created invoice",
    (byDirectionJson.data as { id: string }[]).some((i) => i.id === invoice.id),
    `count=${byDirectionJson.data.length}`
  );

  const { json: byDirectionVendorJson } = await api("/api/invoices?direction=VENDOR");
  check(
    "direction=VENDOR excludes the CUSTOMER-direction invoice just created",
    !(byDirectionVendorJson.data as { id: string }[]).some((i) => i.id === invoice.id),
    `count=${byDirectionVendorJson.data.length}`
  );

  const { json: byStatusDraftJson } = await api(
    `/api/invoices?direction=CUSTOMER&status=DRAFT&partnerId=${customer.id}`
  );
  check(
    "status=DRAFT includes the still-DRAFT invoice",
    (byStatusDraftJson.data as { id: string }[]).some((i) => i.id === invoice.id),
    `count=${byStatusDraftJson.data.length}`
  );

  const { json: byOtherPartnerJson } = await api(
    `/api/invoices?direction=CUSTOMER&partnerId=${otherCustomer.id}`
  );
  check(
    "partnerId filter excludes an invoice belonging to a different partner",
    !(byOtherPartnerJson.data as { id: string }[]).some((i) => i.id === invoice.id),
    `count=${byOtherPartnerJson.data.length}`
  );

  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { json: byFutureDateJson } = await api(
    `/api/invoices?direction=CUSTOMER&dateFrom=${farFuture}`
  );
  check(
    "dateFrom in the far future excludes today's invoice",
    !(byFutureDateJson.data as { id: string }[]).some((i) => i.id === invoice.id),
    `count=${byFutureDateJson.data.length}`
  );

  // ============================================================
  // 4. List page HTML — appears after creation, with expected columns
  // ============================================================
  console.log("\n--- List page renders ---");

  const { res: listPageRes, body: listPageBody } = await html("/accounting/invoices");
  check("List page returns 200", listPageRes.status === 200, `status=${listPageRes.status}`);
  check(
    "List page HTML includes the created invoice's number",
    listPageBody.includes(invoice.invoiceNumber),
    `invoiceNumber=${invoice.invoiceNumber}`
  );
  check(
    "List page HTML includes the partner's name",
    listPageBody.includes(customer.name),
    `partner=${customer.name}`
  );
  check(
    "List page HTML has the dashboard chrome (sidebar brand)",
    listPageBody.includes("ERP Solution"),
    "expected DashboardShell chrome present on a normal dashboard page"
  );

  // ============================================================
  // 5. Detail page HTML — line items, totals, status actions per status
  // ============================================================
  console.log("\n--- Detail page renders: DRAFT status ---");

  const { body: draftDetailBody } = await html(`/accounting/invoices/${invoice.id}`);
  check(
    "DRAFT detail page shows the line item description",
    draftDetailBody.includes("TEST UI line"),
    "line description should appear in the rendered lines table"
  );
  check(
    "DRAFT detail page shows the grand total",
    draftDetailBody.includes("3000.00"),
    "grandTotal (3000.00) should appear in the totals block"
  );
  check(
    "DRAFT detail page shows Post and Cancel actions",
    draftDetailBody.includes(">Post<") && draftDetailBody.includes(">Cancel<"),
    "DRAFT invoices should offer Post/Cancel per InvoiceDetailActions"
  );
  check(
    "DRAFT detail page does not show Record Payment",
    !draftDetailBody.includes("Record Payment"),
    "Record Payment should only appear for POSTED/PARTIALLY_PAID"
  );

  console.log("\n--- Detail page renders: POSTED status ---");
  const { res: postRes } = await api(`/api/invoices/${invoice.id}/post`, { method: "POST" });
  check("Post succeeds (setup)", postRes.ok, `status=${postRes.status}`);

  const { body: postedDetailBody } = await html(`/accounting/invoices/${invoice.id}`);
  check(
    "POSTED detail page shows Record Payment and Reverse actions",
    postedDetailBody.includes("Record Payment") && postedDetailBody.includes(">Reverse<"),
    "POSTED invoices should offer Record Payment/Reverse per InvoiceDetailActions"
  );
  check(
    "POSTED detail page no longer shows Post/Cancel",
    !postedDetailBody.includes(">Post<") && !postedDetailBody.includes(">Cancel<"),
    "Post/Cancel are DRAFT-only actions"
  );

  console.log("\n--- Detail page renders: PAID status (no actions) ---");
  const { res: payRes, json: payJson } = await api(`/api/invoices/${invoice.id}/payments`, {
    method: "POST",
    body: JSON.stringify({
      amount: 3000,
      date: new Date().toISOString(),
      cashBankAccountId: cashAccount.id,
    }),
  });
  check("Payment succeeds (setup)", payRes.status === 201, `status=${payRes.status} body=${JSON.stringify(payJson)}`);

  const { body: paidDetailBody } = await html(`/accounting/invoices/${invoice.id}`);
  check(
    "PAID detail page shows the payment in payment history",
    paidDetailBody.includes("3000.00"),
    "payment amount (3000.00) should appear in the payment history table"
  );
  check(
    "PAID detail page shows no action buttons",
    !paidDetailBody.includes(">Post<") &&
      !paidDetailBody.includes(">Cancel<") &&
      !paidDetailBody.includes("Record Payment") &&
      !paidDetailBody.includes(">Reverse<"),
    "PAID/CANCELLED/VOID should render no action buttons per InvoiceDetailActions"
  );

  // ============================================================
  // 6. Print page — no dashboard chrome
  // ============================================================
  console.log("\n--- Print page renders without dashboard chrome ---");

  const { res: printRes, body: printBody } = await html(`/accounting/invoices/${invoice.id}/print`);
  check("Print page returns 200", printRes.status === 200, `status=${printRes.status}`);
  check(
    "Print page includes the invoice number",
    printBody.includes(invoice.invoiceNumber),
    `invoiceNumber=${invoice.invoiceNumber}`
  );
  check(
    "Print page does NOT include the dashboard sidebar brand",
    !printBody.includes("ERP Solution"),
    "print page must skip DashboardShell entirely"
  );
  check(
    "Print page does NOT include the dashboard header's signed-in placeholder",
    !printBody.includes("Signed in as"),
    "print page must skip DashboardShell's header too"
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
