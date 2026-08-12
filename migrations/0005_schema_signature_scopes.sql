ALTER TABLE schema_signatures
ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT '';

ALTER TABLE schema_signatures
DROP CONSTRAINT IF EXISTS schema_signatures_source_id_signature_key;

CREATE UNIQUE INDEX IF NOT EXISTS schema_signatures_source_scope_signature_unique
ON schema_signatures(source_id, scope_key, signature);

CREATE INDEX IF NOT EXISTS schema_signatures_source_scope_last_seen_idx
ON schema_signatures(source_id, scope_key, last_seen_at DESC);
