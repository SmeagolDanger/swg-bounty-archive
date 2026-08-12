ALTER TABLE schema_signatures
ADD COLUMN IF NOT EXISTS structure jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS schema_signatures_source_last_seen_idx
ON schema_signatures(source_id, last_seen_at DESC);

WITH duplicate_open_events AS (
  SELECT id,row_number() OVER (PARTITION BY event_type,entity_key ORDER BY detected_at DESC,id DESC) AS occurrence
  FROM data_quality_events
  WHERE resolved_at IS NULL AND entity_key IS NOT NULL
)
UPDATE data_quality_events SET resolved_at=now()
WHERE id IN (SELECT id FROM duplicate_open_events WHERE occurrence > 1);

CREATE UNIQUE INDEX IF NOT EXISTS data_quality_open_event_key_unique
ON data_quality_events(event_type,entity_key)
WHERE resolved_at IS NULL AND entity_key IS NOT NULL;
