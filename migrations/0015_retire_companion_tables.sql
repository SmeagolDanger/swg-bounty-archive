-- The companion features (combat logging, mail/sales, companion API tokens)
-- were removed from the application. combat_events and combat_unparsed were
-- contractually short-lived working data (purged after 14 days by the worker,
-- which no longer exists), and api_tokens holds credentials nothing can
-- accept anymore — keeping either would silently break their own contracts.
-- The mail archive tables (mail_messages, mail_sales, mail_purchases) hold
-- user-uploaded historical data and are deliberately retained, dormant.

DROP TABLE IF EXISTS combat_unparsed;
DROP TABLE IF EXISTS combat_events;
DROP TABLE IF EXISTS api_tokens;
