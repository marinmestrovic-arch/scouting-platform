CREATE TYPE "dropdown_value_field_key" AS ENUM (
  'currency',
  'deal_type',
  'activation_type',
  'influencer_type',
  'influencer_vertical',
  'country_region',
  'language'
);

CREATE TABLE "dropdown_values" (
  "id" UUID NOT NULL,
  "field_key" "dropdown_value_field_key" NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dropdown_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dropdown_values_field_key_value_key"
  ON "dropdown_values"("field_key", "value");

CREATE INDEX "dropdown_values_field_key_idx"
  ON "dropdown_values"("field_key");

CREATE INDEX "dropdown_values_created_at_idx"
  ON "dropdown_values"("created_at");

ALTER TABLE "run_requests"
  ADD COLUMN "hubspot_influencer_type" TEXT,
  ADD COLUMN "hubspot_influencer_vertical" TEXT,
  ADD COLUMN "hubspot_country_region" TEXT,
  ADD COLUMN "hubspot_language" TEXT;

CREATE TABLE "run_hubspot_row_overrides" (
  "id" UUID NOT NULL,
  "run_request_id" UUID NOT NULL,
  "row_key" TEXT NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT,
  "email" TEXT,
  "currency" TEXT,
  "deal_type" TEXT,
  "activation_type" TEXT,
  "influencer_type" TEXT,
  "influencer_vertical" TEXT,
  "country_region" TEXT,
  "language" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "run_hubspot_row_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "run_hubspot_row_overrides_run_request_id_row_key_key"
  ON "run_hubspot_row_overrides"("run_request_id", "row_key");

CREATE INDEX "run_hubspot_row_overrides_run_request_id_idx"
  ON "run_hubspot_row_overrides"("run_request_id");

CREATE INDEX "run_hubspot_row_overrides_created_at_idx"
  ON "run_hubspot_row_overrides"("created_at");

ALTER TABLE "run_hubspot_row_overrides"
  ADD CONSTRAINT "run_hubspot_row_overrides_run_request_id_fkey"
  FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
