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
