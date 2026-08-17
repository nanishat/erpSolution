// JournalEntryMustPostViaInvoiceError / JournalEntryMustEditViaInvoiceError
// manual test — service-layer guards closing two data-integrity gaps found
// across two previous sessions: an Invoice's eagerly-created DRAFT
// JournalEntry could previously be posted OR edited directly via the
// generic POST /api/journal-entries/[id]/post and PATCH
// /api/journal-entries/[id] (the same endpoints the general journal entries
// list's "Post"/"Edit" actions hit). Posting that way flips the ledger live
// while completely skipping postInvoice's own Invoice.status transition and
// Partner balance update; editing that way silently diverges the entry's
// lines from Invoice.subtotal/lines, which are computed and stored
// independently on the Invoice row. See journal-entry.service.ts
// (postJournalEntryWithClient's invoice-link check + the internal-only
// postInvoiceLinkedJournalEntry bypass postInvoice uses for its own posting
// step; updateJournalEntry's invoice-link check, which has NO bypass since
// nothing legitimately calls it on an invoice-linked entry today — Invoice
// has no updateInvoice function yet).
//
// The Payment case does NOT need either guard, and is deliberately not
// tested here: recordPayment (payment.service.ts) creates and posts its
// JournalEntry back-to-back inside the SAME transaction
// (createJournalEntry(tx) immediately followed by postJournalEntry(tx), no
// intervening commit) — a Payment-linked JournalEntry is never visible to
// any other request in a DRAFT state; it is either already POSTED by the
// time anything else could observe it, or the whole transaction rolled back
// and the row never existed. There is no window for the generic Post/Edit
// actions to ever reach one, and Payment has no update path at all.
//
// Exercises the real HTTP API: POST /api/journal-entries/[id]/post,
// PATCH /api/journal-entries/[id], POST /api/invoices/[id]/post,
// POST /api/journal-entries. Invoice creation still goes through
// createInvoice directly (same deviation as the other Phase 3 invoice
// scripts — no createInvoice API/UI layer yet). UI checks fetch rendered
// HTML (not the RSC hydration payload) — same footgun/fix documented in
// product-service-ui-manual-test.ts's `appearsRendered` helper.
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

async function postJournalEntryDirectlyViaApi(id: string) {
  return api(`/api/journal-entries/${id}/post`, { method: "POST" });
}

