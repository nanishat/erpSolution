# Manual/dev-DB test scripts

These are **not** unit tests and there's no test runner wired up yet — each
script is a standalone Node script (run with `tsx`) that exercises the real
app against your local dev database. They're meant to be run by hand while
`npm run dev` is up, and kept around as a reusable, growing suite rather than
written-then-deleted.

Everything here talks to the app the way a real client would: HTTP calls
against the actual Next.js API routes (not direct Prisma writes bypassing
the service layer), except for read-only reference-data lookups where no API
route exists yet (noted per-script).

## Running a script

1. Make sure the dev server is running: `npm run dev` (defaults to
   `http://localhost:3000`; override with `DEV_SERVER_URL` if it's running
   elsewhere).
2. Make sure `DATABASE_URL` in `.env` points at the dev DB you want to hit —
   these scripts create and post real rows there.
3. Run with `npx tsx tests/<script>.ts` from the project root.

Each script prints `PASS -` / `FAIL -` lines per assertion and a final
`=== N passed, M failed ===` summary, plus the actual numbers it checked
(not just pass/fail) so you can eyeball the data.

## Scripts

### `phase1-ledger-manual-test.ts`

End-to-end pass through the Phase 1 Core Ledger Engine: creates one journal
entry per voucher type (2x Cash Voucher — money in and out, 1x Debit
Voucher, 1x Credit Voucher, 1x multi-line Journal Voucher touching the
Suspense Account), posts every one of them via `POST
/api/journal-entries/[id]/post`, reverses one via `POST
/api/journal-entries/[id]/reverse`, then pulls `GET
/api/reports/trial-balance` and checks:

- Grand total debit = grand total credit (`isBalanced: true`)
- The Suspense Account line has the right debit/credit
- The reversed entry's net effect is zero (gross activity still shows on
  both sides, but nets out)
- Every account touched shows the expected totals
- The branch filter and date-range filter actually narrow results (not just
  "doesn't error") — verified by comparing filtered totals against a known
  baseline and against a deliberately-non-matching filter value

Reads branches directly via Prisma (predates the `/api/branches` route added
in the follow-up fixes pass below) and accounts via `GET /api/accounts`.

**This script does not clean up after itself** — the entries it creates
stay in the dev DB (POSTED, with one VOID + reversal pair) unless you delete
them yourself. It's safe to re-run; each run just adds another batch (postings
are idempotent-safe since each run creates new documents rather than mutating
existing ones).

### `phase1-followup-fixes-test.ts`

Covers the three fixes made after the Phase 1 review:

- `GET /api/branches` returns the same branches as a direct DB read
- `/` (site root) responds with a redirect to `/accounting`
- Reversing an **original** entry still works (regression check against the
  new restriction)
- Reversing a **reversal** entry is rejected with `409` and a
  `CannotReverseAReversalError` message, the reversal's status is left
  untouched by the rejected attempt, and neither the reversal's nor the
  (now-VOID) original's detail page renders a "Reverse" button

Reads branches/accounts directly via Prisma for setting up the test fixture
(creating the entry to reverse); everything else goes through the real API.
Same no-cleanup convention as `phase1-ledger-manual-test.ts`.

### `phase2-partner-manual-test.ts`

Covers the Partner CRUD service/API layer added for Phase 2 (Partners & Tax
Engine):

- Creating a `CUSTOMER` and a `VENDOR` both succeed, and `type` round-trips
  correctly
- Creating a partner without `tin` or `bin` is rejected with `400` (both are
  required at the DB level, not just the Zod layer)
- Changing `type` via `PATCH` is rejected with `409` and leaves the existing
  row untouched; a same-value `type` in the PATCH body is not treated as a
  change
- Deactivating a partner (`DELETE`, soft delete via `isActive`) excludes it
  from the default `GET /api/partners` list but it's still fetchable by id,
  and reappears when `?isActive=false` is passed explicitly
- `localBranchId` validation: a real branch id is accepted, a nonexistent one
  is rejected with `400`

Reads `GET /api/branches` for fixture data; everything else goes through the
real API. Same no-cleanup convention as the Phase 1 scripts — partner rows
created by this script use a `TEST ... <timestamp>` name/TIN/BIN so re-runs
don't collide (no uniqueness constraint exists on those fields, so nothing
enforces this — it's just a naming convention for readability).

