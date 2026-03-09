-- Week 5 backend foundation: HypeAuditor advanced report workflow, raw payload storage, and channel insights.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'advanced_report_request_status') THEN
    CREATE TYPE advanced_report_request_status AS ENUM (
      'pending_approval',
      'approved',
      'rejected',
      'queued',
      'running',
      'completed',
      'failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_insight_source') THEN
    CREATE TYPE channel_insight_source AS ENUM (
      'admin_manual',
      'csv_import',
      'hypeauditor'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_provider_payload_provider') THEN
    CREATE TYPE channel_provider_payload_provider AS ENUM ('hypeauditor');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS channel_insights (
  channel_id uuid PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
  audience_countries jsonb,
  audience_countries_source channel_insight_source,
  audience_countries_source_updated_at timestamptz,
  audience_gender_age jsonb,
  audience_gender_age_source channel_insight_source,
  audience_gender_age_source_updated_at timestamptz,
  audience_interests jsonb,
  audience_interests_source channel_insight_source,
  audience_interests_source_updated_at timestamptz,
  estimated_price_currency_code text,
  estimated_price_min double precision,
  estimated_price_max double precision,
  estimated_price_source channel_insight_source,
  estimated_price_source_updated_at timestamptz,
  brand_mentions jsonb,
  brand_mentions_source channel_insight_source,
  brand_mentions_source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_provider_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  provider channel_provider_payload_provider NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_provider_payloads_channel_id_idx
  ON channel_provider_payloads (channel_id);

CREATE INDEX IF NOT EXISTS channel_provider_payloads_provider_fetched_at_idx
  ON channel_provider_payloads (provider, fetched_at);

CREATE TABLE IF NOT EXISTS advanced_report_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status advanced_report_request_status NOT NULL DEFAULT 'pending_approval',
  decision_note text,
  reviewed_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  provider_payload_id uuid REFERENCES channel_provider_payloads (id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS advanced_report_requests_provider_payload_id_key
  ON advanced_report_requests (provider_payload_id);

CREATE INDEX IF NOT EXISTS advanced_report_requests_channel_id_idx
  ON advanced_report_requests (channel_id);

CREATE INDEX IF NOT EXISTS advanced_report_requests_channel_id_created_at_idx
  ON advanced_report_requests (channel_id, created_at);

CREATE INDEX IF NOT EXISTS advanced_report_requests_status_idx
  ON advanced_report_requests (status);

CREATE INDEX IF NOT EXISTS advanced_report_requests_requested_by_user_id_idx
  ON advanced_report_requests (requested_by_user_id);

CREATE INDEX IF NOT EXISTS advanced_report_requests_reviewed_by_user_id_idx
  ON advanced_report_requests (reviewed_by_user_id);

CREATE INDEX IF NOT EXISTS advanced_report_requests_created_at_idx
  ON advanced_report_requests (created_at);
