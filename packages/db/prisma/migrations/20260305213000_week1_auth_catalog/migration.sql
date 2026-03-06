-- Week 1 foundation: auth, sessions, user credentials, catalog skeleton, and audit events.

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role') THEN
    CREATE TYPE role AS ENUM ('admin', 'user');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_provider') THEN
    CREATE TYPE credential_provider AS ENUM ('youtube_data_api');
  END IF;
END $$;

-- Auth.js compatible users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text NOT NULL UNIQUE,
  email_verified timestamptz,
  image text,
  password_hash text NOT NULL,
  role role NOT NULL DEFAULT 'user',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Auth.js compatible accounts table (kept for adapter compatibility)
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_provider_account_id_key
  ON accounts (provider, provider_account_id);
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts (user_id);

-- Auth.js compatible sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- Auth.js compatible verification tokens
CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_identifier_token_key
  ON verification_tokens (identifier, token);
CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_token_key
  ON verification_tokens (token);

-- User-owned provider credentials (encrypted at rest)
CREATE TABLE IF NOT EXISTS user_provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider credential_provider NOT NULL,
  encrypted_secret text NOT NULL,
  encryption_iv text NOT NULL,
  encryption_auth_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_provider_credentials_user_id_provider_key
  ON user_provider_credentials (user_id, provider);
CREATE INDEX IF NOT EXISTS user_provider_credentials_provider_idx
  ON user_provider_credentials (provider);

-- Minimal channels catalog skeleton for week 1 UI wiring
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_channel_id text NOT NULL UNIQUE,
  title text NOT NULL,
  handle text,
  description text,
  thumbnail_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channels_youtube_channel_id_idx
  ON channels (youtube_channel_id);

-- Audit log for privileged actions
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_actor_user_id_idx
  ON audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events (entity_type, entity_id);