async function patchJournalEntryViaApi(id: string, body: Record<string, unknown>) {
  return api(`/api/journal-entries/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function postInvoiceViaApi(id: string) {
  return api(`/api/invoices/${id}/post`, { method: "POST" });
}

async function getJournalEntryState(id: string) {
  const entry = await db.journalEntry.findUniqueOrThrow({ where: { id } });
  return { status: entry.status };
}

async function getJournalEntryLines(id: string) {
  const lines = await db.journalLine.findMany({
    where: { journalEntryId: id },
    orderBy: { id: "asc" },
  });
  return lines.map((line) => ({
    accountId: line.accountId,
    debit: Number(line.debit),
    credit: Number(line.credit),
  }));
}

async function getInvoiceState(id: string) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id } });
  return { status: invoice.status };
}

async function page(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  return { res, html };
}

// Matches the actual rendered text, not the JSON-escaped RSC hydration
// payload also present in the document — same footgun documented in
// product-service-ui-manual-test.ts.
function appearsRendered(html: string, text: string): boolean {
  return html.includes(`>${text}<`);
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
  check(
    "Cash account (1010) exists (run prisma/seed-coa.ts first if this fails)",
    Boolean(cashAccount) && cashAccount.subType === "CASH",
    `cashAccount=${cashAccount?.id} subType=${cashAccount?.subType}`
  );

  const customerProductService = await db.productService.create({
    data: {
      code: `TEST-JEGUARD-PS-${stamp}`,
      name: `TEST JE Guard Product Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST JE Guard Customer ${stamp}`,
      tin: `TIN-JEGUARD-${stamp}`,
      bin: `BIN-JEGUARD-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  // ============================================================
  // 1. Posting an invoice-linked JournalEntry directly is rejected
  // ============================================================
  console.log("--- Posting an invoice-linked JournalEntry directly (bypassing postInvoice) ---");

  const invoice = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector: `JG${stamp.toString().slice(-6)}`,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      {
        productServiceId: customerProductService.id,
        description: "JE guard test line",
        quantity: 1,
        unitPrice: 5000,
      },
    ],
  });

  const { res: directPostRes, json: directPostJson } = await postJournalEntryDirectlyViaApi(
    invoice.journalEntryId
  );
  check(
    "Direct post of the invoice's JournalEntry is rejected with 409",
    directPostRes.status === 409,
    `status=${directPostRes.status} body=${JSON.stringify(directPostJson)}`
  );
  check(
    "Rejection message identifies the invoice and points to the invoice-post endpoint",
    typeof directPostJson.error === "string" &&
      directPostJson.error.includes(invoice.invoiceNumber) &&
      directPostJson.error.includes(`/api/invoices/${invoice.id}/post`),
    `error=${directPostJson.error}`
  );

  const entryStateAfterRejectedDirectPost = await getJournalEntryState(invoice.journalEntryId);
  const invoiceStateAfterRejectedDirectPost = await getInvoiceState(invoice.id);
  check(
    "Rejected direct post left the JournalEntry untouched: still DRAFT",
    entryStateAfterRejectedDirectPost.status === "DRAFT",
    `status=${entryStateAfterRejectedDirectPost.status}`
  );
  check(
    "Rejected direct post left the Invoice untouched: still DRAFT",
    invoiceStateAfterRejectedDirectPost.status === "DRAFT",
    `status=${invoiceStateAfterRejectedDirectPost.status}`
  );

  // ============================================================
  // 2. postInvoice itself still works end-to-end after the guard
  // ============================================================
  console.log("\n--- postInvoice still works end-to-end ---");

  const { res: postInvoiceRes, json: postInvoiceJson } = await postInvoiceViaApi(invoice.id);
  check(
    "postInvoice succeeds despite the new guard (it uses the internal bypass)",
    postInvoiceRes.ok,
    `status=${postInvoiceRes.status} body=${JSON.stringify(postInvoiceJson)}`
  );
  check(
    "Invoice status -> POSTED",
    postInvoiceJson.data?.status === "POSTED",
    `status=${postInvoiceJson.data?.status}`
  );

  const entryStateAfterInvoicePost = await getJournalEntryState(invoice.journalEntryId);
  check(
    "The invoice's JournalEntry is now POSTED",
    entryStateAfterInvoicePost.status === "POSTED",
    `status=${entryStateAfterInvoicePost.status}`
  );

  // Now that it's POSTED, the generic direct-post path should reject it for
  // the ordinary "already posted" reason, not the invoice-link guard —
  // confirms the guard only fires on a still-DRAFT invoice-linked entry.
  const { res: repostRes, json: repostJson } = await postJournalEntryDirectlyViaApi(
    invoice.journalEntryId
  );
  check(
    "Re-posting the now-POSTED entry directly is rejected as already-posted (not the invoice-link error)",
    repostRes.status === 409 && !String(repostJson.error).includes("cannot be posted directly"),
    `status=${repostRes.status} body=${JSON.stringify(repostJson)}`
  );

  // ============================================================
  // 3. A normal voucher's JournalEntry (no linked Invoice) still posts
  //    exactly as before
  // ============================================================
  console.log("\n--- A normal voucher (no linked Invoice) still posts normally ---");

  const { res: createVoucherRes, json: createVoucherJson } = await api("/api/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      date: new Date().toISOString(),
      description: `TEST JE guard voucher ${stamp}`,
      branchId: branch.id,
      voucherType: "JOURNAL_VOUCHER",
      lines: [
        { accountId: cashAccount.id, branchId: branch.id, debit: 500, credit: 0 },
        { accountId: salesRevenue.id, branchId: branch.id, debit: 0, credit: 500 },
      ],
    }),
  });
  check(
    "Creating a plain voucher succeeds",
    createVoucherRes.status === 201,
    `status=${createVoucherRes.status} body=${JSON.stringify(createVoucherJson)}`
  );
  const voucherEntry = createVoucherJson.data as { id: string };

  const { res: postVoucherRes, json: postVoucherJson } = await postJournalEntryDirectlyViaApi(
    voucherEntry.id
  );
  check(
    "Posting the plain voucher directly still succeeds (unaffected by the invoice guard)",
    postVoucherRes.ok,
    `status=${postVoucherRes.status} body=${JSON.stringify(postVoucherJson)}`
  );
  check(
    "Voucher status -> POSTED",
    postVoucherJson.data?.status === "POSTED",
    `status=${postVoucherJson.data?.status}`
  );

  // ============================================================
  // 4. Editing an invoice-linked JournalEntry directly is rejected
  // ============================================================
  console.log("\n--- Editing an invoice-linked JournalEntry directly (PATCH) ---");

  const invoiceForEditTest = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector: `JE${stamp.toString().slice(-6)}`,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [
      {
        productServiceId: customerProductService.id,
        description: "JE guard edit test line",
        quantity: 1,
        unitPrice: 3000,
      },
    ],
  });

  const linesBeforeEditAttempt = await getJournalEntryLines(invoiceForEditTest.journalEntryId);

  const { res: patchRes, json: patchJson } = await patchJournalEntryViaApi(
    invoiceForEditTest.journalEntryId,
    {
      date: new Date().toISOString(),
      description: "TEST: attempted tamper of an invoice-linked entry",
      lines: [
        { accountId: cashAccount.id, branchId: branch.id, debit: 999, credit: 0 },
        { accountId: salesRevenue.id, branchId: branch.id, debit: 0, credit: 999 },
      ],
    }
  );
  check(
    "PATCH on an invoice-linked JournalEntry is rejected with 409",
    patchRes.status === 409,
    `status=${patchRes.status} body=${JSON.stringify(patchJson)}`
  );
  check(
    "Rejection message identifies the invoice and says edits aren't allowed directly",
    typeof patchJson.error === "string" &&
      patchJson.error.includes(invoiceForEditTest.invoiceNumber) &&
      patchJson.error.includes("cannot be edited directly"),
    `error=${patchJson.error}`
  );

  const linesAfterRejectedEdit = await getJournalEntryLines(invoiceForEditTest.journalEntryId);
  check(
    "The entry's lines are unchanged by the rejected edit attempt",
    JSON.stringify(linesAfterRejectedEdit) === JSON.stringify(linesBeforeEditAttempt),
    `before=${JSON.stringify(linesBeforeEditAttempt)} after=${JSON.stringify(linesAfterRejectedEdit)}`
  );

  // ============================================================
  // 5. A normal voucher's JournalEntry (no linked Invoice) can still be
  //    edited exactly as before
  // ============================================================
  console.log("\n--- A normal voucher (no linked Invoice) can still be edited ---");

  const { json: createEditableVoucherJson } = await api("/api/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      date: new Date().toISOString(),
      description: `TEST JE guard editable voucher ${stamp}`,
      branchId: branch.id,
      voucherType: "JOURNAL_VOUCHER",
      lines: [
        { accountId: cashAccount.id, branchId: branch.id, debit: 200, credit: 0 },
        { accountId: salesRevenue.id, branchId: branch.id, debit: 0, credit: 200 },
      ],
    }),
  });
  const editableVoucherEntry = createEditableVoucherJson.data as { id: string };

  const { res: editVoucherRes, json: editVoucherJson } = await patchJournalEntryViaApi(
    editableVoucherEntry.id,
    {
      date: new Date().toISOString(),
      description: "TEST: edited plain voucher description",
      lines: [
        { accountId: cashAccount.id, branchId: branch.id, debit: 250, credit: 0 },
        { accountId: salesRevenue.id, branchId: branch.id, debit: 0, credit: 250 },
      ],
    }
  );
  check(
    "Editing the plain voucher directly still succeeds (unaffected by the invoice guard)",
    editVoucherRes.ok,
    `status=${editVoucherRes.status} body=${JSON.stringify(editVoucherJson)}`
  );
  check(
    "Edited voucher's description is updated",
    editVoucherJson.data?.description === "TEST: edited plain voucher description",
    `description=${editVoucherJson.data?.description}`
  );

  const editedVoucherLines = await getJournalEntryLines(editableVoucherEntry.id);
  check(
    "Edited voucher's lines reflect the new amounts (250, not 200)",
    editedVoucherLines.some((line) => line.debit === 250) &&
      editedVoucherLines.some((line) => line.credit === 250),
    `lines=${JSON.stringify(editedVoucherLines)}`
  );

  // ============================================================
  // 6. UI check: Edit action is hidden for invoice-linked entries, still
  //    shown for a plain DRAFT voucher (rendered HTML, not RSC payload)
  // ============================================================
  console.log("\n--- UI: Edit action hidden for invoice-linked entries ---");

  const { html: listHtml } = await page("/accounting");
  check(
    "The invoice-linked entry's row shows the 'Belongs to Invoice' note on the list page",
    listHtml.includes(`Belongs to Invoice`) && listHtml.includes(invoiceForEditTest.invoiceNumber),
    `looked for invoice note referencing ${invoiceForEditTest.invoiceNumber}`
  );
  // A DRAFT plain voucher was created above without ever posting it — reuse
  // a freshly created one here so there's a guaranteed-DRAFT, non-invoice
  // row to assert the Edit link/Post button ARE still rendered for.
  const { json: createStillDraftVoucherJson } = await api("/api/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      date: new Date().toISOString(),
      description: `TEST JE guard still-draft voucher ${stamp}`,
      branchId: branch.id,
      voucherType: "JOURNAL_VOUCHER",
      lines: [
        { accountId: cashAccount.id, branchId: branch.id, debit: 100, credit: 0 },
        { accountId: salesRevenue.id, branchId: branch.id, debit: 0, credit: 100 },
      ],
    }),
  });
  const stillDraftVoucher = createStillDraftVoucherJson.data as { id: string; documentNumber: string };
  const { html: listHtmlAfter } = await page("/accounting");
  check(
    "A plain DRAFT voucher's row still renders an Edit link on the list page",
    appearsRendered(listHtmlAfter, "Edit") &&
      listHtmlAfter.includes(`/accounting/journal-entries/${stillDraftVoucher.id}/edit`),
    `looked for an edit link to /accounting/journal-entries/${stillDraftVoucher.id}/edit`
  );

  const { html: detailHtml } = await page(
    `/accounting/journal-entries/${invoiceForEditTest.journalEntryId}`
  );
  check(
    "The invoice-linked entry's detail page shows the 'Belongs to Invoice' note, not an Edit button",
    detailHtml.includes("Belongs to Invoice") &&
      detailHtml.includes(invoiceForEditTest.invoiceNumber) &&
      !appearsRendered(detailHtml, "Edit"),
    `looked for invoice note and absence of rendered ">Edit<"`
  );

  const { html: editPageHtml } = await page(
    `/accounting/journal-entries/${invoiceForEditTest.journalEntryId}/edit`
  );
  check(
    "Navigating directly to the invoice-linked entry's edit URL shows a rejection message, not the form",
    editPageHtml.includes("cannot be edited directly") &&
      editPageHtml.includes(invoiceForEditTest.invoiceNumber) &&
      // id="description" is JournalEntryForm's own description input — not
      // to be confused with the root layout's unrelated
      // <meta name="description" content="...">, which is always present.
      !editPageHtml.includes('id="description"'),
    `looked for rejection message and absence of the form's description field`
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
