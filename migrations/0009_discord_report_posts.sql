-- One row per weekly cycle whose report has been posted to Discord, so the
-- worker posts each cycle exactly once no matter how often it checks.
CREATE TABLE IF NOT EXISTS discord_report_posts (
  cycle_starts_at timestamptz PRIMARY KEY,
  cycle_ends_at timestamptz NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);
