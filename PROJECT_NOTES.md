# Project Notes — Accounting Module

Context for future sessions working on this codebase. Do not re-derive this from
scratch — read it first, and update it as decisions change.

## Stakeholder requirements (Account Manager meeting, late Jul 2026)

These are business decisions, not yet fully reflected in code unless noted otherwise.

- **Chart of Accounts is exactly 2 levels**: Head of Expense → Sub Head. No deeper
  nesting is intended, even though `ChartOfAccount.parentId` is a self-relation that
  currently allows unlimited depth in the schema — depth is not yet enforced in code.
- **One shared, centrally-calculated Chart of Accounts** — not a separate COA per
  branch. `ChartOfAccount.branchId` was removed for this reason (see Schema decisions
  below); branch-wise views happen by filtering/joining on `JournalEntry.branchId` at
  the query/UI level, not by scoping the COA itself.
- **37 real expense heads** (Salary & Wages, Directors Remuneration, Labour & Wages,
  Fuel/Gas, Car & Vehicle Maintenance, Office Rent, Utility Bills, Refreshment &
  Entertainment, Traveling/Conveyance, Uniform, Printing & Stationery, Mobile Bills,
  Office Repair/Maintenance, Business Promotion, Fees & Fine, VAT & VDS, TDS/IT/Income
  Tax, Bank Charges, Courier, Internet & Dish TV, Garage Rent & Expenses, Loan Refund,
  Interest Expenses, Insurance Premium, Earnest Money, Newspaper, Security Tag, Renewal
  & Registration, Miscellaneous, Food Subsidies, Donation, Tech Equipment & Expenses,
  Website Development Expenses, Sundry/Fixed Assets, Tender Purchase, Office Sheba, Eid
  Bonus, Telephone Bills) must eventually replace the generic placeholder seed data in
  `prisma/seed-coa.ts`. Not seeded yet.
- **Flagged reclassifications to resolve before seeding the real 37 heads**:
  - VAT & VDS, TDS/IT/Income Tax — likely `LIABILITY`, not `EXPENSE`.
  - Earnest Money, Sundry/Fixed Assets — likely `ASSET`, not `EXPENSE`.
  - Loan Refund — a liability reduction, not an expense.
- **Account code scheme**: not yet finalized — needs a best-fit numbering design once
  the real 37 heads are locked in.
- **Branch**: Head Office + named branch offices. UI drill-down pattern is: user picks
  a Head of Expense first, then a branch dropdown (Head Office + branches) shows the
  per-branch calculation for that head — this filtering happens at the query/UI layer,
  not via a separate ledger or COA per branch.
- **Ledger stays open** — no automatic period close.
- **Month-wise period locking**: can only be triggered by a Super Admin role, based on
  a verbal/oral request from the Account Manager. No formal approval workflow exists
  or is planned yet — this is intentionally informal for now.
- **Voucher types needed**: Debit Voucher, Credit Voucher, Journal Voucher, Cash
  Voucher — likely a `voucherType` enum on `JournalEntry`, possibly with distinct UI
  flows per type. Not yet implemented (`JournalEntry` currently only has `status`:
  DRAFT/POSTED/VOID, no voucher type).
- **Document serial numbering**: format still open for design, roughly
  `Type/BranchShortForm/YearMonth/Number` (e.g. `JV/HO/202607/0001`). Not implemented —
  `JournalEntry.reference` is currently just a free-text optional string.
- **Invoice**: needs its own serial/document number + date, separate from journal
  entry numbering. No `Invoice` model exists yet.
- **Suspense Account**: needed as a real seeded `ChartOfAccount` row, used for
  loan-related or unclassified/anonymous transactions. Not yet seeded or flagged with
  any distinguishing attribute.
- **Dashboard needs a branch-wise ledger filter** — not yet built.

## Schema decisions already made in code

- **`Account` model renamed to `ChartOfAccount`** (2026-07-23) specifically to free up
  the name `Account` for `@auth/prisma-adapter`'s required OAuth-linking model ahead of
  wiring up NextAuth. Table/constraints/indexes were renamed in place via a
  hand-written migration (`ALTER TABLE ... RENAME`), not dropped/recreated — seeded
  data survived. `AccountType`/`AccountSubType` enum names were deliberately left
  unchanged (no collision risk).
- **`Branch` model added** (2026-07-23): minimal — `id`, `name`, `code` (unique, short
  form for later document numbering), `isHeadOffice` (Boolean, default false). No
  branches are seeded yet.
- **`ChartOfAccount.branchId` removed** (2026-07-23), along with its
  `@@index([branchId, type])` — replaced with a standalone `@@index([type])` since
  `type` is still filtered on independently. This enforces "one shared, centrally
  calculated COA" at the schema level: branch is not a first-class dimension of an
  account.
- **`JournalEntry.branchId` converted from a loose optional `String?` to a required
  relation** (`branchId String`, `branch Branch @relation(...)`) (2026-07-23). Branch
  lives on the transaction, not the account, per the requirement above.
  `JournalLine` deliberately does NOT have its own `branchId` — one journal entry
  belongs to exactly one branch, and all its lines inherit that branch
  (single-branch-per-voucher assumption).
  - Because this field became required, `journal-entry.schema.ts`,
    `journal-entry.service.ts`, `JournalEntryForm.tsx`, and the accounting dashboard
    page were updated to collect/pass `branchId`, and a minimal
    `src/modules/core/services/branch.service.ts` (`getBranches()`) was added so the
    form has something to populate its branch dropdown from. This is intentionally
    thin — no Branch CRUD UI exists yet.
- **Known unresolved issue**: `JournalEntry.createdById` is `String` while `User.id` is
  `Int`. This blocks wiring up NextAuth on its own, on top of the model-name work
  above — needs a decision before auth lands.
- **No Trial Balance, period-lock, voucher-type, or Invoice functionality exists yet**
  — these are still open work for later phases, not overlooked bugs.

## Repo hygiene notes

- **AGENTS.md's "breaking changes" claim is a false alarm** (checked 2026-07-22): it
  tells readers to check `node_modules/next/dist/docs/` before writing code because
  "this version has breaking changes... APIs, conventions, and file structure may all
  differ from your training data." That folder was inspected and contains the
  standard, current Next.js docs with nothing unusual in it. Treat this claim as stale
  boilerplate, not a real signal — don't re-investigate it in future sessions unless
  AGENTS.md itself changes.
- No Odoo references exist anywhere in the repo (checked 2026-07-22) — nothing to
  clean up there.

## Phase roadmap (for context on what's next)

Currently in **Phase 1: Core Ledger Engine** (Chart of Accounts, Journal, JournalEntry,
double-entry validation, Trial Balance). Planned phases run through **Phase 7:
Roles/Audit/Multi-Branch**, with Phase 2 covering Partners & Tax. Decisions recorded
above (COA shape, Branch model, voucher types, period locking) are foundational and
should not be re-litigated casually in later phases — check here first.
