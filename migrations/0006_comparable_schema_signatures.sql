ALTER TABLE schema_signatures
ADD COLUMN IF NOT EXISTS comparable boolean NOT NULL DEFAULT true;

UPDATE schema_signatures AS signature
SET comparable=false
WHERE EXISTS (
  SELECT 1
  FROM jsonb_each(signature.structure) AS field(path, types)
  WHERE field.types ? 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(signature.structure) AS member(member_path)
      WHERE member.member_path LIKE field.path || '[]%'
    )
);

CREATE INDEX IF NOT EXISTS schema_signatures_comparable_scope_last_seen_idx
ON schema_signatures(source_id, scope_key, last_seen_at DESC)
WHERE comparable;
