DROP INDEX IF EXISTS api_ingestions_payload_search_idx;

CREATE INDEX api_ingestions_payload_search_idx
ON api_ingestions USING gin (
  jsonb_to_tsvector('simple', coalesce(payload, '{}'::jsonb), '["string", "numeric", "key"]'::jsonb)
);