### `phase2-partner-ui-manual-test.ts`

Covers the Partner list/create/edit pages built on top of the CRUD API above
(`/accounting/partners`, `/accounting/partners/new`,
`/accounting/partners/[id]/edit` — nested under `/accounting` since Partners
is part of the accounting domain; see the nav-restructure note in
`phase2-nav-restructure-manual-test.ts`). There's no headless browser/JSDOM
runner set up, so — same as the "Reverse button hidden" check in
`phase1-followup-fixes-test.ts` — this fetches the server-rendered page HTML
directly and asserts on markup rather than driving a real browser:

- `/accounting/partners` responds `200` and renders the heading and a "New
  partner" link
- `/accounting/partners/new` renders inputs for every required field, and the
  `type` select is not disabled
- Creating a partner via `POST /api/partners` (the same endpoint the form's
  submit handler calls) makes it show up on the next render of
  `/accounting/partners`
- `/accounting/partners/[id]/edit` renders the partner's current name and its
  `type` select is disabled (type is immutable after creation)

Same no-cleanup convention and `TEST ... <timestamp>` naming as the other
scripts.

### `phase2-nav-restructure-manual-test.ts`

Covers the sidebar restructure that grouped accounting-domain pages (Journal
Entries, Chart of Accounts, Trial Balance, Partners) under one collapsible
"Accounting" section in `DashboardShell.tsx`, instead of Partners sitting as a
flat top-level item next to Accounting/HR/Inventory. Partners' page routes
moved from `/partners` to `/accounting/partners` as part of this (the API
routes are untouched — still `/api/partners`).

- Every current nav link resolves with `200`: `/accounting`,
  `/accounting/chart-of-accounts`, `/accounting/reports/trial-balance`,
  `/accounting/partners`, `/hr`, `/inventory`
- The old top-level `/partners` and `/partners/new` routes now 404
- The sidebar (checked via the server-rendered `/accounting` page) has a
  nested link to `/accounting/partners`, no bare `href="/partners"` link, and
  HR/Inventory remain top-level

No fixture data created, nothing to clean up — pure routing/markup checks.

### `phase2-tax-application-manual-test.ts`

Covers the VAT/TDS/VDS calculation service (`tax-application.service.ts`) and
the posting gate wired into `postJournalEntry`: `POST /api/tax-applications`,
`POST /api/tax-applications/[id]/approve`, `POST
/api/tax-applications/[id]/reject`, and their interaction with `POST
/api/journal-entries/[id]/post` and `.../reverse`.

- VAT from a `TaxRate`: `EXCLUSIVE` (no partner inclusive-price flag) computes
  `taxAmount = baseAmount * rate/100`; `INCLUSIVE` (partner
  `vatInclusiveInPrice: true`) back-calculates from a tax-inclusive
  `baseAmount` — both checked against a 15% rate landing on a round 150.00
  either way; `ratePercent` is denormalized from the picked `TaxRate` at
  creation time
- TDS with a manually-entered `ratePercent`: no `TaxRate`/`sourceTaxRateId`
  involved, `computationType` defaults to `EXCLUSIVE`
