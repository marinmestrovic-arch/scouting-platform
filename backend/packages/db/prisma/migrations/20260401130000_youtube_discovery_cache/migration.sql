CREATE TABLE "youtube_discovery_cache" (
  "id"          UUID         NOT NULL,
  "cache_key"   TEXT         NOT NULL,
  "user_id"     UUID         NOT NULL,
  "query"       TEXT         NOT NULL,
  "max_results" INTEGER      NOT NULL,
  "payload"     JSONB        NOT NULL,
  "fetched_at"  TIMESTAMP(3) NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "youtube_discovery_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "youtube_discovery_cache_cache_key_key"
  ON "youtube_discovery_cache"("cache_key");

CREATE INDEX "youtube_discovery_cache_cache_key_idx"
  ON "youtube_discovery_cache"("cache_key");

CREATE INDEX "youtube_discovery_cache_expires_at_idx"
  ON "youtube_discovery_cache"("expires_at");

ALTER TABLE "youtube_discovery_cache"
  ADD CONSTRAINT "youtube_discovery_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
