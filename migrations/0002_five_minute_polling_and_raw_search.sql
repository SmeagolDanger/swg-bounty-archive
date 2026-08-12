UPDATE api_sources SET poll_interval_seconds = 300;

CREATE INDEX IF NOT EXISTS api_ingestions_payload_search_idx
ON api_ingestions USING gin (to_tsvector('simple', coalesce(payload, '{}'::jsonb)));