- Creating a TDS application for a `tdsExempt: true` partner is rejected with
  `409` (chosen over silently zeroing the rate — see the service's comment)
- Posting a journal entry with a `PENDING_REVIEW` tax application is rejected
  with `409` (`PendingTaxApprovalError`); approving it unblocks posting
- Re-approving/re-rejecting a tax application that's no longer
  `PENDING_REVIEW` is rejected with `409`
- Reversing a `POSTED` entry leaves its `APPROVED` `TaxApplication` untouched
  (still `APPROVED`, still pointing at the original now-`VOID` entry) — the
  chosen design: `TaxApplication.status` records whether the *calculation*
  was correct, not whether the parent transaction is still live (that's
  `JournalEntry.status`/`reversalOfEntryId`, already the source of truth)
- Reject flow: `rejectionReason` persists and re-rejecting is blocked

There's no admin CRUD API for `TaxRate` yet (out of scope for this prompt),
so the one `TaxRate` fixture this script needs is created directly via
Prisma — same convention as reading branches/accounts directly when no API
exists for them yet. Branches/accounts are read through `GET /api/branches`
/ `GET /api/accounts`; partners and journal entries go through their real
POST endpoints. Same no-cleanup convention and `TEST ... <timestamp>` naming
as the other scripts.

### `tax-application-draft-guard-manual-test.ts`

Phase 2 review follow-up: `createTaxApplication` previously only checked that
the target `JournalEntry` existed, not that it was still `DRAFT`. The UI
already guards this (Add Tax only renders for `DRAFT` entries), but a direct
API call could attach a `TaxApplication` to an already-`POSTED` or `VOID`
entry, whose tax would then never get picked up by `postJournalEntry` and
would silently never reach the ledger. Covers the new
`JournalEntryNotDraftError` guard:

- Attaching a `TaxApplication` to a `POSTED` entry is rejected with `409`,
  the error message names both the actual status and `DRAFT`, and no row is
  created
- Attaching a `TaxApplication` to a `VOID` entry (posted, then reversed) is
  rejected the same way
- Regression check: a `DRAFT` entry still accepts a `TaxApplication` exactly
  as before

Reads `GET /api/branches` / `GET /api/accounts` for fixture data; journal
entries and tax applications go through their real POST endpoints. Same
no-cleanup convention and `TEST ... <timestamp>` naming as the other scripts.

### `tax-rate-manual-test.ts`

Covers the admin CRUD service/API layer for `TaxRate` (`tax-rate.service.ts`)
— fills the gap flagged above ("no admin CRUD API for TaxRate yet"): `POST
/api/tax-rates`, `GET /api/tax-rates`, `GET /api/tax-rates/[id]`, `PATCH
/api/tax-rates/[id]`, `DELETE /api/tax-rates/[id]` (soft delete via
`isActive`).

- Create succeeds, `computationType` defaults to `EXCLUSIVE`, new rates start
  `isActive: true`
- `ratePercent` validation: fractional values (7.5) are accepted, values
  above 15 or below 0 are rejected with `400`
- Created rate shows up in the default list
- `PATCH` persists field changes; `PATCH`/`DELETE` on a nonexistent id are
  rejected with `404`
- Deactivating (`DELETE`) excludes the rate from the default `GET
  /api/tax-rates` list but it's still fetchable by id, and reappears when
  `?isActive=false` is passed explicitly — deactivation is never blocked by
  existing `TaxApplication` references, since those denormalize their own
  `ratePercent` at creation time (see the service's doc comment)

No fixtures needed from other modules — everything goes through the real
`/api/tax-rates` API. Same no-cleanup convention and `TEST ... <timestamp>`
naming as the other scripts.

### `phase3-tax-posting-manual-test.ts`

Covers `tax-posting.service.ts` — the logic that turns an `APPROVED`
`TaxApplication` into real `JournalLine`s on its parent `JournalEntry`,
wired into `postJournalEntryWithClient` (runs right before the entry flips
to `POSTED`, after the existing `PENDING_REVIEW` gate). Requires
`prisma/seed-tax-accounts.ts` to have been run first (VAT Payable/
Receivable, TDS/VDS Payable) — the script asserts these accounts exist
before doing anything else.

Design recap (see the service's doc comment for the full rationale):
- Tax lines are always added as an equal-and-opposite **pair** — one line on
  the tax application's resolved *settlement line* (the existing cash/bank/
  AR/AP leg already on the entry) and one on the tax account itself — so the
  entry's balance is preserved without ever touching its original lines.
- **VAT** extends the settlement line (Output VAT: settlement debit grows,
  e.g. Cash 1000 → 1150 collected; Input VAT: settlement credit grows, e.g.
  Cash paid 1000 → 1150). VAT Payable/Receivable are separate (unnetted)
  accounts, not a single VAT control account.
- **TDS/VDS** offsets the settlement line instead (an extra debit against
  the existing cash credit) — net cash paid out shrinks by the withheld
  amount while the expense is still recognized at its full, un-withheld
  value, and the withheld amount lands in TDS/VDS Payable.
- Settlement-line resolution is by account `subType` (`CASH`/`BANK`/
  `RECEIVABLE` for VAT Output and TDS/VDS-relevant debit checks, `CASH`/
  `BANK`/`PAYABLE` for VAT Input) + side, over the entry's *original* lines
  only. Requires exactly one match; 0 or 2+ throws rather than guessing.

What's checked, per tax type, using Trial Balance deltas against a
snapshot taken immediately before each entry is created (this dev DB is
shared and not cleaned up between runs, so absolute totals aren't
meaningful — only deltas are):
- **VAT Output** (sale-shaped entry: Cash debit / Sales Revenue credit):
  approve + post → VAT Payable credited exactly the tax amount, Cash's
  total debit grows by principal + tax (not just principal), Sales Revenue
  is untouched. Reverse → VAT Payable's net balance returns to its
  pre-entry snapshot, and — re-confirming the Step 0 design — the
  `TaxApplication` stays `APPROVED` and still points at the original
  (now-`VOID`) entry.
- **VAT Input** (purchase-shaped entry: Expense debit / Cash credit):
  same shape of checks, mirrored — VAT Receivable debited, Cash's total
  credit grows by principal + tax, nets back to zero on reversal.
- **TDS** (vendor-payment-shaped entry: Expense debit / Cash credit):
  approve + post → TDS Payable credited the tax amount, Cash shows *both*
  the full gross credit *and* a new offsetting debit (net effect: paid out
  = gross − withheld), Expense is still recognized at the full gross
  amount. Reverse → TDS Payable nets back to zero, `TaxApplication` stays
  `APPROVED`.
- **Negative case**: a `TaxApplication` on an entry with no cash/bank/AR/AP
  line at all (both lines are Expense/Revenue) is rejected at posting time
  with `400` and a message naming the missing settlement line — this
  fails loudly rather than silently skipping the tax posting.

Same no-cleanup convention and `TEST ... <timestamp>` naming as the other
scripts.

### `tax-approval-queue-ui-manual-test.ts`

Covers the Tax Approval Queue UI at `/accounting/tax-applications`
(`TaxApplicationTable.tsx`, backed by the new `listTaxApplications` read in
`tax-application.service.ts`) — UI only, built on top of the approve/reject
API already covered end-to-end by `phase2-tax-application-manual-test.ts`.
No headless-browser/JSDOM runner is wired up, so — same convention as
`phase2-partner-ui-manual-test.ts` — this fetches the server-rendered HTML
and asserts on markup rather than driving a real browser. The page's status
filter is a client-side React state default (`"PENDING_REVIEW"`), which
React still applies while rendering the initial HTML on the server, so a
plain fetch of the page already reflects the default-filtered view.

- Page renders: heading present, an `ALL` status filter option exists, and
  both fixture entries' document numbers appear (both start `PENDING_REVIEW`)
- Approve flow: `POST /api/tax-applications/[id]/approve` flips status to
  `APPROVED`, and the entry's document number disappears from the next
  fetch of the default-filtered page while the other, still-pending entry's
  document number remains
- Reject flow: `POST /api/tax-applications/[id]/reject` with a reason
  persists `rejectionReason` (checked via both the API response and a direct
  DB read) and the entry likewise disappears from the default-filtered view

Fixtures: reads `GET /api/branches` / `GET /api/accounts`, creates draft
entries via `POST /api/journal-entries` and `VDS` tax applications via `POST
/api/tax-applications` (manual `ratePercent`, no `TaxRate` fixture needed —
same choice as the "gate"/reject cases in
`phase2-tax-application-manual-test.ts`). Same no-cleanup convention and
`TEST ... <timestamp>` naming as the other scripts.

Presence/absence checks against the filtered view use an `appearsRendered`
helper (`html.includes(">value<")`), not a plain substring search — a plain
substring search produces a false failure here, because
`TaxApplicationTable` receives its full, unfiltered data as a client
component prop, and Next.js also embeds that as a serialized RSC payload
elsewhere in the same HTML document for hydration. The document number is
always present *somewhere* in the page source regardless of the visible
filter; only the rendered anchor text (`>value<`) reflects what's actually
shown in the table.

### `phase2-full-integration-manual-test.ts`

The Phase 2 (Partners & Tax Engine) capstone test — walks the actual UI/API
surface end to end across all three tax-tooling prompts, proving they're
wired together rather than three independent islands:

- **TaxRate admin UI** (`POST /api/tax-rates`, the endpoint `TaxRateForm`
  submits to) to enter a real VAT rate, then confirms it renders on
  `/accounting/tax-rates`
- **Add Tax on a voucher** (`POST /api/tax-applications`, the endpoint
  `AddTaxApplicationForm` submits to — see the "Add tax" action added to the
  journal entry detail page, previously the missing connective tissue
  between vouchers and tax) to attach the VAT application to a real draft
  journal entry, confirmed via the entry detail page's rendered markup
- **Approval Queue UI** (`POST /api/tax-applications/[id]/approve`, the
  endpoint the queue's Approve button calls) to approve it, confirmed by the
  entry disappearing from the queue's default-filtered rendered table
  (`appearsRendered` check, not a plain substring search — see the note
  above)
- Posting is rejected with `409` while `PENDING_REVIEW`, then succeeds once
  `APPROVED` — proving the approval gate is real, not just a status label
- Trial Balance deltas confirm VAT Payable is credited exactly the tax
  amount, Cash is extended by principal + tax, Sales Revenue is untouched;
  reversal nets VAT Payable back to its pre-entry balance
- Repeats the posting-gate -> approve -> post -> Trial Balance -> reverse
  sequence for a TDS application with a manually-entered rate (no `TaxRate`
  needed), confirming TDS Payable, Cash's gross-credit-plus-withholding-debit
  shape, and full (un-withheld) expense recognition

Requires `prisma/seed-tax-accounts.ts` to have been run first. Same
no-cleanup convention and `TEST ... <timestamp>` naming as the other
scripts; every Trial Balance assertion compares against a snapshot taken
immediately before the entry under test is created, not an assumed zero
baseline.

### `phase3-invoice-manual-test.ts`

Covers the Invoice draft creation service (`invoice.service.ts`) and its
invoice-number sequence (`invoice-document-sequence.service.ts`) — the first
Phase 3 (Invoicing & Billing) service. **Deviates** from every other script's
convention: Invoice creation has no API/UI layer yet (explicitly out of scope
for this prompt), so `createInvoice` is called directly against the dev DB
rather than through an HTTP endpoint. Inputs are still run through
`createInvoiceSchema` first (mirroring what a future API route will do), so
the Zod layer — including `sector`'s uppercase normalization — is exercised
too. ProductService likewise has no API/UI yet (schema-only Phase 3 catalog),
so its two fixtures are created directly via Prisma, same convention as
`phase2-tax-application-manual-test.ts`'s `TaxRate` fixture. Branch/account
lookups and the `CUSTOMER`/`VENDOR` partner fixtures go through the real API.

- Creating an invoice with 2 lines against 2 different `ProductService` rows
  (different `incomeAccountId`s each): invoice number format is
  `SECTOR/BranchCode/YYYYMM/0001` with `sector` uppercased from lowercase
  input; each line's `lineTotal = quantity * unitPrice`; `subtotal` is their
  sum; `taxTotal` is `0` and `grandTotal = subtotal` at creation (tax attaches
  later via the existing `TaxApplication` flow, unchanged); the eagerly-created
  `JournalEntry` is `DRAFT` with `voucherType: INVOICE_VOUCHER`, has exactly 3
  lines (one Accounts Receivable debit for the full subtotal + one grouped
  credit line per distinct income account), and balances (total debit = total
  credit)
- A second invoice in the same sector/branch/month increments to `0002`; a
  different sector resets its own sequence to `0001` (branch/month-boundary
  increments aren't covered — only one branch exists in this dev DB)
- Creating an invoice against a `VENDOR`-type partner is rejected with
  `PartnerNotCustomerError`
- A line with no `productServiceId` (no catalog reference, therefore no
  income account to credit) is rejected with
  `InvoiceLineMissingIncomeAccountError`, and confirms no `Invoice` row was
  left behind — the whole creation runs in one transaction that rolls back
  on any rejection

Same no-cleanup convention as the other scripts; uses a timestamp-derived
sector instead of `TEST ...` naming (sector is a short code, not a free-text
name field) so re-runs don't collide.

### `phase3-invoice-posting-manual-test.ts`

Covers the Invoice posting service (`postInvoice` in `invoice.service.ts`)
added on top of `createInvoice`: `POST /api/invoices/[id]/post`. Posting
transitions the invoice's already-existing DRAFT `JournalEntry` to `POSTED`
by calling the existing `postJournalEntry` (not reimplemented), recomputes
`taxTotal`/`grandTotal` from every `APPROVED` `TaxApplication` on that
`JournalEntry`, flips `Invoice.status` to `POSTED`, and increments
`Partner.outstandingBalance` by the freshly computed `grandTotal` — all
inside one transaction.

- Posting a no-tax DRAFT invoice succeeds: the linked `JournalEntry` and the
  `Invoice` row both end up `POSTED`, `taxTotal` stays `0` and `grandTotal`
  stays `subtotal` (no regression), and `Partner.outstandingBalance`
  increases by exactly `grandTotal`
- Attaching a `PENDING_REVIEW` VAT (OUTPUT) `TaxApplication` to a DRAFT
  invoice's `JournalEntry` and attempting to post is rejected with `409`
  (`PendingTaxApprovalError`, propagated unchanged from `postJournalEntry`);
  the `Invoice` and its `JournalEntry` both stay `DRAFT`, and
  `Partner.outstandingBalance` is untouched — confirms the whole posting
  attempt rolled back as one transaction
- **Fix regression test** (previously a flagged bug, now fixed): approving
  the tax application and posting again succeeds, `Invoice.taxTotal` picks
  up the approved 3000 VAT and `grandTotal` is correctly 23000 (20000
  subtotal + 3000 tax) instead of staying at 20000, and
  `Partner.outstandingBalance` increases by the corrected 23000 — the
  ledger side (VAT Payable line) is also verified directly
- Two `APPROVED` `TaxApplication`s on one invoice's `JournalEntry` (two
  different VAT rates, 15% and 5%, both against the same `JournalEntry`) sum
  correctly into one `taxTotal` (1200 + 400 = 1600), and `grandTotal` /
  `Partner.outstandingBalance` reflect the combined total (9600)
- Re-posting an already-`POSTED` invoice is rejected with `409`
  (`InvoiceAlreadyPostedError`)

Uses VAT OUTPUT for its tax fixture (not TDS/VDS): `postApprovedTaxApplicationLines`
requires a CASH/BANK/RECEIVABLE *debit* line to resolve VAT's settlement
line, which an invoice's `JournalEntry` always has (the Accounts Receivable
debit) — TDS/VDS instead require a CASH/BANK *credit* line, which an
invoice's credit side (income accounts) never has. The `TaxRate` fixture is
created directly via Prisma, same convention as
`phase3-tax-posting-manual-test.ts`. Invoice creation is still direct via
`createInvoice` (through `createInvoiceSchema`), same deviation as
`phase3-invoice-manual-test.ts` — there is no `GET /api/invoices/[id]`
route yet either, so `Invoice`/`JournalEntry` state is read directly via
Prisma after each posting attempt. Requires
`prisma/seed-tax-accounts.ts` to have been run first. Same no-cleanup
convention as the other scripts, timestamp-derived sector naming.

Every `createInvoiceViaSchema` call in this script and
`phase3-invoice-manual-test.ts` now also passes `direction: "CUSTOMER"` —
required after `Invoice.direction` was added (see
`phase3-vendor-bill-manual-test.ts` below); no other change was needed to
either script, which is itself the CUSTOMER-direction regression proof for
that addition.

### `phase3-vendor-bill-manual-test.ts`

Covers Vendor Bills — `Invoice.direction: VENDOR`, added alongside the
existing Customer Invoice path (`direction: CUSTOMER`) so one `Invoice`
model represents both. A Vendor Bill: requires a `VENDOR`-type partner
(`PartnerNotVendorError` otherwise), numbers via the new
`generateVendorBillNumber` (`VB/{BranchCode}/{YYYYMM}/{Seq}` — no sector
segment at all, per the locked decision that Vendor Bill numbering doesn't
use sector; `Invoice.sector` is stored `null` for this direction), resolves
each line's account via `ProductService.expenseAccountId` instead of
`incomeAccountId` (rejected with the new `InvoiceLineMissingExpenseAccountError`
if absent), and posts by crediting Accounts Payable (`2100`) and debiting the
grouped expense accounts — the mirror image of a Customer Invoice's AR debit
/ income credit shape.

- Creating and posting a Vendor Bill: correct `VB/HO/YYYYMM/0001`-shaped
  document number, `sector: null`, JournalEntry has exactly 1 AP credit +
  1 expense debit line (both 15000, balanced), posting succeeds, and
  `Partner.payableBalance` increases by exactly the bill's `grandTotal`
  (15000)
- **Isolation proof (the core of this prompt's locked decisions)**: before
  posting the Vendor Bill, the vendor partner's `outstandingBalance` is
  seeded with a nonzero noise value (555.25) via a direct Prisma write —
  after posting, it's asserted **bit-for-bit unchanged** (still exactly
  555.25), not just "not equal to 15000". Proves Vendor Bill posting never
  touches `outstandingBalance`, not merely that it happened to stay at its
  default of 0.
- **Reverse isolation proof**: same technique in the other direction — a
  customer partner's `payableBalance` is seeded with a different noise value
  (888.5), a Customer Invoice is posted for them, `outstandingBalance`
  increases correctly (+12000) and `payableBalance` is asserted bit-for-bit
  unchanged (still exactly 888.5). Proves Customer Invoice posting never
  touches `payableBalance`.
- `direction: VENDOR` against a `CUSTOMER`-type partner is rejected with
  `PartnerNotVendorError`
- A `VENDOR`-direction line referencing a `ProductService` with no
  `expenseAccountId` is rejected with `InvoiceLineMissingExpenseAccountError`
- Confirms neither rejected attempt left a stray `Invoice` row behind (both
  ran inside `createInvoice`'s own transaction)

CUSTOMER-direction regression coverage is intentionally NOT duplicated here
— it lives in `phase3-invoice-manual-test.ts` /
`phase3-invoice-posting-manual-test.ts` (updated to pass the newly-required
`direction` field, otherwise unchanged), which together prove the CUSTOMER
path still behaves identically. Same deviations/conventions as the other
Phase 3 invoice scripts: `createInvoice` called directly via the service (no
API/UI layer yet), posting through the real `POST /api/invoices/[id]/post`
endpoint, `Invoice`/`JournalEntry`/`Partner` state read directly via Prisma
or `GET /api/partners/[id]` where no other route exists, no-cleanup,
`TEST ... <timestamp>` naming.

### `product-service-manual-test.ts`

Covers the admin CRUD service/API layer for `ProductService`
(`product-service.service.ts`) — fills the gap flagged in
`phase3-invoice-manual-test.ts` ("ProductService likewise has no API/UI yet"):
`POST /api/product-services`, `GET /api/product-services`, `GET
/api/product-services/[id]`, `PATCH /api/product-services/[id]`, `DELETE
/api/product-services/[id]` (soft delete via `isActive`, same as
`Partner`/`TaxRate` — never hard-delete).

- Creating a `PRODUCT` and a `SERVICE` both succeed; a `SERVICE` created
  without `expenseAccountId` stores it as `null` rather than requiring one
- Creating with a duplicate `code` is rejected with `409`
- Creating with a nonexistent `incomeAccountId` is rejected with `400`
  (`IncomeAccountNotFoundError`)
- Creating with a nonexistent `expenseAccountId`, when provided, is rejected
  with `400` (`ExpenseAccountNotFoundError`) — both account checks require
  the referenced `ChartOfAccount` to be `isActive: true`, not merely exist
- Deactivating excludes the row from the default `GET /api/product-services`
  list but it's still fetchable by id, and reappears when `?isActive=false`
  is passed explicitly; a still-active fixture stays in the default list
  throughout, confirming deactivation doesn't affect unrelated rows

Income/expense account fixtures are created through the existing `POST
/api/accounts` route (same convention as `phase3-invoice-manual-test.ts`'s
`ChartOfAccount` fixtures) rather than direct Prisma writes. Same no-cleanup
convention and `TEST ... <timestamp>` naming as the other scripts.

### `product-service-ui-manual-test.ts`

Covers the `ProductService` list/create/edit pages built on top of the CRUD
API above (`/accounting/product-services`,
`/accounting/product-services/new`, `/accounting/product-services/[id]/edit`
— nested under `/accounting`, same placement as Partners/Tax Rates). Unlike
`TaxRate`'s admin UI (create-only when it first shipped), the edit page is
included from the start, since Invoice creation needs to correct catalog
entries regularly.

Same convention as `phase2-partner-ui-manual-test.ts`: no headless-browser/
JSDOM runner is wired up, so this fetches server-rendered HTML and asserts
on markup. `ProductServiceTable` is a client component that receives the
full, unfiltered list as a prop — same RSC-hydration-payload footgun as
`TaxApplicationTable` (see `tax-approval-queue-ui-manual-test.ts`) — so the
"appears in list" check uses an `appearsRendered` helper (`html.includes(">value<")`)
against the rendered anchor/cell text, not a plain substring search.

- `/accounting/product-services` responds `200` and renders the heading and
  a "New product/service" link
- `/accounting/product-services/new` renders inputs for every field: `code`,
  `name`, `type`, `unitPrice`, `unit`, `incomeAccountId`, `expenseAccountId`
- Creating a row via `POST /api/product-services` (the same endpoint the
  form's submit handler calls) makes its code show up rendered on the next
  fetch of `/accounting/product-services`
- `/accounting/product-services/[id]/edit` renders the row's current code in
  the page subtitle. (Doesn't assert on a static `value="..."` attribute on
  the form inputs — `react-hook-form`'s `register()` binds `defaultValues`
  via ref on the client, not a static HTML `value` attribute, so SSR never
  renders one; same reason `phase2-partner-ui-manual-test.ts`'s edit-form
  check is limited to the page subtitle, not input values.)

Same no-cleanup convention and `TEST ... <timestamp>` naming as the other
scripts.

### `payment-manual-test.ts`

Covers the minimal single-invoice payment service (`payment.service.ts`) —
just enough to move an `Invoice` from `POSTED` to `PARTIALLY_PAID`/`PAID`.
Deliberately **not** full payment reconciliation: multi-invoice allocation,
bank statement matching, and anything beyond "record a payment against one
invoice" stay deferred to Phase 4 (Payments & Reconciliation). Exercises the
real `POST /api/invoices/[id]/payments` endpoint; `Invoice`/`Payment` state
after each call is read directly via Prisma (no `GET /api/invoices/[id]`
route exists yet — same deviation as the other Phase 3 invoice scripts).

`recordPayment` is atomic, not create-then-post like Invoice: `Payment` has
no `status`/draft concept of its own, so its `JournalEntry` is created and
posted back-to-back inside one transaction (still via the existing
`createJournalEntry`/`postJournalEntry` building blocks, not reimplemented).
Line shape mirrors `postInvoice`'s direction-aware AR/AP logic in reverse:
`direction: CUSTOMER` debits the given Cash/Bank account and credits
Accounts Receivable (`1200`); `direction: VENDOR` debits Accounts Payable
(`2100`) and credits the given Cash/Bank account. New `VoucherType.PAYMENT_VOUCHER`
(short code `PV`) is stamped on the payment's `JournalEntry`, same treatment
as `INVOICE_VOUCHER` — not user-selectable in the voucher-type picker.

- Full payment on a `CUSTOMER` invoice: status -> `PAID`, `amountPaid` ==
  `grandTotal`, `outstandingBalance` decreases by exactly the payment
  amount; **isolation proof** — `payableBalance` is seeded with a nonzero
  noise value first and asserted bit-for-bit unchanged afterward, same rigor
  as `phase3-vendor-bill-manual-test.ts`
- Partial payment: status -> `PARTIALLY_PAID`, `amountPaid` correct
- A second partial payment summing to the full amount transitions the same
  invoice to `PAID`
- Overpayment (amount exceeding the remaining balance) is rejected with
  `409` (`PaymentExceedsRemainingBalanceError`) rather than silently
  producing a negative remaining balance — confirmed the rejected attempt
  left the invoice completely untouched (still `POSTED`, `amountPaid` still
  `0`)
- Same full/partial flow for a `VENDOR` bill: `payableBalance` updates
  correctly across two payments; isolation proof in the other direction —
  `outstandingBalance` seeded with a different noise value, asserted
  bit-for-bit unchanged
- Payment against a `DRAFT` invoice is rejected with `409`
  (`InvoiceNotPayableError`)
- Payment against an already-`PAID` invoice is rejected with `409`
  (reuses the fully-paid fixture from the first scenario)

Income/expense account and Cash account fixtures are read through the
existing `GET /api/accounts` route (`1010` Cash, `4010` Sales Revenue,
`5010` Operating Expense — from `prisma/seed-coa.ts`); invoice creation goes
through `createInvoice` directly (no API/UI layer yet, same deviation as the
other Phase 3 invoice scripts) and posting through the real
`POST /api/invoices/[id]/post`. Same no-cleanup convention and
`TEST ... <timestamp>` naming as the other scripts.
