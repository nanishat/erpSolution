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
