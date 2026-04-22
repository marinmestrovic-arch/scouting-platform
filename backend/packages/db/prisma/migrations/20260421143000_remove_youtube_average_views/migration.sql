-- Remove the deprecated YouTube average views metric. Creator List exports use median view fields only.

ALTER TABLE "channel_metrics"
DROP COLUMN IF EXISTS "youtube_average_views";
