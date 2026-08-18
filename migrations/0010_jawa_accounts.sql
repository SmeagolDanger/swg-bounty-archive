-- Jawa Tracks accounts: Discord-backed users, app/web sessions, API tokens
-- for the mail companion, cross-device store sync, and the archived mail →
-- sales pipeline. Purely additive — nothing here touches the bounty/GCW
-- ingestion tables or their invariants.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL UNIQUE,
  discord_username text NOT NULL DEFAULT '',
  discord_avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

-- Sessions carry a hashed bearer token; "web" rides a cookie, "app" lives in
-- the iOS/macOS keychain. Sliding expiry keeps sign-ins rare.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('web', 'app')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Long-lived tokens for the mail companion; hashed at rest, revocable.
CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);

-- One row per synced store item; last-write-wins on updated_at with
-- tombstones so deletions propagate between devices.
CREATE TABLE IF NOT EXISTS sync_items (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store text NOT NULL CHECK (store IN ('loadouts', 'components', 're_projects', 'fc_loadouts')),
  item_id uuid NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, store, item_id)
);
CREATE INDEX IF NOT EXISTS sync_items_user_updated_idx ON sync_items(user_id, updated_at);

-- Raw archive of uploaded in-game mails (archive-first: the original text is
-- immutable so parsing can be corrected and re-run at any time).
CREATE TABLE IF NOT EXISTS mail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  character_name text NOT NULL DEFAULT '',
  sender text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  sent_at timestamptz,
  body text NOT NULL DEFAULT '',
  raw text NOT NULL,
  parser_version text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS mail_messages_user_sent_idx ON mail_messages(user_id, sent_at);

-- Sales derived from vendor/bazaar mails; always rebuildable from raws.
CREATE TABLE IF NOT EXISTS mail_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mail_id uuid NOT NULL UNIQUE REFERENCES mail_messages(id) ON DELETE CASCADE,
  character_name text NOT NULL DEFAULT '',
  item_name text NOT NULL,
  buyer text NOT NULL DEFAULT '',
  credits bigint NOT NULL,
  vendor text NOT NULL DEFAULT '',
  sale_type text NOT NULL CHECK (sale_type IN ('vendor', 'bazaar')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_sales_user_time_idx ON mail_sales(user_id, occurred_at);
