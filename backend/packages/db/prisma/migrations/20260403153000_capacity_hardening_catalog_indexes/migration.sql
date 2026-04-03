-- `pg_trgm` is required for the catalog's ILIKE search paths on title/handle/channel id.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "channels_created_at_id_idx"
ON "channels"("created_at", "id");

CREATE INDEX "channels_title_trgm_idx"
ON "channels"
USING GIN ("title" gin_trgm_ops);

CREATE INDEX "channels_handle_trgm_idx"
ON "channels"
USING GIN ("handle" gin_trgm_ops);

CREATE INDEX "channels_youtube_channel_id_trgm_idx"
ON "channels"
USING GIN ("youtube_channel_id" gin_trgm_ops);
