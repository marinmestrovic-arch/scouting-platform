ALTER TABLE "channels"
ADD COLUMN "influencer_type" TEXT,
ADD COLUMN "influencer_vertical" TEXT,
ADD COLUMN "country_region" TEXT;

ALTER TABLE "csv_import_rows"
ADD COLUMN "influencer_type" TEXT,
ADD COLUMN "influencer_vertical" TEXT,
ADD COLUMN "country_region" TEXT,
ADD COLUMN "language" TEXT;
