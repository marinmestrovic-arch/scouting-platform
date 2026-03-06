-- Week 3 phase 1: run requests, minimal run results snapshot, and lifecycle status.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_request_status') THEN
    CREATE TYPE run_request_status AS ENUM ('queued', 'running', 'completed', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_result_source') THEN
    CREATE TYPE run_result_source AS ENUM ('catalog', 'discovery');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS run_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name text NOT NULL,
  query text NOT NULL,
  status run_request_status NOT NULL DEFAULT 'queued',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS run_requests_requested_by_user_id_idx
  ON run_requests (requested_by_user_id);

CREATE INDEX IF NOT EXISTS run_requests_status_idx
  ON run_requests (status);

CREATE INDEX IF NOT EXISTS run_requests_created_at_idx
  ON run_requests (created_at);

CREATE TABLE IF NOT EXISTS run_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_request_id uuid NOT NULL REFERENCES run_requests (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE RESTRICT,
  rank integer NOT NULL,
  source run_result_source NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_results_run_request_id_idx
  ON run_results (run_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS run_results_run_request_id_channel_id_key
  ON run_results (run_request_id, channel_id);
