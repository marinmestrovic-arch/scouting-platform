-- Week 6 backend completion: HubSpot push batches and per-record push results.

-- CreateEnum
CREATE TYPE "hubspot_push_batch_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "hubspot_push_batch_row_status" AS ENUM ('pending', 'pushed', 'failed');

-- CreateTable
CREATE TABLE "hubspot_push_batches" (
    "id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "scope_payload" JSONB NOT NULL,
    "status" "hubspot_push_batch_status" NOT NULL DEFAULT 'queued',
    "total_row_count" INTEGER NOT NULL DEFAULT 0,
    "pushed_row_count" INTEGER NOT NULL DEFAULT 0,
    "failed_row_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubspot_push_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_push_batch_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "contact_email" TEXT,
    "status" "hubspot_push_batch_row_status" NOT NULL DEFAULT 'pending',
    "hubspot_object_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubspot_push_batch_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hubspot_push_batches_requested_by_user_id_idx" ON "hubspot_push_batches"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "hubspot_push_batches_status_idx" ON "hubspot_push_batches"("status");

-- CreateIndex
CREATE INDEX "hubspot_push_batches_created_at_idx" ON "hubspot_push_batches"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hubspot_push_batch_rows_batch_id_channel_id_key" ON "hubspot_push_batch_rows"("batch_id", "channel_id");

-- CreateIndex
CREATE INDEX "hubspot_push_batch_rows_batch_id_idx" ON "hubspot_push_batch_rows"("batch_id");

-- CreateIndex
CREATE INDEX "hubspot_push_batch_rows_channel_id_idx" ON "hubspot_push_batch_rows"("channel_id");

-- CreateIndex
CREATE INDEX "hubspot_push_batch_rows_status_idx" ON "hubspot_push_batch_rows"("status");

-- AddForeignKey
ALTER TABLE "hubspot_push_batches" ADD CONSTRAINT "hubspot_push_batches_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_push_batch_rows" ADD CONSTRAINT "hubspot_push_batch_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "hubspot_push_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_push_batch_rows" ADD CONSTRAINT "hubspot_push_batch_rows_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
