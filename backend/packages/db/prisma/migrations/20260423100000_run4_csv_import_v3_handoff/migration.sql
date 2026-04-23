ALTER TABLE "channel_contacts"
ADD COLUMN "phone_number" TEXT;

ALTER TABLE "csv_import_rows"
ADD COLUMN "hubspot_record_id" TEXT,
ADD COLUMN "timestamp_imported" TEXT,
ADD COLUMN "channel_url" TEXT,
ADD COLUMN "campaign_name" TEXT,
ADD COLUMN "deal_owner" TEXT,
ADD COLUMN "handoff_status" TEXT,
ADD COLUMN "phone_number" TEXT,
ADD COLUMN "currency" TEXT,
ADD COLUMN "deal_type" TEXT,
ADD COLUMN "contact_type" TEXT,
ADD COLUMN "month" TEXT,
ADD COLUMN "year" TEXT,
ADD COLUMN "client_name" TEXT,
ADD COLUMN "deal_name" TEXT,
ADD COLUMN "activation_name" TEXT,
ADD COLUMN "pipeline" TEXT,
ADD COLUMN "deal_stage" TEXT,
ADD COLUMN "youtube_handle" TEXT,
ADD COLUMN "youtube_url" TEXT,
ADD COLUMN "youtube_video_median_views" TEXT,
ADD COLUMN "youtube_shorts_median_views" TEXT,
ADD COLUMN "youtube_engagement_rate" TEXT,
ADD COLUMN "youtube_followers" TEXT;
