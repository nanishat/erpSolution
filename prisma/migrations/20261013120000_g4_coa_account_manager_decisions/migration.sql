BEGIN;

UPDATE "ChartOfAccount"
SET "isActive" = false, "updatedAt" = now()
WHERE code IN ('5170', '5180', '1220');

UPDATE "ChartOfAccount"
SET name = 'Sundry Assets', "updatedAt" = now()
WHERE code = '1240';

UPDATE "ChartOfAccount"
SET "isPostable" = false, "updatedAt" = now()
WHERE code = '3000';

INSERT INTO "ChartOfAccount"
  (id, code, name, type, "subType", "parentId", "isActive", "isReconcilable",
   "isPostable", "isSystem", "currencyCode", "openingBalance", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  v.code,
  v.name,
  v.type::"AccountType",
  v.subtype::"AccountSubType",
  (SELECT id FROM "ChartOfAccount" WHERE code = v.parent_code),
  true,
  false,
  true,
  false,
  'BDT',
  0,
  now(),
  now()
FROM (VALUES
  ('2140', 'Bank Loan', 'LIABILITY', 'LONG_TERM_LIABILITY', '2000'),
  ('2150', 'Director Loan', 'LIABILITY', 'LONG_TERM_LIABILITY', '2000'),
  ('2160', 'Security Deposit Received', 'LIABILITY', 'CURRENT_LIABILITY', '2000'),
  ('1260', 'Fixed Assets', 'ASSET', 'FIXED_ASSET', '1000'),
  ('3010', 'Owner''s Capital', 'EQUITY', 'EQUITY', '3000'),
  ('3020', 'Retained Earnings', 'EQUITY', 'EQUITY', '3000')
) AS v(code, name, type, subtype, parent_code)
ON CONFLICT (code) DO NOTHING;

COMMIT;
