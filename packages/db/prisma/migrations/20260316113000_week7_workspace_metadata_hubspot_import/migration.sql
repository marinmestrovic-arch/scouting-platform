-- Week 7 workspace metadata, user types, contact names, and HubSpot import batches.

-- CreateEnum
CREATE TYPE "user_type" AS ENUM ('admin', 'campaign_manager', 'campaign_lead', 'hoc');

-- CreateEnum
CREATE TYPE "run_month" AS ENUM (
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
);

-- CreateEnum
CREATE TYPE "hubspot_import_batch_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "hubspot_import_batch_row_status" AS ENUM ('pending', 'prepared', 'failed');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "user_type" "user_type" NOT NULL DEFAULT 'campaign_manager';

UPDATE "users"
SET "user_type" = CASE
  WHEN "role" = 'admin'::role THEN 'admin'::"user_type"
  ELSE 'campaign_manager'::"user_type"
END;

-- AlterTable
ALTER TABLE "channels"
ADD COLUMN "youtube_url" TEXT;

UPDATE "channels"
SET "youtube_url" = 'https://www.youtube.com/channel/' || "youtube_channel_id"
WHERE "youtube_url" IS NULL;

-- AlterTable
ALTER TABLE "channel_contacts"
ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT;

-- AlterTable
ALTER TABLE "csv_import_rows"
ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT;

-- AlterTable
ALTER TABLE "channel_metrics"
ADD COLUMN "youtube_average_views" BIGINT,
ADD COLUMN "youtube_engagement_rate" DOUBLE PRECISION,
ADD COLUMN "youtube_followers" BIGINT;

UPDATE "channel_metrics"
SET "youtube_followers" = "subscriber_count"
WHERE "youtube_followers" IS NULL;

-- CreateTable
CREATE TABLE "hubspot_import_batches" (
  "id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "run_request_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "status" "hubspot_import_batch_status" NOT NULL DEFAULT 'queued',
  "total_row_count" INTEGER NOT NULL DEFAULT 0,
  "prepared_row_count" INTEGER NOT NULL DEFAULT 0,
  "failed_row_count" INTEGER NOT NULL DEFAULT 0,
  "csv_content" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_import_batch_rows" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "channel_id" UUID NOT NULL,
  "contact_email" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "hubspot_import_batch_row_status" NOT NULL DEFAULT 'pending',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_import_batch_rows_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "run_requests"
ADD COLUMN "client" TEXT,
ADD COLUMN "market" TEXT,
ADD COLUMN "campaign_manager_user_id" UUID,
ADD COLUMN "brief_link" TEXT,
ADD COLUMN "campaign_name" TEXT,
ADD COLUMN "month" "run_month",
ADD COLUMN "year" INTEGER,
ADD COLUMN "deal_owner" TEXT,
ADD COLUMN "deal_name" TEXT,
ADD COLUMN "pipeline" TEXT,
ADD COLUMN "deal_stage" TEXT,
ADD COLUMN "currency" TEXT,
ADD COLUMN "deal_type" TEXT,
ADD COLUMN "activation_type" TEXT;

-- CreateIndex
CREATE INDEX "run_requests_campaign_manager_user_id_idx" ON "run_requests"("campaign_manager_user_id");

-- CreateIndex
CREATE INDEX "run_requests_client_idx" ON "run_requests"("client");

-- CreateIndex
CREATE INDEX "run_requests_market_idx" ON "run_requests"("market");

-- CreateIndex
CREATE INDEX "hubspot_import_batches_requested_by_user_id_idx" ON "hubspot_import_batches"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "hubspot_import_batches_run_request_id_idx" ON "hubspot_import_batches"("run_request_id");

-- CreateIndex
CREATE INDEX "hubspot_import_batches_status_idx" ON "hubspot_import_batches"("status");

-- CreateIndex
CREATE INDEX "hubspot_import_batches_created_at_idx" ON "hubspot_import_batches"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hubspot_import_batch_rows_batch_id_channel_id_contact_email_key" ON "hubspot_import_batch_rows"("batch_id", "channel_id", "contact_email");

-- CreateIndex
CREATE INDEX "hubspot_import_batch_rows_batch_id_idx" ON "hubspot_import_batch_rows"("batch_id");

-- CreateIndex
CREATE INDEX "hubspot_import_batch_rows_channel_id_idx" ON "hubspot_import_batch_rows"("channel_id");

-- CreateIndex
CREATE INDEX "hubspot_import_batch_rows_status_idx" ON "hubspot_import_batch_rows"("status");

-- AddForeignKey
ALTER TABLE "run_requests"
ADD CONSTRAINT "run_requests_campaign_manager_user_id_fkey" FOREIGN KEY ("campaign_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_import_batches"
ADD CONSTRAINT "hubspot_import_batches_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_import_batches"
ADD CONSTRAINT "hubspot_import_batches_run_request_id_fkey" FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_import_batch_rows"
ADD CONSTRAINT "hubspot_import_batch_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "hubspot_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_import_batch_rows"
ADD CONSTRAINT "hubspot_import_batch_rows_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
