-- CreateEnum
CREATE TYPE "run_channel_assessment_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "run_requests"
ADD COLUMN "client_industry" TEXT,
ADD COLUMN "campaign_objective" TEXT,
ADD COLUMN "target_audience_age" TEXT,
ADD COLUMN "target_audience_gender" TEXT,
ADD COLUMN "target_geographies" JSONB,
ADD COLUMN "content_restrictions" JSONB,
ADD COLUMN "budget_tier" TEXT,
ADD COLUMN "deliverables" JSONB;

-- CreateTable
CREATE TABLE "run_channel_assessments" (
  "id" UUID NOT NULL,
  "run_request_id" UUID NOT NULL,
  "channel_id" UUID NOT NULL,
  "status" "run_channel_assessment_status" NOT NULL DEFAULT 'queued',
  "model" TEXT,
  "fit_score" DOUBLE PRECISION,
  "fit_reasons" JSONB,
  "fit_concerns" JSONB,
  "recommended_angles" JSONB,
  "avoid_topics" JSONB,
  "raw_openai_payload" JSONB,
  "raw_openai_payload_fetched_at" TIMESTAMP(3),
  "assessed_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "run_channel_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_channel_assessments_run_request_id_channel_id_key"
ON "run_channel_assessments"("run_request_id", "channel_id");

CREATE INDEX "run_channel_assessments_run_request_id_idx"
ON "run_channel_assessments"("run_request_id");

CREATE INDEX "run_channel_assessments_status_idx"
ON "run_channel_assessments"("status");

CREATE INDEX "run_channel_assessments_channel_id_idx"
ON "run_channel_assessments"("channel_id");

-- AddForeignKey
ALTER TABLE "run_channel_assessments"
ADD CONSTRAINT "run_channel_assessments_run_request_id_fkey"
FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_channel_assessments"
ADD CONSTRAINT "run_channel_assessments_channel_id_fkey"
FOREIGN KEY ("channel_id") REFERENCES "channels"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
