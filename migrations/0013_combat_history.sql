-- Combat events are now a permanent archive (user decision 2026-08-18):
-- the worker no longer purges them, and history queries need a composite
-- index. combat_unparsed stays short-lived diagnostic data.
CREATE INDEX combat_events_user_time ON combat_events (user_id, occurred_at);
