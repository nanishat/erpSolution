-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'TDS', 'VDS');

-- CreateEnum
CREATE TYPE "TaxComputationType" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "type" "TaxType" NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "computationType" "TaxComputationType" NOT NULL DEFAULT 'EXCLUSIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxRate_type_category_idx" ON "TaxRate"("type", "category");

-- CreateIndex
CREATE INDEX "TaxRate_isActive_idx" ON "TaxRate"("isActive");
