-- Keep the original event time on unparsed combat lines so parser upgrades
-- can promote them into combat_events with correct dates.
ALTER TABLE combat_unparsed ADD COLUMN occurred_at timestamptz;
