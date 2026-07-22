-- Collaboration-history mirrors are additive and must be reviewed by both repository owners.

ALTER TABLE "hubspot_object_sync_runs"
  ADD COLUMN "deal_mirror_upsert_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activation_mirror_upsert_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "hubspot_deal_mirrors" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "hubspot_object_id" TEXT NOT NULL,
  "deal_name" TEXT NOT NULL,
  "amount" TEXT,
  "currency_code" TEXT,
  "pipeline_id" TEXT,
  "stage_id" TEXT,
  "owner_id" TEXT,
  "close_date" TIMESTAMP(3),
  "hubspot_created_at" TIMESTAMP(3),
  "last_observed_hubspot_updated_at" TIMESTAMP(3),
  "mirror_properties" JSONB,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_deal_mirrors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_activation_mirrors" (
  "id" UUID NOT NULL,
  "hubspot_portal_id" UUID NOT NULL,
  "hubspot_object_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "activation_type" TEXT,
  "activation_url" TEXT,
  "publication_date" TIMESTAMP(3),
  "last_observed_hubspot_updated_at" TIMESTAMP(3),
  "mirror_properties" JSONB,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_activation_mirrors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_contact_deal_associations" (
  "id" UUID NOT NULL,
  "hubspot_contact_link_id" UUID NOT NULL,
  "hubspot_deal_mirror_id" UUID NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_contact_deal_associations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_deal_client_associations" (
  "id" UUID NOT NULL,
  "hubspot_deal_mirror_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_deal_client_associations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_deal_campaign_associations" (
  "id" UUID NOT NULL,
  "hubspot_deal_mirror_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_deal_campaign_associations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hubspot_deal_activation_associations" (
  "id" UUID NOT NULL,
  "hubspot_deal_mirror_id" UUID NOT NULL,
  "hubspot_activation_mirror_id" UUID NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hubspot_deal_activation_associations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hubspot_deal_mirrors_portal_object_id_key"
  ON "hubspot_deal_mirrors"("hubspot_portal_id", "hubspot_object_id");
CREATE INDEX "hubspot_deal_mirrors_portal_archived_close_date_idx"
  ON "hubspot_deal_mirrors"("hubspot_portal_id", "archived", "close_date");
CREATE INDEX "hubspot_deal_mirrors_owner_id_idx" ON "hubspot_deal_mirrors"("owner_id");
CREATE INDEX "hubspot_deal_mirrors_stage_id_idx" ON "hubspot_deal_mirrors"("stage_id");
CREATE INDEX "hubspot_deal_mirrors_observed_updated_at_idx"
  ON "hubspot_deal_mirrors"("last_observed_hubspot_updated_at");

CREATE UNIQUE INDEX "hubspot_activation_mirrors_portal_object_id_key"
  ON "hubspot_activation_mirrors"("hubspot_portal_id", "hubspot_object_id");
CREATE INDEX "hubspot_activation_mirrors_portal_archived_publication_idx"
  ON "hubspot_activation_mirrors"("hubspot_portal_id", "archived", "publication_date");
CREATE INDEX "hubspot_activation_mirrors_observed_updated_at_idx"
  ON "hubspot_activation_mirrors"("last_observed_hubspot_updated_at");

CREATE UNIQUE INDEX "hubspot_contact_deals_contact_deal_key"
  ON "hubspot_contact_deal_associations"("hubspot_contact_link_id", "hubspot_deal_mirror_id");
CREATE INDEX "hubspot_contact_deals_deal_id_idx"
  ON "hubspot_contact_deal_associations"("hubspot_deal_mirror_id");

CREATE UNIQUE INDEX "hubspot_deal_clients_deal_client_key"
  ON "hubspot_deal_client_associations"("hubspot_deal_mirror_id", "client_id");
CREATE INDEX "hubspot_deal_clients_client_id_idx"
  ON "hubspot_deal_client_associations"("client_id");

CREATE UNIQUE INDEX "hubspot_deal_campaigns_deal_campaign_key"
  ON "hubspot_deal_campaign_associations"("hubspot_deal_mirror_id", "campaign_id");
CREATE INDEX "hubspot_deal_campaigns_campaign_id_idx"
  ON "hubspot_deal_campaign_associations"("campaign_id");

CREATE UNIQUE INDEX "hubspot_deal_activations_deal_activation_key"
  ON "hubspot_deal_activation_associations"("hubspot_deal_mirror_id", "hubspot_activation_mirror_id");
CREATE INDEX "hubspot_deal_activations_activation_id_idx"
  ON "hubspot_deal_activation_associations"("hubspot_activation_mirror_id");

ALTER TABLE "hubspot_deal_mirrors"
  ADD CONSTRAINT "hubspot_deal_mirrors_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_activation_mirrors"
  ADD CONSTRAINT "hubspot_activation_mirrors_hubspot_portal_id_fkey"
  FOREIGN KEY ("hubspot_portal_id") REFERENCES "hubspot_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hubspot_contact_deal_associations"
  ADD CONSTRAINT "hubspot_contact_deals_contact_link_id_fkey"
  FOREIGN KEY ("hubspot_contact_link_id") REFERENCES "hubspot_contact_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_contact_deal_associations"
  ADD CONSTRAINT "hubspot_contact_deals_deal_mirror_id_fkey"
  FOREIGN KEY ("hubspot_deal_mirror_id") REFERENCES "hubspot_deal_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_client_associations"
  ADD CONSTRAINT "hubspot_deal_clients_deal_mirror_id_fkey"
  FOREIGN KEY ("hubspot_deal_mirror_id") REFERENCES "hubspot_deal_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_client_associations"
  ADD CONSTRAINT "hubspot_deal_clients_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_campaign_associations"
  ADD CONSTRAINT "hubspot_deal_campaigns_deal_mirror_id_fkey"
  FOREIGN KEY ("hubspot_deal_mirror_id") REFERENCES "hubspot_deal_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_campaign_associations"
  ADD CONSTRAINT "hubspot_deal_campaigns_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_activation_associations"
  ADD CONSTRAINT "hubspot_deal_activations_deal_mirror_id_fkey"
  FOREIGN KEY ("hubspot_deal_mirror_id") REFERENCES "hubspot_deal_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hubspot_deal_activation_associations"
  ADD CONSTRAINT "hubspot_deal_activations_activation_mirror_id_fkey"
  FOREIGN KEY ("hubspot_activation_mirror_id") REFERENCES "hubspot_activation_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
