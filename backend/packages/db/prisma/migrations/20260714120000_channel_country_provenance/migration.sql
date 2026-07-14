CREATE TYPE "channel_country_source" AS ENUM (
  'admin_manual',
  'csv_import',
  'hypeauditor',
  'youtube_declared',
  'llm'
);

ALTER TABLE "channels"
ADD COLUMN "country_region_source" "channel_country_source";

UPDATE "channels" AS c
SET "country_region_source" = 'csv_import'
WHERE c."country_region" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "csv_import_rows" AS cir
    WHERE cir."channel_id" = c."id"
      AND cir."status" = 'imported'
      AND cir."country_region" IS NOT NULL
      AND LOWER(TRIM(cir."country_region")) = LOWER(TRIM(c."country_region"))
  );

UPDATE "channels"
SET "country_region_source" = 'llm'
WHERE "country_region" IS NOT NULL
  AND "country_region_source" IS NULL;

CREATE INDEX "channels_country_region_source_idx"
ON "channels"("country_region_source");
