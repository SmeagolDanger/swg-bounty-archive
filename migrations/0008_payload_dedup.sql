-- Deduplicate raw response payloads by content hash.
--
-- api_ingestions keeps every per-request observation (endpoint, timing,
-- status, headers, payload_hash) but the payload bytes move to payload_blobs,
-- stored once per unique SHA-256. Identical responses collected cycle after
-- cycle — the overwhelming majority of archive volume — now cost one copy.
-- Every response's exact content remains recoverable per request through its
-- hash, so the archive-first guarantee is unchanged.
--
-- The raw-search GIN index moves to payload_blobs, shrinking with the dedup.
--
-- NOTE: dropping the payload column marks space reusable but does not return
-- it to the OS. After deploying, reclaim once with:
--   VACUUM FULL ANALYZE api_ingestions;

CREATE TABLE IF NOT EXISTS payload_blobs (
  payload_hash text PRIMARY KEY,
  payload jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO payload_blobs (payload_hash, payload, first_seen_at)
SELECT DISTINCT ON (payload_hash) payload_hash, payload, requested_at
FROM api_ingestions
WHERE payload_hash IS NOT NULL AND payload IS NOT NULL
ORDER BY payload_hash, requested_at ASC
ON CONFLICT (payload_hash) DO NOTHING;

CREATE INDEX IF NOT EXISTS payload_blobs_search_idx
ON payload_blobs USING gin (
  jsonb_to_tsvector('simple', payload, '["string", "numeric", "key"]'::jsonb)
);

DROP INDEX IF EXISTS api_ingestions_payload_search_idx;

ALTER TABLE api_ingestions DROP COLUMN payload;

ALTER TABLE api_ingestions
  ADD CONSTRAINT api_ingestions_payload_hash_fkey
  FOREIGN KEY (payload_hash) REFERENCES payload_blobs(payload_hash);
