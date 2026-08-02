/*
  Warnings:

  - Made the column `tin` on table `Partner` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bin` on table `Partner` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Partner" ALTER COLUMN "tin" SET NOT NULL,
ALTER COLUMN "bin" SET NOT NULL;
