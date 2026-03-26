-- Client metadata fields for Database client management.

-- AlterTable
ALTER TABLE "clients"
ADD COLUMN "domain" TEXT,
ADD COLUMN "country_region" TEXT,
ADD COLUMN "city" TEXT;
