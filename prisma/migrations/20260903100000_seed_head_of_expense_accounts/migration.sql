-- Seeds the real 39-head Chart of Account list handed down by the Account
-- Manager (35 EXPENSE heads, 4 ASSET heads), replacing the ~17 placeholder
-- accounts that were live from initial seeding. Head-of-Expense level only —
-- Sub Head taxonomy under these is still undecided, so no children are added
-- below the new heads.
--
-- Verified before writing this migration (dev DB, 2026-09-03): 17
-- non-test ChartOfAccount rows active (root accounts 1000/2000/3000/4000/5000
-- plus 12 leaf accounts). Reconciled each of the 17 against the 39-head list:
-- only "Fuel/Gas" (5020) matches an incoming head and needs no change. None
-- of the other 16 qualify for deactivation — 1010/1020/1200 (Cash/Bank/AR)
-- and 5010 (Operating Expenses) all carry live JournalLine/ProductService
-- references and the app's own updateChartOfAccount guard already refuses to
-- deactivate any account with journal lines; 1210/2110/2120/2130 are
-- isSystem-protected; 1000/2000/3000/4000/5000 are the type-root accounts.
-- So this migration is additive only (18 new rows) plus the one Suspense
-- Account reclassification below — nothing is deactivated or deleted.
--
-- Codes continue the existing "+10 within type" scheme: EXPENSE heads
-- 5030-5360 (5020 already taken by the matched Fuel/Gas), ASSET heads
-- 1220-1250 (continuing after 1210, clear of the 1900 Suspense Account).

BEGIN;

-- 34 new EXPENSE heads (Fuel/Gas already exists at 5020 and needs no change).
-- All map cleanly to OPERATING_EXPENSE — this org has no COGS-shaped head in
-- the list, so AccountSubType.COST_OF_GOODS_SOLD / OTHER_EXPENSE are unused
-- here.
--
-- FLAG (not resolved by this migration — see also the Suspense Account note
-- below): "VAT & VDS" and "TDS/IT/Income Tax" were previously flagged as
-- possibly LIABILITY in nature (payables) rather than EXPENSE. This seed
-- uses the Account Manager's latest classification (EXPENSE) as given, but
-- that reclassification question is NOT closed — revisit before Phase 5
-- reporting is built on top of these two heads.
INSERT INTO "ChartOfAccount"
  (id, code, name, type, "subType", "parentId", "isActive", "isReconcilable", "isSystem", "currencyCode", "openingBalance", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  v.code,
  v.name,
  'EXPENSE'::"AccountType",
  'OPERATING_EXPENSE'::"AccountSubType",
  (SELECT id FROM "ChartOfAccount" WHERE code = '5000'),
  true,
  false,
  false,
  'BDT',
  0,
  now(),
  now()
FROM (VALUES
  ('5030', 'Salary & Wages'),
  ('5040', 'Directors Remuneration'),
  ('5050', 'Labour & Wages'),
  ('5060', 'Car & Vehicle Maintenance'),
  ('5070', 'Office Rent'),
  ('5080', 'Utility Bills'),
  ('5090', 'Refreshment & Entertainment'),
  ('5100', 'Traveling/Conveyance'),
  ('5110', 'Uniform'),
  ('5120', 'Printing & Stationery'),
  ('5130', 'Mobile Bills'),
  ('5140', 'Office Repair/Maintenance'),
  ('5150', 'Business Promotion'),
  ('5160', 'Fees & Fine'),
  ('5170', 'VAT & VDS'),
  ('5180', 'TDS/IT/Income Tax'),
  ('5190', 'Bank Charges'),
  ('5200', 'Courier'),
  ('5210', 'Internet & Dish TV'),
  ('5220', 'Garage Rent & Expenses'),
  ('5230', 'Interest Expenses'),
  ('5240', 'Insurance Premium'),
  ('5250', 'Newspaper'),
  ('5260', 'Security Tag'),
  ('5270', 'Renewal & Registration'),
  ('5280', 'Miscellaneous'),
  ('5290', 'Food Subsidies'),
  ('5300', 'Donation'),
  ('5310', 'Tech Equipment & Expenses'),
  ('5320', 'Website Development Expenses'),
  ('5330', 'Tender Purchase'),
  ('5340', 'Office Sheba'),
  ('5350', 'Eid Bonus'),
  ('5360', 'Telephone Bills')
) AS v(code, name);

-- 4 new ASSET heads.
--
-- FLAG (see also the EXPENSE note above): "Loan Refund" was previously
-- flagged as possibly a LIABILITY-reduction in nature rather than an ASSET.
-- This seed uses the Account Manager's latest classification (ASSET) as
-- given, but that reclassification question is NOT closed.
INSERT INTO "ChartOfAccount"
  (id, code, name, type, "subType", "parentId", "isActive", "isReconcilable", "isSystem", "currencyCode", "openingBalance", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  v.code,
  v.name,
  'ASSET'::"AccountType",
  v.subtype::"AccountSubType",
  (SELECT id FROM "ChartOfAccount" WHERE code = '1000'),
  true,
  false,
  false,
  'BDT',
  0,
  now(),
  now()
FROM (VALUES
  ('1220', 'Loan Refund', 'CURRENT_ASSET'),
  ('1230', 'Earnest Money', 'CURRENT_ASSET'),
  ('1240', 'Sundry/Fixed Assets', 'FIXED_ASSET'),
  ('1250', 'Micro Bus Purchase', 'FIXED_ASSET')
) AS v(code, name, subtype);

-- Suspense Account (1900) reclassification: ASSET/CURRENT_ASSET -> EXPENSE/
-- OTHER_EXPENSE, per explicit (not inferred) instruction. This is an
-- unusual choice for a clearing account -- normally these stay ASSET or
-- LIABILITY since they hold amounts pending reclassification -- do not
-- silently "fix" this back. The account keeps its dual purpose (holding
-- loan-related and unclassified transactions pending categorization, per
-- DECISIONS.md #8 -- note: that file does not currently exist in this repo,
-- flagging for whoever chases the reference down) even though it now lives
-- under the EXPENSE type root.
--
-- Also reparents 1900 from the Assets root (1000) to the Expense root
-- (5000): chart-of-account.service.ts enforces "child account type must
-- match parent account type" on every create/update, so leaving parentId
-- pointed at 1000 (ASSET) while type flips to EXPENSE would leave the row
-- permanently inconsistent with that invariant.
--
-- No other code change is required for this reclassification:
-- trial-balance.service.ts's DEBIT_NORMAL_TYPES already includes both ASSET
-- and EXPENSE, so the Trial Balance's debit/credit-normal-balance sign
-- convention is unaffected by this type change.
UPDATE "ChartOfAccount"
SET
  type = 'EXPENSE'::"AccountType",
  "subType" = 'OTHER_EXPENSE'::"AccountSubType",
  "parentId" = (SELECT id FROM "ChartOfAccount" WHERE code = '5000'),
  "updatedAt" = now()
WHERE code = '1900' AND "isSystem" = true;

COMMIT;
