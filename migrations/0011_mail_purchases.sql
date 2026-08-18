-- Buyer-side trades (auction wins, vendor purchases) — the counterpart of
-- mail_sales, derived from the same immutable raw mail archive.
CREATE TABLE IF NOT EXISTS mail_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mail_id uuid NOT NULL UNIQUE REFERENCES mail_messages(id) ON DELETE CASCADE,
  character_name text NOT NULL DEFAULT '',
  item_name text NOT NULL,
  seller text NOT NULL DEFAULT '',
  credits bigint NOT NULL,
  purchase_type text NOT NULL CHECK (purchase_type IN ('vendor', 'bazaar')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_purchases_user_time_idx ON mail_purchases(user_id, occurred_at);
