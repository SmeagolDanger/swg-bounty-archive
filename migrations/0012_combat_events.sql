-- Live combat monitor: combat-log lines streamed by the desktop companion.
-- Raw lines are archived alongside the parse (reparse insurance, same as
-- mail); rows are short-lived working data purged after 14 days by the
-- worker. Fully additive — no existing table is touched.

CREATE TABLE combat_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  character_name text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('damage', 'heal', 'death', 'avoid')),
  source text NOT NULL DEFAULT '',
  target text NOT NULL DEFAULT '',
  ability text NOT NULL DEFAULT '',
  amount bigint NOT NULL DEFAULT 0,
  flag text NOT NULL DEFAULT '',
  raw text NOT NULL,
  parser_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX combat_events_user_seq ON combat_events (user_id, id);
CREATE INDEX combat_events_age ON combat_events (occurred_at);

-- Combat-looking lines the parser could not read: kept briefly so new log
-- formats can be diagnosed and the parser extended.
CREATE TABLE combat_unparsed (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  raw text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX combat_unparsed_age ON combat_unparsed (uploaded_at);
