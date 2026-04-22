ALTER TABLE "channel_metrics"
ADD COLUMN IF NOT EXISTS "youtube_video_median_views" BIGINT,
ADD COLUMN IF NOT EXISTS "youtube_shorts_median_views" BIGINT;

CREATE INDEX IF NOT EXISTS "channels_country_region_idx"
ON "channels"("country_region");

CREATE INDEX IF NOT EXISTS "channels_influencer_vertical_idx"
ON "channels"("influencer_vertical");

CREATE INDEX IF NOT EXISTS "channels_influencer_type_idx"
ON "channels"("influencer_type");

CREATE INDEX IF NOT EXISTS "channel_metrics_youtube_video_median_views_idx"
ON "channel_metrics"("youtube_video_median_views");

CREATE INDEX IF NOT EXISTS "channel_metrics_youtube_shorts_median_views_idx"
ON "channel_metrics"("youtube_shorts_median_views");
