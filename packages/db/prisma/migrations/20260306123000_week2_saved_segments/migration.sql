-- Week 2 phase 1: personal saved filter segments.

CREATE TABLE IF NOT EXISTS saved_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_segments_user_id_idx
  ON saved_segments (user_id);

CREATE INDEX IF NOT EXISTS saved_segments_user_id_updated_at_idx
  ON saved_segments (user_id, updated_at DESC);
