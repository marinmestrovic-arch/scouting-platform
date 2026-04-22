-- Durable Creator List enrichment jobs and phone-number row overrides.

-- CreateEnum
CREATE TYPE "hubspot_preview_enrichment_job_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "run_hubspot_row_overrides"
ADD COLUMN "phone_number" TEXT;

-- CreateTable
CREATE TABLE "hubspot_preview_enrichment_jobs" (
  "id" UUID NOT NULL,
  "run_request_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "status" "hubspot_preview_enrichment_job_status" NOT NULL DEFAULT 'queued',
  "progress_percentage" INTEGER NOT NULL DEFAULT 0,
  "progress_message" TEXT,
  "processed_channel_count" INTEGER NOT NULL DEFAULT 0,
  "updated_row_count" INTEGER NOT NULL DEFAULT 0,
  "updated_field_count" INTEGER NOT NULL DEFAULT 0,
  "failed_channel_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_preview_enrichment_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hubspot_preview_enrichment_jobs_run_request_id_idx"
ON "hubspot_preview_enrichment_jobs"("run_request_id");

-- CreateIndex
CREATE INDEX "hubspot_preview_enrichment_jobs_requested_by_user_id_idx"
ON "hubspot_preview_enrichment_jobs"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "hubspot_preview_enrichment_jobs_status_created_at_idx"
ON "hubspot_preview_enrichment_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "hubspot_preview_enrichment_jobs_created_at_idx"
ON "hubspot_preview_enrichment_jobs"("created_at");

-- AddForeignKey
ALTER TABLE "hubspot_preview_enrichment_jobs"
ADD CONSTRAINT "hubspot_preview_enrichment_jobs_requested_by_user_id_fkey"
FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_preview_enrichment_jobs"
ADD CONSTRAINT "hubspot_preview_enrichment_jobs_run_request_id_fkey"
FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
