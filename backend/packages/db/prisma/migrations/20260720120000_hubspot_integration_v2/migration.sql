-- HubSpot Integration V2: portal-aware identities, delivery durability,
-- synchronized reference data, webhook events, cursors, and conflicts.

-- CreateEnum
CREATE TYPE "hubspot_portal_health_status" AS ENUM ('unknown', 'healthy', 'degraded', 'unhealthy');

CREATE TYPE "hubspot_health_check_run_status" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TYPE "hubspot_delivery_mode" AS ENUM ('csv_fallback', 'direct_import', 'direct_object_api', 'hybrid');

CREATE TYPE "hubspot_external_delivery_status" AS ENUM ('submitted', 'processing', 'completed', 'completed_with_errors', 'failed');

CREATE TYPE "hubspot_association_status" AS ENUM ('pending', 'associated', 'failed', 'not_required');

CREATE TYPE "hubspot_object_sync_mode" AS ENUM ('full', 'incremental', 'webhook_reconciliation');

CREATE TYPE "hubspot_webhook_event_status" AS ENUM ('received', 'queued', 'running', 'completed', 'failed', 'ignored');

CREATE TYPE "hubspot_conflict_status" AS ENUM ('open', 'resolved', 'dismissed');

CREATE TYPE "hubspot_conflict_ownership" AS ENUM ('platform', 'hubspot', 'shared');

-- ExtendEnum
ALTER TYPE "hubspot_import_batch_status" ADD VALUE 'preparing';
ALTER TYPE "hubspot_import_batch_status" ADD VALUE 'submitting';
ALTER TYPE "hubspot_import_batch_status" ADD VALUE 'submitted';
ALTER TYPE "hubspot_import_batch_status" ADD VALUE 'processing';
ALTER TYPE "hubspot_import_batch_status" ADD VALUE 'completed_with_errors';

ALTER TYPE "hubspot_import_batch_row_status" ADD VALUE 'submitting';
ALTER TYPE "hubspot_import_batch_row_status" ADD VALUE 'synced';
ALTER TYPE "hubspot_import_batch_row_status" ADD VALUE 'skipped';

