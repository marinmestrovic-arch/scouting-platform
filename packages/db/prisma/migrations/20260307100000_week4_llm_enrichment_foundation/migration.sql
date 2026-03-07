-- Week 4 backend foundation: cached YouTube context and additive channel enrichment lifecycle.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_enrichment_status') THEN
    CREATE TYPE channel_enrichment_status AS ENUM (
      'missing',
      'queued',
      'running',
      'completed',
      'failed',
      'stale'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS channel_youtube_contexts (
  channel_id uuid PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
  context jsonb,
  fetched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_youtube_contexts_fetched_at_idx
  ON channel_youtube_contexts (fetched_at);

CREATE TABLE IF NOT EXISTS channel_enrichments (
  channel_id uuid PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
  status channel_enrichment_status NOT NULL DEFAULT 'missing',
  requested_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  raw_openai_payload jsonb,
  summary text,
  topics jsonb,
  brand_fit_notes text,
  confidence double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_enrichments_status_idx
  ON channel_enrichments (status);

CREATE INDEX IF NOT EXISTS channel_enrichments_completed_at_idx
  ON channel_enrichments (completed_at);

CREATE INDEX IF NOT EXISTS channel_enrichments_requested_by_user_id_idx
  ON channel_enrichments (requested_by_user_id);
