BEGIN;

ALTER TABLE "ChartOfAccount"
  ADD COLUMN "isPostable" BOOLEAN NOT NULL DEFAULT true;

UPDATE "ChartOfAccount"
SET "isPostable" = false
WHERE code IN ('1000', '2000', '4000', '5000');

COMMIT;