-- CreateTable
CREATE TABLE "hubspot_portals" (
  "id" UUID NOT NULL,
  "portal_id" TEXT NOT NULL,
  "display_name" TEXT,
  "health_status" "hubspot_portal_health_status" NOT NULL DEFAULT 'unknown',
  "health_checked_at" TIMESTAMP(3),
  "health_last_error" TEXT,
  "health_summary" JSONB,
  "last_reference_sync_at" TIMESTAMP(3),
  "last_object_sync_at" TIMESTAMP(3),
  "last_webhook_processed_at" TIMESTAMP(3),
  "object_sync_lease_owner" TEXT,
  "object_sync_lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_portals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_health_check_runs" (
  "id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "status" "hubspot_health_check_run_status" NOT NULL DEFAULT 'queued',
  "report" JSONB,
  "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_health_check_runs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "dropdown_values"
  ADD COLUMN "label" TEXT,
  ADD COLUMN "internal_value" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "source_object_type" TEXT,
  ADD COLUMN "source_property_name" TEXT,
  ADD COLUMN "hubspot_portal_id" UUID,
  ADD COLUMN "hubspot_synced_at" TIMESTAMP(3);

-- Preserve the legacy display value while allowing future HubSpot option labels
-- and internal values to differ.
UPDATE "dropdown_values"
SET
  "label" = "value",
  "internal_value" = "value";

ALTER TABLE "clients"
  ADD COLUMN "hubspot_portal_id" UUID;

ALTER TABLE "campaigns"
  ADD COLUMN "hubspot_portal_id" UUID;

ALTER TABLE "hubspot_import_batches"
  ADD COLUMN "hubspot_portal_id" UUID,
  ADD COLUMN "delivery_mode" "hubspot_delivery_mode" NOT NULL DEFAULT 'csv_fallback',
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "preparation_hash" TEXT,
  ADD COLUMN "external_job_id" TEXT,
  ADD COLUMN "external_status" "hubspot_external_delivery_status",
  ADD COLUMN "provider_correlation_id" TEXT,
  ADD COLUMN "provider_result_summary" JSONB,
  ADD COLUMN "direct_sync_snapshot" JSONB,
  ADD COLUMN "synced_row_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_retry_at" TIMESTAMP(3),
  ADD COLUMN "phase_lease_owner" TEXT,
  ADD COLUMN "phase_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "last_polled_at" TIMESTAMP(3);

ALTER TABLE "hubspot_import_batch_rows"
  ADD COLUMN "channel_contact_id" UUID,
  ADD COLUMN "external_key" TEXT,
  ADD COLUMN "hubspot_contact_id" TEXT,
  ADD COLUMN "hubspot_deal_id" TEXT,
  ADD COLUMN "association_status" "hubspot_association_status",
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "provider_correlation_id" TEXT,
  ADD COLUMN "provider_error_code" TEXT;

ALTER TABLE "hubspot_object_sync_runs"
  ADD COLUMN "hubspot_portal_id" UUID,
  ADD COLUMN "mode" "hubspot_object_sync_mode" NOT NULL DEFAULT 'full',
  ADD COLUMN "full_reconciliation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "high_water_mark" TIMESTAMP(3),
  ADD COLUMN "warning_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "warnings" JSONB,
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "hubspot_contact_links" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "channel_contact_id" UUID NOT NULL,
  "hubspot_object_id" TEXT NOT NULL,
  "external_key" TEXT NOT NULL,
  "last_successful_sync_at" TIMESTAMP(3),
  "last_observed_hubspot_updated_at" TIMESTAMP(3),
  "mirror_properties" JSONB,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "last_outbound_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_contact_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_deal_links" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "run_request_id" UUID NOT NULL,
  "hubspot_object_id" TEXT NOT NULL,
  "external_key" TEXT NOT NULL,
  "last_successful_sync_at" TIMESTAMP(3),
  "last_observed_hubspot_updated_at" TIMESTAMP(3),
  "mirror_properties" JSONB,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "last_outbound_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_deal_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_owners" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "hubspot_owner_id" TEXT NOT NULL,
  "email" TEXT,
  "normalized_email" TEXT,
  "first_name" TEXT,
  "last_name" TEXT,
  "display_name" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "last_observed_updated_at" TIMESTAMP(3),
  "synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_owners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_pipelines" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "object_type" TEXT NOT NULL,
  "hubspot_pipeline_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_pipeline_stages" (
  "id" UUID NOT NULL,
  "pipeline_id" UUID NOT NULL,
  "hubspot_stage_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_association_definitions" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "from_object_type" TEXT NOT NULL,
  "to_object_type" TEXT NOT NULL,
  "association_category" TEXT NOT NULL,
  "association_type_id" INTEGER NOT NULL,
  "label" TEXT,
  "is_user_defined" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_association_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_webhook_events" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "subscription_type" TEXT NOT NULL,
  "event_type" TEXT,
  "object_type" TEXT NOT NULL,
  "hubspot_object_id" TEXT NOT NULL,
  "property_name" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "hubspot_webhook_event_status" NOT NULL DEFAULT 'received',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "safe_raw_payload" JSONB,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_sync_cursors" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "object_type" TEXT NOT NULL,
  "cursor" TEXT,
  "high_water_mark" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "last_successful_sync_at" TIMESTAMP(3),
  "last_full_reconciliation_at" TIMESTAMP(3),
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "counts" JSONB,
  "warnings" JSONB,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_sync_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_conflicts" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "channel_contact_id" UUID,
  "hubspot_contact_link_id" UUID,
  "hubspot_deal_link_id" UUID,
  "client_id" UUID,
  "campaign_id" UUID,
  "run_request_id" UUID,
  "hubspot_object_type" TEXT NOT NULL,
  "hubspot_object_id" TEXT NOT NULL,
  "property_name" TEXT NOT NULL,
  "local_value" JSONB,
  "hubspot_value" JSONB,
  "ownership" "hubspot_conflict_ownership" NOT NULL,
  "status" "hubspot_conflict_status" NOT NULL DEFAULT 'open',
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_user_id" UUID,
  "resolution_action" TEXT,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hubspot_portals_portal_id_key" ON "hubspot_portals"("portal_id");
CREATE INDEX "hubspot_portals_health_status_idx" ON "hubspot_portals"("health_status");
CREATE INDEX "hubspot_portals_health_checked_at_idx" ON "hubspot_portals"("health_checked_at");
CREATE INDEX "hubspot_portals_object_sync_lease_expires_at_idx" ON "hubspot_portals"("object_sync_lease_expires_at");

CREATE INDEX "hubspot_health_check_runs_status_created_at_idx" ON "hubspot_health_check_runs"("status", "created_at");
CREATE INDEX "hubspot_health_check_runs_requested_by_created_at_idx" ON "hubspot_health_check_runs"("requested_by_user_id", "created_at");
CREATE INDEX "hubspot_health_check_runs_lease_expires_at_idx" ON "hubspot_health_check_runs"("lease_expires_at");

CREATE UNIQUE INDEX "hubspot_contact_links_portal_contact_key" ON "hubspot_contact_links"("hubspot_portal_id", "channel_contact_id");
CREATE UNIQUE INDEX "hubspot_contact_links_portal_object_id_key" ON "hubspot_contact_links"("hubspot_portal_id", "hubspot_object_id");
CREATE UNIQUE INDEX "hubspot_contact_links_portal_external_key_key" ON "hubspot_contact_links"("hubspot_portal_id", "external_key");
CREATE INDEX "hubspot_contact_links_channel_contact_id_idx" ON "hubspot_contact_links"("channel_contact_id");
CREATE INDEX "hubspot_contact_links_last_successful_sync_at_idx" ON "hubspot_contact_links"("last_successful_sync_at");

CREATE UNIQUE INDEX "hubspot_deal_links_portal_run_request_key" ON "hubspot_deal_links"("hubspot_portal_id", "run_request_id");
CREATE UNIQUE INDEX "hubspot_deal_links_portal_object_id_key" ON "hubspot_deal_links"("hubspot_portal_id", "hubspot_object_id");
CREATE UNIQUE INDEX "hubspot_deal_links_portal_external_key_key" ON "hubspot_deal_links"("hubspot_portal_id", "external_key");
CREATE INDEX "hubspot_deal_links_run_request_id_idx" ON "hubspot_deal_links"("run_request_id");
CREATE INDEX "hubspot_deal_links_last_successful_sync_at_idx" ON "hubspot_deal_links"("last_successful_sync_at");
CREATE INDEX "hubspot_deal_links_last_observed_updated_at_idx" ON "hubspot_deal_links"("last_observed_hubspot_updated_at");

CREATE UNIQUE INDEX "hubspot_owners_portal_owner_id_key" ON "hubspot_owners"("hubspot_portal_id", "hubspot_owner_id");
CREATE INDEX "hubspot_owners_portal_email_active_idx" ON "hubspot_owners"("hubspot_portal_id", "normalized_email", "is_active");
CREATE INDEX "hubspot_owners_portal_archived_idx" ON "hubspot_owners"("hubspot_portal_id", "archived");

CREATE UNIQUE INDEX "hubspot_pipelines_portal_object_pipeline_key" ON "hubspot_pipelines"("hubspot_portal_id", "object_type", "hubspot_pipeline_id");
CREATE INDEX "hubspot_pipelines_portal_object_archived_idx" ON "hubspot_pipelines"("hubspot_portal_id", "object_type", "archived");

CREATE UNIQUE INDEX "hubspot_pipeline_stages_pipeline_stage_id_key" ON "hubspot_pipeline_stages"("pipeline_id", "hubspot_stage_id");
CREATE INDEX "hubspot_pipeline_stages_pipeline_archived_order_idx" ON "hubspot_pipeline_stages"("pipeline_id", "archived", "display_order");

CREATE UNIQUE INDEX "hubspot_assoc_defs_portal_types_category_id_key" ON "hubspot_association_definitions"("hubspot_portal_id", "from_object_type", "to_object_type", "association_category", "association_type_id");
CREATE INDEX "hubspot_assoc_defs_portal_types_archived_idx" ON "hubspot_association_definitions"("hubspot_portal_id", "from_object_type", "to_object_type", "archived");

CREATE UNIQUE INDEX "hubspot_webhook_events_portal_dedupe_key_key" ON "hubspot_webhook_events"("hubspot_portal_id", "dedupe_key");
CREATE INDEX "hubspot_webhook_events_status_next_retry_at_idx" ON "hubspot_webhook_events"("status", "next_retry_at");
CREATE INDEX "hubspot_webhook_events_portal_object_occurred_idx" ON "hubspot_webhook_events"("hubspot_portal_id", "object_type", "hubspot_object_id", "occurred_at");
CREATE INDEX "hubspot_webhook_events_received_at_idx" ON "hubspot_webhook_events"("received_at");

CREATE UNIQUE INDEX "hubspot_sync_cursors_portal_object_type_key" ON "hubspot_sync_cursors"("hubspot_portal_id", "object_type");
CREATE INDEX "hubspot_sync_cursors_lease_expires_at_idx" ON "hubspot_sync_cursors"("lease_expires_at");
CREATE INDEX "hubspot_sync_cursors_last_successful_sync_at_idx" ON "hubspot_sync_cursors"("last_successful_sync_at");

CREATE UNIQUE INDEX "hubspot_conflicts_portal_dedupe_key_key" ON "hubspot_conflicts"("hubspot_portal_id", "dedupe_key");
CREATE INDEX "hubspot_conflicts_status_detected_at_idx" ON "hubspot_conflicts"("status", "detected_at");
CREATE INDEX "hubspot_conflicts_portal_object_idx" ON "hubspot_conflicts"("hubspot_portal_id", "hubspot_object_type", "hubspot_object_id");
CREATE INDEX "hubspot_conflicts_channel_contact_id_idx" ON "hubspot_conflicts"("channel_contact_id");
CREATE INDEX "hubspot_conflicts_contact_link_id_idx" ON "hubspot_conflicts"("hubspot_contact_link_id");
CREATE INDEX "hubspot_conflicts_deal_link_id_idx" ON "hubspot_conflicts"("hubspot_deal_link_id");
CREATE INDEX "hubspot_conflicts_client_id_idx" ON "hubspot_conflicts"("client_id");
CREATE INDEX "hubspot_conflicts_campaign_id_idx" ON "hubspot_conflicts"("campaign_id");
CREATE INDEX "hubspot_conflicts_run_request_id_idx" ON "hubspot_conflicts"("run_request_id");
CREATE INDEX "hubspot_conflicts_resolved_by_user_id_idx" ON "hubspot_conflicts"("resolved_by_user_id");

CREATE UNIQUE INDEX "dropdown_values_portal_source_property_internal_value_key" ON "dropdown_values"("hubspot_portal_id", "source_object_type", "source_property_name", "internal_value");
CREATE INDEX "dropdown_values_hubspot_portal_id_field_key_idx" ON "dropdown_values"("hubspot_portal_id", "field_key");
CREATE INDEX "dropdown_values_source_object_property_idx" ON "dropdown_values"("source_object_type", "source_property_name");

CREATE UNIQUE INDEX "clients_portal_object_type_id_key" ON "clients"("hubspot_portal_id", "hubspot_object_type", "hubspot_object_id");
CREATE INDEX "clients_hubspot_portal_id_idx" ON "clients"("hubspot_portal_id");

CREATE UNIQUE INDEX "campaigns_portal_object_type_id_key" ON "campaigns"("hubspot_portal_id", "hubspot_object_type", "hubspot_object_id");
CREATE INDEX "campaigns_hubspot_portal_id_idx" ON "campaigns"("hubspot_portal_id");

CREATE UNIQUE INDEX "hubspot_import_batches_portal_idempotency_key_key" ON "hubspot_import_batches"("hubspot_portal_id", "idempotency_key");
CREATE UNIQUE INDEX "hubspot_import_batches_portal_external_job_id_key" ON "hubspot_import_batches"("hubspot_portal_id", "external_job_id");
CREATE INDEX "hubspot_import_batches_portal_status_idx" ON "hubspot_import_batches"("hubspot_portal_id", "status");
CREATE INDEX "hubspot_import_batches_external_status_polled_at_idx" ON "hubspot_import_batches"("external_status", "last_polled_at");
CREATE INDEX "hubspot_import_batches_status_next_retry_at_idx" ON "hubspot_import_batches"("status", "next_retry_at");
CREATE INDEX "hubspot_import_batches_phase_lease_expires_at_idx" ON "hubspot_import_batches"("phase_lease_expires_at");

CREATE UNIQUE INDEX "hubspot_import_batch_rows_batch_id_external_key_key" ON "hubspot_import_batch_rows"("batch_id", "external_key");
CREATE INDEX "hubspot_import_batch_rows_channel_contact_id_idx" ON "hubspot_import_batch_rows"("channel_contact_id");
CREATE INDEX "hubspot_import_batch_rows_contact_id_idx" ON "hubspot_import_batch_rows"("hubspot_contact_id");
CREATE INDEX "hubspot_import_batch_rows_deal_id_idx" ON "hubspot_import_batch_rows"("hubspot_deal_id");
CREATE INDEX "hubspot_import_batch_rows_status_retryable_idx" ON "hubspot_import_batch_rows"("status", "retryable");

CREATE INDEX "hubspot_object_sync_runs_portal_mode_status_idx" ON "hubspot_object_sync_runs"("hubspot_portal_id", "mode", "status");
CREATE INDEX "hubspot_object_sync_runs_lease_expires_at_idx" ON "hubspot_object_sync_runs"("lease_expires_at");

-- AddForeignKey
ALTER TABLE "hubspot_health_check_runs"
  ADD CONSTRAINT "hubspot_health_check_runs_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dropdown_values"
  ADD CONSTRAINT "dropdown_values_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_contact_links"
  ADD CONSTRAINT "hubspot_contact_links_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_contact_links"
  ADD CONSTRAINT "hubspot_contact_links_channel_contact_id_fkey"
  FOREIGN KEY ("channel_contact_id") REFERENCES "channel_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_links"
  ADD CONSTRAINT "hubspot_deal_links_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_links"
  ADD CONSTRAINT "hubspot_deal_links_run_request_id_fkey"
  FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_owners"
  ADD CONSTRAINT "hubspot_owners_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_pipelines"
  ADD CONSTRAINT "hubspot_pipelines_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_pipeline_stages"
  ADD CONSTRAINT "hubspot_pipeline_stages_pipeline_id_fkey"
  FOREIGN KEY ("pipeline_id") REFERENCES "hubspot_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_association_definitions"
  ADD CONSTRAINT "hubspot_association_definitions_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_import_batches"
  ADD CONSTRAINT "hubspot_import_batches_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_import_batch_rows"
  ADD CONSTRAINT "hubspot_import_batch_rows_channel_contact_id_fkey"
  FOREIGN KEY ("channel_contact_id") REFERENCES "channel_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_object_sync_runs"
  ADD CONSTRAINT "hubspot_object_sync_runs_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_webhook_events"
  ADD CONSTRAINT "hubspot_webhook_events_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_sync_cursors"
  ADD CONSTRAINT "hubspot_sync_cursors_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_channel_contact_id_fkey"
  FOREIGN KEY ("channel_contact_id") REFERENCES "channel_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_hubspot_contact_link_id_fkey"
  FOREIGN KEY ("hubspot_contact_link_id") REFERENCES "hubspot_contact_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_hubspot_deal_link_id_fkey"
  FOREIGN KEY ("hubspot_deal_link_id") REFERENCES "hubspot_deal_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_run_request_id_fkey"
  FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hubspot_conflicts"
  ADD CONSTRAINT "hubspot_conflicts_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
