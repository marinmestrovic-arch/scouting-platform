-- Week 2 phase 2: admin manual channel overrides with precedence-safe fallback values.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_manual_override_field') THEN
    CREATE TYPE channel_manual_override_field AS ENUM (
      'title',
      'handle',
      'description',
      'thumbnail_url'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS channel_manual_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  field channel_manual_override_field NOT NULL,
  value text,
  fallback_value text,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_manual_overrides_channel_id_field_key
  ON channel_manual_overrides (channel_id, field);

CREATE INDEX IF NOT EXISTS channel_manual_overrides_channel_id_idx
  ON channel_manual_overrides (channel_id);

CREATE INDEX IF NOT EXISTS channel_manual_overrides_updated_at_idx
  ON channel_manual_overrides (updated_at);

CREATE INDEX IF NOT EXISTS channel_manual_overrides_created_by_user_id_idx
  ON channel_manual_overrides (created_by_user_id);

CREATE INDEX IF NOT EXISTS channel_manual_overrides_updated_by_user_id_idx
  ON channel_manual_overrides (updated_by_user_id);
