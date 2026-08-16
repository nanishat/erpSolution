// JournalEntryMustPostViaInvoiceError manual test — the service-layer guard
// closing a data-integrity gap found in a previous session: an Invoice's
// eagerly-created DRAFT JournalEntry could previously be posted directly via
// the generic POST /api/journal-entries/[id]/post (the same endpoint the
// general journal entries list's "Post" button hits), which flips the
// ledger live while completely skipping postInvoice's own Invoice.status
// transition and Partner balance update. See journal-entry.service.ts
// (postJournalEntryWithClient's invoice-link check, and
// postInvoiceLinkedJournalEntry — the internal-only bypass postInvoice uses
// for its own, sanctioned posting step).
//
// The Payment case does NOT need the same guard, and is deliberately not
// tested here: recordPayment (payment.service.ts) creates and posts its
// JournalEntry back-to-back inside the SAME transaction
// (createJournalEntry(tx) immediately followed by postJournalEntry(tx), no
// intervening commit) — a Payment-linked JournalEntry is never visible to
// any other request in a DRAFT state; it is either already POSTED by the
// time anything else could observe it, or the whole transaction rolled back
// and the row never existed. There is no window for the generic Post button
// to ever reach one.
//
// Exercises the real HTTP API: POST /api/journal-entries/[id]/post,
// POST /api/invoices/[id]/post, POST /api/journal-entries. Invoice creation
// still goes through createInvoice directly (same deviation as the other
// Phase 3 invoice scripts — no createInvoice API/UI layer yet).
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

async function postInvoiceViaApi(id: string) {
  return api(`/api/invoices/${id}/post`, { method: "POST" });
}

async function getJournalEntryState(id: string) {
  const entry = await db.journalEntry.findUniqueOrThrow({ where: { id } });
  return { status: entry.status };
}

async function getInvoiceState(id: string) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id } });
  return { status: invoice.status };
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
